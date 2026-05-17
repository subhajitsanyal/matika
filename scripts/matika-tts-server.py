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
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

# Native macOS voices via `say`. en/hi work out of the box.
NATIVE_VOICES = {"en": "Rishi", "hi": "Lekha"}

# gTTS endpoint for languages macOS doesn't ship (notably bn-IN).
# Google's translate_tts endpoint accepts a `tl` (target language)
# code and returns MP3 bytes. We download the MP3 to a tempfile and
# play it via afplay, which works regardless of the wedge state of
# the primary Mac mini's `say` queue (afplay is a separate path).
# Languages here MUST NOT overlap with NATIVE_VOICES — say is
# preferred when available because it doesn't require network.
GTTS_LANGS = {"bn": "bn-IN"}

SAY_TIMEOUT_S = 30
GTTS_TIMEOUT_S = 15
GTTS_URL_TEMPLATE = "https://translate.google.com/translate_tts?ie=UTF-8&q={q}&tl={tl}&client=tw-ob"


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
            self._json(
                200,
                {
                    "ok": True,
                    "voices": sorted(NATIVE_VOICES.keys()),
                    "gtts_langs": sorted(GTTS_LANGS.keys()),
                },
            )
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
        if lang not in NATIVE_VOICES and lang not in GTTS_LANGS:
            supported = sorted(set(NATIVE_VOICES) | set(GTTS_LANGS))
            self._json(400, {"error": f"unsupported lang '{lang}' ({'|'.join(supported)})"})
            return
        if not isinstance(rate, int) or not 80 <= rate <= 300:
            self._json(400, {"error": "rate must be int 80..300"})
            return
        if not isinstance(text, str) or not text.strip():
            self._json(400, {"error": "text required"})
            return

        if lang in NATIVE_VOICES:
            elapsed_ms, err = self._say_native(lang, rate, text)
        else:
            elapsed_ms, err = self._say_gtts(lang, text)
        if err is not None:
            self._json(500, err)
            return
        self._json(200, {"rc": 0, "duration_ms": elapsed_ms})

    def _say_native(self, lang, rate, text):
        """Speak via macOS `say`. Returns (elapsed_ms, error_dict_or_None)."""
        voice = NATIVE_VOICES[lang]
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
            return 0, {"error": f"say timed out after {SAY_TIMEOUT_S}s — local Core Audio may be wedged"}
        except FileNotFoundError:
            return 0, {"error": "`say` not found on this host"}
        elapsed_ms = int((time.time() - t0) * 1000)
        if result.returncode != 0:
            return elapsed_ms, {
                "error": "say failed",
                "rc": result.returncode,
                "stderr": result.stderr.decode(errors="replace")[-500:],
                "duration_ms": elapsed_ms,
            }
        return elapsed_ms, None

    def _say_gtts(self, lang, text):
        """
        Speak via Google translate_tts → MP3 → afplay. No `gtts` pip
        package required — we hit the public translate_tts endpoint
        directly (same one gTTS uses internally). The User-Agent
        spoof is what gTTS does to avoid the 403 you get on a
        default urllib UA. afplay is a separate Core Audio path from
        `say` so it survives the `say`-queue wedge that F41 describes.
        """
        tl = GTTS_LANGS[lang]
        sys.stderr.write(f"[gtts] lang={lang} tl={tl} len={len(text)} text={text!r}\n")
        sys.stderr.flush()
        url = GTTS_URL_TEMPLATE.format(q=urllib.parse.quote(text), tl=urllib.parse.quote(tl))
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        try:
            with urllib.request.urlopen(req, timeout=GTTS_TIMEOUT_S) as resp:
                mp3_bytes = resp.read()
        except Exception as exc:
            return 0, {"error": f"gtts fetch failed: {exc}"}
        if not mp3_bytes:
            return 0, {"error": "gtts returned empty body"}
        tmp = tempfile.NamedTemporaryFile(prefix="matika-gtts-", suffix=".mp3", delete=False)
        try:
            tmp.write(mp3_bytes)
            tmp.flush()
            tmp.close()
            t0 = time.time()
            try:
                result = subprocess.run(
                    ["afplay", tmp.name],
                    timeout=SAY_TIMEOUT_S,
                    capture_output=True,
                )
            except subprocess.TimeoutExpired:
                return 0, {"error": f"afplay hung — Core Audio may be wedged"}
            elapsed_ms = int((time.time() - t0) * 1000)
            if result.returncode != 0:
                return elapsed_ms, {
                    "error": "afplay failed",
                    "rc": result.returncode,
                    "stderr": result.stderr.decode(errors="replace")[-500:],
                    "duration_ms": elapsed_ms,
                }
            return elapsed_ms, None
        finally:
            try:
                os.unlink(tmp.name)
            except OSError:
                pass

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
