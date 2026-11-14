"""RedVoice: place voice-over clips on the open DaVinci Resolve timeline.

Resolve Studio exposes a Python scripting API (``DaVinciResolveScript``) that
loads Resolve's own native library into the calling interpreter. A crash or
hang in that library must never take the backend down, so the parent side
(:func:`send_to_resolve`) runs this file as a child process with the request
as JSON on stdin and reads one JSON result line from stdout.

The child side (:func:`place_clips`) only uses documented API calls:

* the clips are imported into a ``RedVoice`` bin in the media pool;
* a new audio track named ``RedVoice VO`` is added, so existing audio is never
  overwritten; a clip that would overlap the one before it goes to a second
  new track instead of cutting it;
* a clip with a start time (from the subtitles) lands at timeline start plus
  that time; clips without one follow each other from the playhead.

Nothing here leaves the machine: Resolve's scripting API is a local
connection to the Resolve process the user has open.
"""

from __future__ import annotations

import importlib
import json
import math
import ntpath
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

BIN_NAME = "RedVoice"
TRACK_NAME = "RedVoice VO"
MAX_CLIPS = 500
GAP_SECONDS = 0.5
CHILD_TIMEOUT_S = 120.0
AUDIO_EXTENSIONS = (".wav",)

# Error codes the interface translates; ``detail`` is never shown raw.
NOT_INSTALLED = "resolve_not_installed"
NOT_RUNNING = "resolve_not_running"
NO_PROJECT = "no_project"
NO_TIMELINE = "no_timeline"
IMPORT_FAILED = "import_failed"
TRACK_FAILED = "track_failed"
PLACE_FAILED = "place_failed"
FAILED = "failed"
TIMEOUT = "timeout"


class ResolveError(Exception):
    def __init__(self, code: str, detail: str = "", files: list[str] | None = None):
        super().__init__(detail or code)
        self.code = code
        self.detail = detail
        self.files = files or []


@dataclass(frozen=True)
class Clip:
    path: str
    start_seconds: float | None = None
    duration_seconds: float | None = None


@dataclass
class Placement:
    clip: Clip
    record_frame: int
    frames: int
    track: int = 0  # 0-based among the tracks this send adds


@dataclass
class Result:
    timeline: str
    tracks: list[str]
    placed: int
    warnings: list[str] = field(default_factory=list)


# --- timing -----------------------------------------------------------------


def parse_frame_rate(value: Any) -> float:
    """Resolve reports rates as text such as ``"24"``, ``"23.976"`` or ``"29.97 DF"``."""
    match = re.match(r"\s*(\d+(?:\.\d+)?)", str(value or ""))
    rate = float(match.group(1)) if match else 0.0
    if not 1 <= rate <= 240:
        raise ResolveError(FAILED, f"unusable timeline frame rate {value!r}")
    return rate


