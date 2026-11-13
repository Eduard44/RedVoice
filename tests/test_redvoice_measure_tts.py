"""scripts/redvoice/measure_tts.py against a fake backend that answers like the real one."""
from __future__ import annotations

import io
import json
import runpy
import threading
import wave
from contextlib import redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
measure = runpy.run_path(str(ROOT / "scripts/redvoice/measure_tts.py"))


def _wav() -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(24000)
        out.writeframes(b"\0\0" * 2400)
    return buffer.getvalue()


@pytest.fixture()
def backend():
    seen: list[dict] = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # keep test output quiet
            pass

        def _json(self, payload):
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/engines":
                self._json({"tts": {"active": "omnivoice-gguf", "backends": [
                    {"id": "omnivoice-gguf", "effective_device": "vulkan"}]}})
            elif self.path == "/engines/omnivoice-gguf/quants":
                self._json({"hardware": {"gpu_name": "AMD Radeon RX 9070 XT", "device": "Vulkan0"},
                            "selected": "Q8_0", "in_use": "Q8_0"})
            else:
                self.send_error(404)

        def do_POST(self):
            length = int(self.headers["Content-Length"])
            body = self.rfile.read(length).decode()
            seen.append({"path": self.path, "body": body,
                         "csrf": self.headers.get("X-VoiceStudio-CSRF")})
            audio = _wav()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("X-Gen-Time", "0.5" if len(seen) > 1 else "4.0")
            self.send_header("X-Audio-Duration", "2.0")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", seen
    server.shutdown()


def test_reports_engine_device_and_warm_speed(backend):
    base, seen = backend
    out = io.StringIO()
    with redirect_stdout(out):
        assert measure["main"](["--base", base, "--runs", "3"]) == 0
    text = out.getvalue()
    assert "Engine: omnivoice-gguf  Device: AMD Radeon RX 9070 XT  Quant: Q8_0" in text
    # Run 1 renders 4.0 s for 2.0 s of audio; warm runs 0.5 s.
    assert "| 1 |" in text and "| 2.00 |" in text
    assert "warm RTF 0.25" in text
    assert len(seen) == 3 and all(entry["path"] == "/generate" for entry in seen)
    assert all('name="seed"\r\n\r\n1234' in entry["body"] for entry in seen)
    assert all(entry["csrf"] == "1" for entry in seen)


def test_names_the_engine_and_saves_takes(backend, tmp_path):
    base, seen = backend
    with redirect_stdout(io.StringIO()) as out:
        assert measure["main"](["--base", base, "--runs", "2", "--engine", "omnivoice-gguf",
                                "--save-dir", str(tmp_path), "--json"]) == 0
    data = json.loads(out.getvalue())
    assert data["info"]["gpu"] == "AMD Radeon RX 9070 XT"
    assert [run["rtf"] for run in data["runs"]] == [2.0, 0.25]
    assert sorted(path.name for path in tmp_path.iterdir()) == ["run-01.wav", "run-02.wav"]
    assert all('name="engine"\r\n\r\nomnivoice-gguf' in entry["body"] for entry in seen)


def test_explains_how_to_start_the_app_when_nothing_answers(capsys):
    assert measure["main"](["--base", "http://127.0.0.1:9", "--runs", "1"]) == 1
    assert "Start it with `bun run dev`" in capsys.readouterr().err


def test_rejects_zero_runs():
    with pytest.raises(SystemExit):
        measure["main"](["--runs", "0"])
