#!/usr/bin/env python3
# Remote TTS service: a tiny HTTP server that exposes the local macOS
# `say` binary over JSON. Designed to run on a SECOND Mac (the MacBook
# Air physically next to the Android phone) so the voice bench can
# survive F41 wedges on the primary Mac mini.
#
# Usage on the MacBook Air:
#   python3 scripts/matika-tts-server.py [PORT]
#
#   Default port: 8765. Bind address: 0.0.0.0 (LAN-only assumption — no
#   auth; place behind a trusted network or an SSH tunnel if exposing
#   over the internet).
#
# Endpoints:
#   GET  /health
#     -> 200 {"ok": true, "voices": [...]}  cheap liveness probe.
#
#   POST /say
#     body: {"lang": "en"|"hi", "rate": 165, "text": "Hello"}
#     -> 200 {"rc": 0, "duration_ms": 1234}  on success
#     -> 400/500 with {"error": "..."}        on failure
#     Blocks until `say` returns; client uses that to advance the turn.
#
# Bengali (bn) is not supported here — macOS has no native bn voice.
# Drive bn turns via the existing MATIKA_BN_AUDIO file path on the
# primary mac instead (or stage the audio file on the air and add a
# /play endpoint later).

import json
import shutil
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

VOICES = {"en": "Rishi", "hi": "Lekha"}
SAY_TIMEOUT_S = 30


class TtsHandler(BaseHTTPRequestHandler):
    server_version = "MatikaTTS/1.0"

    def _json(self, code, body):
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "voices": sorted(VOICES.keys())})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/say":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length).decode())
        except (ValueError, json.JSONDecodeError) as exc:
            self._json(400, {"error": f"bad json: {exc}"})
            return

        lang = body.get("lang")
        rate = body.get("rate")
        text = body.get("text")
        if lang not in VOICES:
            self._json(400, {"error": f"unsupported lang '{lang}' (en|hi)"})
            return
        if not isinstance(rate, int) or not 80 <= rate <= 300:
            self._json(400, {"error": "rate must be int 80..300"})
            return
        if not isinstance(text, str) or not text.strip():
            self._json(400, {"error": "text required"})
            return

        voice = VOICES[lang]
        sys.stderr.write(
            f"[say] lang={lang} rate={rate} voice={voice} len={len(text)} text={text!r}\n"
        )
        sys.stderr.flush()
        t0 = time.time()
        try:
            result = subprocess.run(
                ["say", "-v", voice, "-r", str(rate), text],
                timeout=SAY_TIMEOUT_S,
                capture_output=True,
            )
        except subprocess.TimeoutExpired:
            self._json(500, {"error": f"say timed out after {SAY_TIMEOUT_S}s — local Core Audio may be wedged"})
            return
        except FileNotFoundError:
            self._json(500, {"error": "`say` not found on this host"})
            return
        elapsed_ms = int((time.time() - t0) * 1000)
        if result.returncode != 0:
            self._json(
                500,
                {
                    "error": "say failed",
                    "rc": result.returncode,
                    "stderr": result.stderr.decode(errors="replace")[-500:],
                    "duration_ms": elapsed_ms,
                },
            )
            return
        self._json(200, {"rc": 0, "duration_ms": elapsed_ms})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.address_string()}] {fmt % args}\n")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    if not shutil.which("say"):
        sys.exit("ERROR: `say` binary not found — this must run on macOS")
    bind = ("0.0.0.0", port)
    sys.stderr.write(f"matika-tts-server listening on http://{bind[0]}:{bind[1]} (voices: {sorted(VOICES.keys())})\n")
    sys.stderr.flush()
    HTTPServer(bind, TtsHandler).serve_forever()


if __name__ == "__main__":
    main()