def timecode_to_frames(timecode: str, rate: float) -> int:
    """Frame number of a Resolve timecode (``;`` or ``.`` before frames = drop frame)."""
    match = re.fullmatch(r"\s*(\d+):(\d\d):(\d\d)([:;.,])(\d+)\s*", str(timecode or ""))
    if not match:
        raise ResolveError(FAILED, f"unreadable timecode {timecode!r}")
    hours, minutes, seconds, sep, frames = match.groups()
    h, m, s, f = int(hours), int(minutes), int(seconds), int(frames)
    nominal = round(rate)
    total = ((h * 60 + m) * 60 + s) * nominal + f
    if sep in ";.," and nominal in (30, 60):
        # SMPTE drop frame: two (or four) frame numbers are skipped each
        # minute except every tenth.
        drop = 2 if nominal == 30 else 4
        minutes_total = h * 60 + m
        total -= drop * (minutes_total - minutes_total // 10)
    return total


def seconds_to_frames(seconds: float, rate: float) -> int:
    return round(seconds * rate)


def plan_placements(
    clips: list[Clip],
    *,
    rate: float,
    timeline_start: int,
    playhead: int,
    clip_frames: list[int],
    gap_seconds: float = GAP_SECONDS,
) -> list[Placement]:
    """Where each clip goes, and on which of the new tracks.

    Timed clips sit at their subtitle start; untimed clips follow each other
    from the playhead. A clip that would start before the previous clip on a
    track has ended moves to the next track, so nothing is cut.
    """
    placements: list[Placement] = []
    cursor = max(playhead, timeline_start)
    gap = seconds_to_frames(gap_seconds, rate)
    for clip, frames in zip(clips, clip_frames, strict=True):
        if clip.start_seconds is not None:
            record = timeline_start + seconds_to_frames(clip.start_seconds, rate)
        else:
            record = cursor
            cursor = record + frames + gap
        placements.append(Placement(clip=clip, record_frame=record, frames=max(1, frames)))

    track_ends: list[int] = []
    for placement in sorted(placements, key=lambda item: item.record_frame):
        for index, end in enumerate(track_ends):
            if placement.record_frame >= end:
                placement.track = index
                track_ends[index] = placement.record_frame + placement.frames
                break
        else:
            placement.track = len(track_ends)
            track_ends.append(placement.record_frame + placement.frames)
    return placements


# --- the Resolve side (runs in the child process) ---------------------------


def _same_path(left: str, right: str) -> bool:
    return os.path.normcase(os.path.normpath(left)) == os.path.normcase(os.path.normpath(right))


def default_script_paths(platform: str = sys.platform, env: dict | None = None) -> tuple[str, str]:
    """Blackmagic's documented locations of the scripting modules and library."""
    env = os.environ if env is None else env
    if platform == "win32":
        program_data = env.get("PROGRAMDATA") or r"C:\ProgramData"
        program_files = env.get("PROGRAMFILES") or r"C:\Program Files"
        return (
            ntpath.join(program_data, "Blackmagic Design", "DaVinci Resolve", "Support",
                        "Developer", "Scripting"),
            ntpath.join(program_files, "Blackmagic Design", "DaVinci Resolve", "fusionscript.dll"),
        )
    if platform == "darwin":
        return (
            "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting",
            ("/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/"
             "fusionscript.so"),
        )
    return ("/opt/resolve/Developer/Scripting", "/opt/resolve/libs/Fusion/fusionscript.so")


def connect() -> Any:
    """Return the running Resolve app object, or raise a coded error."""
    api, lib = default_script_paths()
    api = os.environ.get("RESOLVE_SCRIPT_API") or api
    os.environ["RESOLVE_SCRIPT_LIB"] = os.environ.get("RESOLVE_SCRIPT_LIB") or lib
    modules = os.path.join(api, "Modules")
    if not os.path.isfile(os.path.join(modules, "DaVinciResolveScript.py")):
        raise ResolveError(NOT_INSTALLED, "scripting modules not found")
    if not os.path.isfile(os.environ["RESOLVE_SCRIPT_LIB"]):
        raise ResolveError(NOT_INSTALLED, "fusionscript library not found")
    sys.path.insert(0, modules)
    try:
        module = importlib.import_module("DaVinciResolveScript")
    except BaseException as exc:  # noqa: BLE001 — the module calls sys.exit on failure
        raise ResolveError(NOT_INSTALLED, f"could not load the scripting module: {type(exc).__name__}")
    resolve = module.scriptapp("Resolve")
    if resolve is None:
        raise ResolveError(NOT_RUNNING)
    return resolve


def _bin(media_pool: Any) -> Any:
    root = media_pool.GetRootFolder()
    for folder in root.GetSubFolderList() or []:
        if folder.GetName() == BIN_NAME:
            return folder
    return media_pool.AddSubFolder(root, BIN_NAME) or root


def _clip_path(item: Any) -> str:
    try:
        return str(item.GetClipProperty("File Path") or "")
    except Exception:  # noqa: BLE001
        return ""


def import_clips(media_pool: Any, paths: list[str]) -> list[Any]:
    """Media pool items for ``paths``, in order; files already in the bin are refreshed."""
    previous = media_pool.GetCurrentFolder()
    folder = _bin(media_pool)
    media_pool.SetCurrentFolder(folder)
    try:
        existing = list(folder.GetClipList() or [])
        found: dict[str, Any] = {}
        fresh: list[str] = []
        for path in paths:
            item = next((clip for clip in existing if _same_path(_clip_path(clip), path)), None)
            if item is not None:
                # Same file name, possibly new audio (a regenerated take).
                item.ReplaceClip(path)
                found[path] = item
            elif path not in fresh:
                fresh.append(path)
        if fresh:
            imported = list(media_pool.ImportMedia(fresh) or [])
            for path in fresh:
                item = next((clip for clip in imported if _same_path(_clip_path(clip), path)), None)
                if item is not None:
                    found[path] = item
        missing = [os.path.basename(path) for path in paths if path not in found]
        if missing:
            raise ResolveError(IMPORT_FAILED, "Resolve did not import every file", missing)
        return [found[path] for path in paths]
    finally:
        if previous is not None:
            media_pool.SetCurrentFolder(previous)


def _clip_frames(item: Any, clip: Clip, rate: float) -> int:
    try:
        frames = int(str(item.GetClipProperty("Frames") or "").strip())
        if frames > 0:
            return frames
    except (TypeError, ValueError):
        pass
    if clip.duration_seconds:
        return max(1, math.ceil(clip.duration_seconds * rate))
    raise ResolveError(PLACE_FAILED, "clip length unknown", [os.path.basename(clip.path)])


def add_track(timeline: Any, name: str) -> int:
    """Add an empty mono audio track at the bottom and return its 1-based index."""
    before = int(timeline.GetTrackCount("audio") or 0)
    # The option format changed between Resolve versions; try the newest last.
    for args in (("audio", "mono"), ("audio", {"audioType": "mono"}), ("audio",)):
        try:
            if timeline.AddTrack(*args) and int(timeline.GetTrackCount("audio")) > before:
                break
        except Exception:  # noqa: BLE001, S112 — an older option format; try the next
            continue
    else:
        raise ResolveError(TRACK_FAILED, "could not add an audio track")
    index = int(timeline.GetTrackCount("audio"))
    timeline.SetTrackName("audio", index, name)
    return index


def place_clips(resolve: Any, clips: list[Clip], track_name: str = TRACK_NAME) -> Result:
    project = resolve.GetProjectManager().GetCurrentProject()
    if project is None:
        raise ResolveError(NO_PROJECT)
    timeline = project.GetCurrentTimeline()
    if timeline is None:
        raise ResolveError(NO_TIMELINE)
    rate = parse_frame_rate(timeline.GetSetting("timelineFrameRate"))
    start = int(timeline.GetStartFrame())
    try:
        playhead = timecode_to_frames(timeline.GetCurrentTimecode(), rate)
    except ResolveError:
        playhead = start
    media_pool = project.GetMediaPool()
    items = import_clips(media_pool, [clip.path for clip in clips])
    frames = [_clip_frames(item, clip, rate) for item, clip in zip(items, clips, strict=True)]
    placements = plan_placements(
        clips, rate=rate, timeline_start=start, playhead=playhead, clip_frames=frames
    )

    names: list[str] = []
    tracks: list[int] = []
    for number in range(max(p.track for p in placements) + 1):
        names.append(track_name if number == 0 else f"{track_name} {number + 1}")
        tracks.append(add_track(timeline, names[-1]))

    warnings: list[str] = []
    by_path = dict(zip((clip.path for clip in clips), items, strict=True))
    for placement in placements:
        info = {
            "mediaPoolItem": by_path[placement.clip.path],
            "startFrame": 0,
            "endFrame": placement.frames - 1,
            "mediaType": 2,
            "trackIndex": tracks[placement.track],
            "recordFrame": placement.record_frame,
        }
        appended = media_pool.AppendToTimeline([info]) or []
        name = os.path.basename(placement.clip.path)
        if not appended:
            raise ResolveError(PLACE_FAILED, "Resolve refused a clip", [name])
        try:
            actual = int(appended[0].GetStart())
            if actual != placement.record_frame:
                warnings.append(f"{name}: placed at frame {actual}, asked for {placement.record_frame}")
        except Exception:  # noqa: BLE001, S110 — the check is informative only
            pass
    return Result(timeline=str(timeline.GetName()), tracks=names, placed=len(placements),
                  warnings=warnings)


# --- request validation and the parent side ----------------------------------


def parse_clips(folder: str, entries: list[dict]) -> list[Clip]:
    """Absolute paths of WAV files the user just exported into ``folder``."""
    if not entries:
        raise ValueError("no clips to send")
    if len(entries) > MAX_CLIPS:
        raise ValueError("too many clips")
    base = Path(folder)
    if not base.is_absolute() or not base.is_dir():
        raise ValueError("export folder not found")
    clips: list[Clip] = []
    for entry in entries:
        name = str(entry.get("file") or "")
        if not name or name != os.path.basename(name) or name in (".", "..") or "/" in name \
                or "\\" in name:
            raise ValueError("clip names must be plain file names")
        if not name.lower().endswith(AUDIO_EXTENSIONS):
            raise ValueError("only WAV clips can be sent")
        path = base / name
        if not path.is_file():
            raise ValueError("a clip file is missing")
        start = entry.get("start_seconds")
        duration = entry.get("duration_seconds")
        for value in (start, duration):
            if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool)
                                      or not math.isfinite(value) or value < 0):
                raise ValueError("clip times must be positive numbers")
        clips.append(Clip(str(path.resolve()), start, duration))
    return clips


