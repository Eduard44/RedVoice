"""RedVoice: placing Script clips on the open DaVinci Resolve timeline.

Resolve itself is not available in CI, so its scripting objects are faked with
the documented method names. The child process path is exercised for real.
"""

from __future__ import annotations

import io
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from services import resolve_timeline as rt

# --- a minimal fake of Resolve's scripting objects --------------------------


class FakeItem:
    def __init__(self, path: str, frames: int | str = 48):
        self.path, self.frames, self.replaced = path, frames, 0

    def GetClipProperty(self, key):
        return {"File Path": self.path, "Frames": str(self.frames)}.get(key)

    def ReplaceClip(self, path):
        self.replaced += 1
        return True


class FakeFolder:
    def __init__(self, name, clips=None):
        self.name, self.clips, self.subfolders = name, list(clips or []), []

    def GetName(self):
        return self.name

    def GetSubFolderList(self):
        return self.subfolders

    def GetClipList(self):
        return self.clips


class FakeTimelineItem:
    def __init__(self, start):
        self.start = start

    def GetStart(self):
        return self.start


class FakeTimeline:
    def __init__(self, rate="24", start=86400, playhead="01:00:10:00"):
        self.rate, self.start, self.playhead = rate, start, playhead
        self.audio_tracks = ["Audio 1"]

    def GetName(self):
        return "Edit v3"

    def GetSetting(self, key):
        return self.rate if key == "timelineFrameRate" else ""

    def GetStartFrame(self):
        return self.start

    def GetCurrentTimecode(self):
        return self.playhead

    def GetTrackCount(self, kind):
        return len(self.audio_tracks)

    def AddTrack(self, kind, sub=None):
        self.audio_tracks.append(f"Audio {len(self.audio_tracks) + 1}")
        return True

    def SetTrackName(self, kind, index, name):
        self.audio_tracks[index - 1] = name
        return True


class FakeMediaPool:
    def __init__(self, timeline, root=None, import_nothing=False):
        self.timeline, self.root = timeline, root or FakeFolder("Master")
        self.current, self.appended, self.imported = self.root, [], []
        self.import_nothing = import_nothing

    def GetRootFolder(self):
        return self.root

    def GetCurrentFolder(self):
        return self.current

    def SetCurrentFolder(self, folder):
        self.current = folder
        return True

    def AddSubFolder(self, parent, name):
        folder = FakeFolder(name)
        parent.subfolders.append(folder)
        return folder

    def ImportMedia(self, paths):
        self.imported.append((self.current.name, list(paths)))
        if self.import_nothing:
            return []
        items = [FakeItem(path) for path in reversed(paths)]  # order is not promised
        self.current.clips.extend(items)
        return items

    def AppendToTimeline(self, infos):
        self.appended.extend(infos)
        return [FakeTimelineItem(info["recordFrame"]) for info in infos]


class FakeResolve:
    def __init__(self, project=True, timeline=True, pool=None, **timeline_args):
        self.timeline = FakeTimeline(**timeline_args) if timeline else None
        self.pool = pool or FakeMediaPool(self.timeline)
        self.project = project

    def GetProjectManager(self):
        outer = self

        class Manager:
            def GetCurrentProject(self):
                if not outer.project:
                    return None

                class Project:
                    def GetCurrentTimeline(self):
                        return outer.timeline

                    def GetMediaPool(self):
                        return outer.pool

                return Project()

        return Manager()


# --- timing ------------------------------------------------------------------


def test_frame_rates_and_timecodes():
    assert rt.parse_frame_rate("23.976") == pytest.approx(23.976)
    assert rt.parse_frame_rate("29.97 DF") == pytest.approx(29.97)
    with pytest.raises(rt.ResolveError):
        rt.parse_frame_rate("")
    assert rt.timecode_to_frames("01:00:00:00", 24) == 86400
    assert rt.timecode_to_frames("01:00:10:12", 25) == 90262
    # Drop frame: one hour at 29.97 is 107892 frames, not 108000.
    assert rt.timecode_to_frames("01:00:00;00", 29.97) == 107892
    assert rt.timecode_to_frames("00:01:00;02", 29.97) == 1800
    with pytest.raises(rt.ResolveError):
        rt.timecode_to_frames("garbage", 24)


def test_timed_clips_land_at_their_subtitle_start():
    clips = [rt.Clip("a.wav", 0.0), rt.Clip("b.wav", 2.5)]
    plan = rt.plan_placements(clips, rate=24, timeline_start=86400, playhead=90000,
                              clip_frames=[48, 24])
    assert [(p.record_frame, p.track) for p in plan] == [(86400, 0), (86460, 0)]


def test_untimed_clips_follow_each_other_from_the_playhead_with_a_gap():
    clips = [rt.Clip("a.wav"), rt.Clip("b.wav")]
    plan = rt.plan_placements(clips, rate=24, timeline_start=86400, playhead=86640,
                              clip_frames=[48, 24])
    assert [p.record_frame for p in plan] == [86640, 86640 + 48 + 12]
    assert {p.track for p in plan} == {0}


