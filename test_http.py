#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the bridge's HTTP surface.

The bridge serves plain HTTP on the SAME port as the WebSocket, so "is it
running?" can be answered by opening a URL - no extension, no tooling, no
websocket client. That matters because for most of this session the only way to
check the bridge was to load the extension and read a status dot.

The risk in sharing a port is that the HTTP handler swallows a WebSocket
upgrade and breaks the extension, so that is asserted here too.

Run:  python3 test_http.py
"""
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        print("PASS ", name)
        passed += 1
    else:
        print("FAIL ", name, ("\n      " + str(extra)) if extra else "")
        failed += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


CONFIG = {
    "target": {"id": "t", "kind": "generic", "name": "test target", "short": "test"},
    "servers": {"t": {"type": "script", "tools": [
        {"name": "ping", "run": ["echo", "pong"]}]}},
}


def start(port, env_extra=None):
    d = tempfile.mkdtemp()
    for f in ("bridge.py", "script_server.py"):
        shutil.copy(os.path.join(HERE, f), d)
    with open(os.path.join(d, "config.json"), "w") as f:
        json.dump(CONFIG, f)
    env = dict(os.environ)
    for k in ("ZS_BRIDGE_HOST", "ZS_BRIDGE_TOKEN", "PORT"):
        env.pop(k, None)
    env["ZS_BRIDGE_PORT"] = str(port)
    env["ZS_WORKSPACE"] = d
    env.update(env_extra or {})
    log = open(os.path.join(d, "out.log"), "w")
    p = subprocess.Popen([sys.executable, "bridge.py"], cwd=d, env=env,
                         stdout=log, stderr=log, stdin=subprocess.DEVNULL)
    for _ in range(40):
        time.sleep(0.5)
        try:
            get(port, "/healthz")
            break
        except Exception:
            if p.poll() is not None:
                break
    return p, d


def get(port, path, token=None, header_token=None):
    url = f"http://127.0.0.1:{port}{path}"
    if token:
        url += ("&" if "?" in url else "?") + "token=" + token
    req = urllib.request.Request(url)
    if header_token:
        req.add_header("Authorization", "Bearer " + header_token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode("utf-8", "replace"), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), e.headers.get("Content-Type", "")


def stop(p):
    try:
        p.terminate(); p.wait(timeout=8)
    except Exception:
        try: p.kill()
        except Exception: pass


# ── local mode: no token needed ────────────────────────────────────────────
port = free_port()
proc, _ = start(port)
try:
    code, body, ctype = get(port, "/healthz")
    ok("/healthz answers 200", code == 200, code)
    ok("/healthz is JSON with a version", '"version"' in body, body[:80])

    code, body, ctype = get(port, "/")
    ok("/ answers 200", code == 200, code)
    ok("/ is HTML for a human", "text/html" in ctype, ctype)
    ok("/ names the bridge", "ZeroScript bridge" in body)
    ok("/ shows the target", "test target" in body, body[:200])

    code, body, _ = get(port, "/status")
    ok("/status answers 200 locally", code == 200, code)
    d = json.loads(body)
    ok("/status is machine-readable", d.get("service") == "zeroscript-bridge", d)
    ok("/status lists servers", isinstance(d.get("servers"), list) and d["servers"], d)
    ok("/status reports the tool count", d.get("tools", 0) >= 1, d.get("tools"))

    code, _, _ = get(port, "/nope")
    ok("an unknown path is 404", code == 404, code)

    # The whole point of sharing a port: the extension must still connect.
    check = f'''
import asyncio, json, websockets
async def m():
    async with websockets.connect("ws://127.0.0.1:{port}", open_timeout=8) as ws:
        h = json.loads(await ws.recv())
        await ws.send(json.dumps({{"type":"call_tool","id":1,"name":"ping",
                                   "arguments":{{}},"timeout":10000}}))
        while True:
            r = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if r.get("type") == "tool_result":
                print("WSOK", h["type"], r["ok"], (r.get("text") or "").strip()); return
asyncio.run(m())
'''
    r = subprocess.run([sys.executable, "-c", check], capture_output=True, text=True, timeout=60)
    ok("the WebSocket still works on the same port", "WSOK connected True pong" in r.stdout,
       (r.stdout + r.stderr)[-200:])
finally:
    stop(proc)

# ── remote mode: token required, health stays open ─────────────────────────
port = free_port()
tok = secrets.token_urlsafe(32)
proc, _ = start(port, {"ZS_BRIDGE_HOST": "0.0.0.0", "ZS_BRIDGE_TOKEN": tok})
try:
    code, _, _ = get(port, "/healthz")
    ok("/healthz stays open without a token", code == 200, code)

    code, body, _ = get(port, "/status")
    ok("/status is 401 without a token", code == 401, code)
    ok("the 401 explains how to authenticate", "token" in body.lower(), body[:120])

    code, _, _ = get(port, "/status", token=tok)
    ok("/status accepts ?token=", code == 200, code)

    code, _, _ = get(port, "/status", header_token=tok)
    ok("/status accepts Authorization: Bearer", code == 200, code)

    code, _, _ = get(port, "/status", token="wrong-token-0123456789")
    ok("a wrong token is rejected", code == 401, code)
finally:
    stop(proc)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