def child_main(stdin=sys.stdin, stdout=sys.stdout) -> int:
    try:
        request = json.loads(stdin.read())
        clips = [Clip(**clip) for clip in request["clips"]]
        result = place_clips(connect(), clips, request.get("track_name") or TRACK_NAME)
        payload = {"ok": True, **result.__dict__}
    except ResolveError as exc:
        payload = {"ok": False, "code": exc.code, "detail": exc.detail, "files": exc.files}
    except Exception as exc:  # noqa: BLE001 — reported to the parent, which logs it
        payload = {"ok": False, "code": FAILED, "detail": type(exc).__name__, "files": []}
    stdout.write("\n" + json.dumps(payload) + "\n")
    stdout.flush()
    return 0


def _last_json_line(text: str) -> dict | None:
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("{"):
            try:
                return json.loads(line)
            except ValueError:
                return None
    return None


def send_to_resolve(clips: list[Clip], track_name: str = TRACK_NAME,
                    run=subprocess.run, timeout: float = CHILD_TIMEOUT_S) -> dict:
    """Run :func:`child_main` in a fresh interpreter and return its JSON result."""
    request = json.dumps({"clips": [clip.__dict__ for clip in clips], "track_name": track_name})
    try:
        completed = run(
            [sys.executable, "-I", os.path.abspath(__file__)],
            input=request, capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "code": TIMEOUT, "detail": "", "files": []}
    payload = _last_json_line(completed.stdout or "")
    if payload is None:
        return {"ok": False, "code": FAILED, "detail": f"exit {completed.returncode}", "files": []}
    return payload


if __name__ == "__main__":
    sys.exit(child_main())