def test_an_overrunning_clip_moves_to_a_second_track_instead_of_being_cut():
    clips = [rt.Clip("a.wav", 0.0), rt.Clip("b.wav", 1.0), rt.Clip("c.wav", 3.0)]
    plan = rt.plan_placements(clips, rate=24, timeline_start=0, playhead=0,
                              clip_frames=[48, 24, 24])
    assert [p.track for p in plan] == [0, 1, 0]


# --- talking to Resolve ---------------------------------------------------------


def test_place_clips_imports_into_a_bin_and_fills_a_new_named_track():
    resolve = FakeResolve()
    clips = [rt.Clip("/vo/line-01_take-02.wav", 0.0), rt.Clip("/vo/line-02_take-01.wav", 4.0)]
    result = rt.place_clips(resolve, clips)

    pool = resolve.pool
    assert pool.imported == [("RedVoice", ["/vo/line-01_take-02.wav", "/vo/line-02_take-01.wav"])]
    assert pool.current is pool.root  # the user's selected bin is restored
    assert resolve.timeline.audio_tracks == ["Audio 1", "RedVoice VO"]
    assert [info["mediaPoolItem"].path for info in pool.appended] == [c.path for c in clips]
    assert [info["recordFrame"] for info in pool.appended] == [86400, 86400 + 96]
    assert all(info["trackIndex"] == 2 and info["mediaType"] == 2 for info in pool.appended)
    assert pool.appended[0]["startFrame"] == 0 and pool.appended[0]["endFrame"] == 47
    assert result.timeline == "Edit v3" and result.tracks == ["RedVoice VO"]
    assert result.placed == 2 and result.warnings == []


def test_files_already_in_the_bin_are_refreshed_not_imported_twice():
    old = FakeItem("/vo/line-01_take-01.wav")
    root = FakeFolder("Master")
    root.subfolders.append(FakeFolder("RedVoice", [old]))
    timeline = FakeTimeline()
    resolve = FakeResolve(pool=FakeMediaPool(timeline, root))
    resolve.timeline = timeline
    rt.place_clips(resolve, [rt.Clip("/vo/line-01_take-01.wav"), rt.Clip("/vo/line-02_take-01.wav")])
    assert old.replaced == 1
    assert resolve.pool.imported == [("RedVoice", ["/vo/line-02_take-01.wav"])]


def test_overlaps_get_a_second_track():
    resolve = FakeResolve()
    rt.place_clips(resolve, [rt.Clip("/vo/a.wav", 0.0), rt.Clip("/vo/b.wav", 1.0)])
    assert resolve.timeline.audio_tracks == ["Audio 1", "RedVoice VO", "RedVoice VO 2"]
    assert [info["trackIndex"] for info in resolve.pool.appended] == [2, 3]


@pytest.mark.parametrize(("kwargs", "code"), [
    ({"project": False}, rt.NO_PROJECT),
    ({"timeline": False}, rt.NO_TIMELINE),
])
def test_missing_project_or_timeline_is_reported(kwargs, code):
    with pytest.raises(rt.ResolveError) as error:
        rt.place_clips(FakeResolve(**kwargs), [rt.Clip("/vo/a.wav")])
    assert error.value.code == code


def test_files_resolve_refused_to_import_are_named():
    timeline = FakeTimeline()
    resolve = FakeResolve(pool=FakeMediaPool(timeline, import_nothing=True))
    resolve.timeline = timeline
    with pytest.raises(rt.ResolveError) as error:
        rt.place_clips(resolve, [rt.Clip("/vo/a.wav")])
    assert error.value.code == rt.IMPORT_FAILED and error.value.files == ["a.wav"]


def test_clip_length_falls_back_to_the_exported_duration():
    item = FakeItem("/vo/a.wav", frames="")
    assert rt._clip_frames(item, rt.Clip("/vo/a.wav", None, 2.01), 24) == 49


# --- the request and the child process -----------------------------------------


def test_parse_clips_accepts_only_plain_wav_names_in_the_folder(tmp_path):
    (tmp_path / "line-01_take-01.wav").write_bytes(b"RIFF")
    (tmp_path / "notes.txt").write_text("x")
    clips = rt.parse_clips(str(tmp_path), [{"file": "line-01_take-01.wav", "start_seconds": 1.5}])
    assert clips == [rt.Clip(str((tmp_path / "line-01_take-01.wav").resolve()), 1.5, None)]
    for bad in ("../x.wav", "sub/x.wav", "sub\\x.wav", "notes.txt", "missing.wav", ""):
        with pytest.raises(ValueError):
            rt.parse_clips(str(tmp_path), [{"file": bad}])
    with pytest.raises(ValueError):
        rt.parse_clips(str(tmp_path), [{"file": "line-01_take-01.wav", "start_seconds": -1}])
    with pytest.raises(ValueError):
        rt.parse_clips("relative/folder", [{"file": "line-01_take-01.wav"}])
    with pytest.raises(ValueError):
        rt.parse_clips(str(tmp_path), [])


