#!/usr/bin/env python3
"""Time text-to-speech on the running RedVoice backend, the way the app calls it.

Used on the test PC to compare engines and devices (Vulkan GGUF, CPU, ROCm):
it sends the same sentence several times to ``/generate`` with a fixed seed,
reads the backend's own timing headers and prints a table plus one summary row
for ``docs/redvoice-pc-test-plan.md``. The first run includes loading the model;
the later runs are the speed you get while working.

Start RedVoice first (``bun run dev``), then, from the repository root::

    uv run --no-project python scripts/redvoice/measure_tts.py
    uv run --no-project python scripts/redvoice/measure_tts.py --engine omnivoice-gguf
    uv run --no-project python scripts/redvoice/measure_tts.py --runs 5 --save-dir takes

Standard library only, so any Python 3.10+ runs it; ``uv run`` brings one. It only talks to the local
backend (``127.0.0.1`` by default).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

def _default_base() -> str:
    """The app's backend address: OMNIVOICE_PORT when set, as the app reads it, else 3900."""
    port = os.environ.get("OMNIVOICE_PORT", "").strip()
    return f"http://127.0.0.1:{port if port.isdigit() else 3900}"


DEFAULT_BASE = _default_base()
DEFAULT_TEXT = (
    "The quick brown fox jumps over the lazy dog, "
    "and the editor cuts it right on the beat."
)
DEFAULT_SEED = 1234


@dataclass
class Run:
    number: int
    wall_seconds: float
    render_seconds: Optional[float]
    audio_seconds: Optional[float]

    @property
    def rtf(self) -> Optional[float]:
        """Seconds of rendering per second of audio; below 1 is faster than real time."""
        if self.render_seconds is None or not self.audio_seconds:
            return None
        return self.render_seconds / self.audio_seconds


def _request(base: str, path: str, *, data: bytes | None = None, headers: dict | None = None,
             timeout: float = 30.0):
    request = urllib.request.Request(base.rstrip("/") + path, data=data, headers=headers or {})
    # Matches the app's own requests; harmless for a script without browser cookies.
    request.add_header("X-VoiceStudio-CSRF", "1")
    return urllib.request.urlopen(request, timeout=timeout)


def _get_json(base: str, path: str) -> dict:
    with _request(base, path) as response:
        return json.loads(response.read().decode("utf-8"))


def _multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = uuid.uuid4().hex
    parts = []
    for name, value in fields.items():
        parts.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'
        )
    parts.append(f"--{boundary}--\r\n")
    return "".join(parts).encode("utf-8"), f"multipart/form-data; boundary={boundary}"


def _float(value: Optional[str]) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def describe_engine(base: str, engine: Optional[str]) -> dict:
    """Which engine will run and on what device, as the backend reports it."""
    engines = _get_json(base, "/engines").get("tts") or {}
    engine_id = engine or engines.get("active")
    backend = next((b for b in engines.get("backends") or [] if b.get("id") == engine_id), {})
    info = {
        "engine": engine_id,
        "device": backend.get("effective_device"),
        "gpu": None,
        "quant": None,
    }
    if engine_id == "omnivoice-gguf":
        try:
            quants = _get_json(base, "/engines/omnivoice-gguf/quants")
            hardware = quants.get("hardware") or {}
            info["gpu"] = hardware.get("gpu_name")
            info["device"] = hardware.get("device") or info["device"]
            info["quant"] = quants.get("in_use") or quants.get("selected")
        except (urllib.error.URLError, ValueError):
            pass
    return info


def generate_once(base: str, number: int, text: str, engine: Optional[str], seed: int,
                  timeout: float, save_dir: Optional[Path]) -> Run:
    fields = {"text": text, "language": "English", "seed": str(seed), "wav_bits": "16"}
    if engine:
        fields["engine"] = engine
    body, content_type = _multipart(fields)
    started = time.perf_counter()
    with _request(base, "/generate", data=body, headers={"Content-Type": content_type},
                  timeout=timeout) as response:
        audio = response.read()
        headers = response.headers
    wall = time.perf_counter() - started
    if save_dir is not None:
        save_dir.mkdir(parents=True, exist_ok=True)
        (save_dir / f"run-{number:02d}.wav").write_bytes(audio)
    return Run(
        number=number,
        wall_seconds=wall,
        render_seconds=_float(headers.get("X-Gen-Time")),
        audio_seconds=_float(headers.get("X-Audio-Duration")),
    )


def _fmt(value: Optional[float], digits: int = 2) -> str:
    return "–" if value is None else f"{value:.{digits}f}"


def report(info: dict, runs: list[Run]) -> str:
    """A table of every run, then one summary row for the test plan."""
    where = info.get("gpu") or info.get("device") or "unknown device"
    lines = [
        f"Engine: {info.get('engine')}  Device: {where}"
        + (f"  Quant: {info['quant']}" if info.get("quant") else ""),
        "",
        "| Run | Wall time (s) | Render time (s) | Audio (s) | RTF |",
        "|---|---|---|---|---|",
    ]
    for run in runs:
        lines.append(
            f"| {run.number} | {_fmt(run.wall_seconds)} | {_fmt(run.render_seconds)} | "
            f"{_fmt(run.audio_seconds)} | {_fmt(run.rtf)} |"
        )
    warm = [run for run in runs[1:] if run.rtf is not None]
    warm_rtf = sum(run.rtf for run in warm) / len(warm) if warm else None
    lines += [
        "",
        "Summary for the test plan (first run includes loading the model):",
        f"| {info.get('engine')} | {where} | first {_fmt(runs[0].wall_seconds, 1)} s | "
        f"warm {_fmt(runs[-1].wall_seconds, 1)} s | warm RTF {_fmt(warm_rtf)} |",
    ]
    return "\n".join(lines)


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", default=DEFAULT_BASE, help=f"backend address (default {DEFAULT_BASE})")
    parser.add_argument("--engine", help="engine id, e.g. omnivoice-gguf or omnivoice (default: the active one)")
    parser.add_argument("--runs", type=int, default=3, help="number of generations (default 3)")
    parser.add_argument("--text", default=DEFAULT_TEXT, help="sentence to speak")
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED, help="fixed seed so runs are comparable")
    parser.add_argument("--timeout", type=float, default=900.0, help="seconds to wait for one generation")
    parser.add_argument("--save-dir", type=Path, help="also save each run's WAV here for listening")
    parser.add_argument("--json", action="store_true", help="print machine-readable results instead")
    args = parser.parse_args(argv)
    if args.runs < 1:
        parser.error("--runs must be at least 1")
    try:
        info = describe_engine(args.base, args.engine)
        runs = []
        for number in range(1, args.runs + 1):
            print(f"Generating {number} of {args.runs}…", file=sys.stderr, flush=True)
            runs.append(generate_once(args.base, number, args.text, args.engine, args.seed,
                                      args.timeout, args.save_dir))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        print(f"The backend refused the request ({error.code}): {detail}", file=sys.stderr)
        return 1
    except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
        print(f"Could not reach RedVoice at {args.base} ({error}). Start it with `bun run dev` "
              "and try again. If Windows reserved port 3900, RedVoice uses the next free port: "
              "pass it with --base http://127.0.0.1:<port>.", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps({"info": info, "runs": [dict(asdict(run), rtf=run.rtf) for run in runs]},
                         indent=2))
    else:
        print(report(info, runs))
    return 0


if __name__ == "__main__":
    sys.exit(main())