def test_child_reports_coded_errors_as_one_json_line(monkeypatch):
    def refuse():
        raise rt.ResolveError(rt.NOT_RUNNING)

    monkeypatch.setattr(rt, "connect", refuse)
    out = io.StringIO()
    rt.child_main(io.StringIO(json.dumps({"clips": [{"path": "/a.wav"}]})), out)
    assert json.loads(out.getvalue().strip().splitlines()[-1]) == {
        "ok": False, "code": rt.NOT_RUNNING, "detail": "", "files": []}


def test_parent_reads_the_last_json_line_and_survives_noise_and_hangs():
    noisy = subprocess.CompletedProcess([], 0, stdout='Resolve says hi\n{"ok": true, "placed": 1}\n')
    assert rt.send_to_resolve([rt.Clip("/a.wav")], run=lambda *a, **k: noisy)["placed"] == 1

    garbage = subprocess.CompletedProcess([], 3, stdout="Traceback ...")
    assert rt.send_to_resolve([rt.Clip("/a.wav")], run=lambda *a, **k: garbage)["code"] == rt.FAILED

    def hang(*args, **kwargs):
        raise subprocess.TimeoutExpired(args, 1)

    assert rt.send_to_resolve([rt.Clip("/a.wav")], run=hang)["code"] == rt.TIMEOUT


def test_real_child_process_without_resolve_says_it_is_not_installed(monkeypatch, tmp_path):
    monkeypatch.setenv("RESOLVE_SCRIPT_API", str(tmp_path / "nowhere"))
    result = rt.send_to_resolve([rt.Clip(str(tmp_path / "a.wav"))])
    assert result["ok"] is False and result["code"] == rt.NOT_INSTALLED


def test_default_paths_follow_blackmagic_layout_per_platform():
    api, lib = rt.default_script_paths("win32", {"PROGRAMDATA": r"D:\PD", "PROGRAMFILES": r"D:\PF"})
    assert api.endswith(r"DaVinci Resolve\Support\Developer\Scripting") and api.startswith(r"D:\PD")
    assert lib.endswith(r"DaVinci Resolve\fusionscript.dll") and lib.startswith(r"D:\PF")
    assert rt.default_script_paths("darwin", {})[1].endswith("fusionscript.so")
    assert rt.default_script_paths("linux", {})[0] == "/opt/resolve/Developer/Scripting"


# --- the route -------------------------------------------------------------------


def _client(host="127.0.0.1"):
    from api.routers import resolve as route

    app = FastAPI()
    app.include_router(route.router)
    return TestClient(app, client=(host, 50000))


def test_route_validates_then_returns_the_child_result(monkeypatch, tmp_path):
    (tmp_path / "line-01_take-01.wav").write_bytes(b"RIFF")
    seen = {}

    def fake_send(clips, track_name):
        seen["clips"], seen["track"] = clips, track_name
        return {"ok": True, "timeline": "Edit v3", "tracks": ["RedVoice VO"], "placed": 1}

    monkeypatch.setattr(rt, "send_to_resolve", fake_send)
    response = _client().post("/resolve/send", json={
        "folder": str(tmp_path), "clips": [{"file": "line-01_take-01.wav", "start_seconds": 2}]})
    assert response.status_code == 200
    assert response.json() == {"ok": True, "code": None, "timeline": "Edit v3",
                               "tracks": ["RedVoice VO"], "placed": 1, "files": [], "warnings": []}
    assert seen["track"] == "RedVoice VO" and seen["clips"][0].start_seconds == 2

    bad = _client().post("/resolve/send", json={"folder": str(tmp_path), "clips": [{"file": "../x.wav"}]})
    assert bad.status_code == 400


def test_route_passes_coded_failures_through(monkeypatch, tmp_path):
    (tmp_path / "a.wav").write_bytes(b"RIFF")
    monkeypatch.setattr(rt, "send_to_resolve", lambda clips, track: {
        "ok": False, "code": rt.NO_TIMELINE, "detail": "x", "files": []})
    body = _client().post("/resolve/send", json={"folder": str(tmp_path), "clips": [{"file": "a.wav"}]}).json()
    assert body["ok"] is False and body["code"] == rt.NO_TIMELINE


def test_route_is_refused_from_another_computer(tmp_path):
    response = _client("192.168.1.20").post(
        "/resolve/send", json={"folder": str(tmp_path), "clips": [{"file": "a.wav"}]})
    assert response.status_code == 403


def test_every_backend_error_code_has_a_message_in_the_interface():
    source = (Path(__file__).resolve().parent.parent / "electron/src/renderer/src/features/script/"
              "resolve.ts").read_text(encoding="utf-8")
    codes = {rt.NOT_INSTALLED, rt.NOT_RUNNING, rt.NO_PROJECT, rt.NO_TIMELINE, rt.IMPORT_FAILED,
             rt.TRACK_FAILED, rt.PLACE_FAILED, rt.TIMEOUT}
    for code in codes:
        assert f"'{code}'" in source, code
