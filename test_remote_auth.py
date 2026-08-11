#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for remote-bridge support and its authentication gate.

The bridge executes commands, so exposing it off-loopback without working auth
would be a serious hole. These tests pin the guarantees:

  1. A public bind with no token REFUSES to start.
  2. A too-short token REFUSES to start.
  3. With a token: no token / wrong token are rejected, correct token works.
  4. The default (loopback, no token) is unchanged and needs no token.
  5. $PORT (Railway/PaaS) is honoured.

Run:  python3 test_remote_auth.py
"""
import json
import os
import secrets
import socket
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PY = sys.executable
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


def workspace():
    d = tempfile.mkdtemp()
    with open(os.path.join(d, "note.txt"), "w") as f:
        f.write("secret-data")
    return d


CONFIG = {
    "target": {"id": "t", "kind": "generic", "name": "test", "short": "test"},
    "servers": {"t": {"type": "script", "tools": [
        {"name": "read_file", "params": {"path": "f"},
         "cwd": "{ZS_WORKSPACE}", "run": ["cat", "{path}"]}]}},
}


def run_bridge(env_extra, wait=9):
    """Start the bridge in a temp dir; return (proc, stdout_text_so_far, dir)."""
    d = tempfile.mkdtemp()
    for f in ("bridge.py", "script_server.py"):
        with open(os.path.join(HERE, f)) as src, open(os.path.join(d, f), "w") as dst:
            dst.write(src.read())
    with open(os.path.join(d, "config.json"), "w") as f:
        json.dump(CONFIG, f)
    env = dict(os.environ)
    env.pop("ZS_BRIDGE_HOST", None)
    env.pop("ZS_BRIDGE_TOKEN", None)
    env.pop("PORT", None)
    env["ZS_WORKSPACE"] = workspace()
    env.update(env_extra)
    log = open(os.path.join(d, "out.log"), "w+")
    p = subprocess.Popen([PY, "bridge.py"], cwd=d, env=env, stdout=log, stderr=log,
                         stdin=subprocess.DEVNULL)
    time.sleep(wait)
    log.flush()
    with open(os.path.join(d, "out.log")) as f:
        return p, f.read(), d


def stop(p):
    try:
        p.terminate()
        p.wait(timeout=5)
    except Exception:
        try:
            p.kill()
        except Exception:
            pass


def try_connect(port, token=None, expect_tool=True):
    """Returns (connected, tool_text). Never raises."""
    code = f'''
import asyncio, json, sys, websockets
async def m():
    url = "ws://127.0.0.1:{port}"
    tok = {token!r}
    if tok: url += "/?token=" + tok
    async with websockets.connect(url, open_timeout=6) as ws:
        await asyncio.wait_for(ws.recv(), timeout=6)
        await ws.send(json.dumps({{"type":"call_tool","id":1,"name":"read_file",
                                   "arguments":{{"path":"note.txt"}},"timeout":8000}}))
        while True:
            r = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
            if r.get("type") == "tool_result":
                print("TOOLTEXT:" + (r.get("text") or "").strip()); return
asyncio.run(m())
'''
    r = subprocess.run([PY, "-c", code], capture_output=True, text=True, timeout=40)
    if r.returncode != 0:
        return False, ""
    for line in r.stdout.splitlines():
        if line.startswith("TOOLTEXT:"):
            return True, line[len("TOOLTEXT:"):]
    return True, ""


# ── 1. public bind, no token -> refuse ─────────────────────────────────────
p, out, _ = run_bridge({"ZS_BRIDGE_HOST": "0.0.0.0", "ZS_BRIDGE_PORT": str(free_port())}, wait=5)
ok("public bind without a token refuses to start",
   "refusing to start" in out and p.poll() is not None, out[-300:])
stop(p)

# ── 2. weak token -> refuse ────────────────────────────────────────────────
p, out, _ = run_bridge({"ZS_BRIDGE_HOST": "0.0.0.0", "ZS_BRIDGE_PORT": str(free_port()),
                        "ZS_BRIDGE_TOKEN": "short"}, wait=5)
ok("a token under 16 chars refuses to start",
   "refusing to start" in out and p.poll() is not None, out[-300:])
stop(p)

# ── 3. auth enforcement ────────────────────────────────────────────────────
tok = secrets.token_urlsafe(32)
port = free_port()
p, out, _ = run_bridge({"ZS_BRIDGE_HOST": "0.0.0.0", "ZS_BRIDGE_PORT": str(port),
                        "ZS_BRIDGE_TOKEN": tok})
ok("remote mode announces token auth", "REMOTE MODE" in out, out[-300:])
conn, _ = try_connect(port, None)
ok("remote: a client with NO token is rejected", not conn)
conn, _ = try_connect(port, "wrong-token-0123456789abcdef")
ok("remote: a client with a WRONG token is rejected", not conn)
conn, text = try_connect(port, tok)
ok("remote: the correct token connects and runs a tool", conn and text == "secret-data",
   f"connected={conn} text={text!r}")
stop(p)

# ── 4. default loopback unchanged ──────────────────────────────────────────
port = free_port()
p, out, _ = run_bridge({"ZS_BRIDGE_PORT": str(port)})
ok("default bind stays loopback", "127.0.0.1" in out and "REMOTE MODE" not in out, out[-300:])
conn, text = try_connect(port, None)
ok("local client needs no token (no regression)", conn and text == "secret-data",
   f"connected={conn} text={text!r}")
stop(p)

# ── 5. $PORT honoured (Railway/PaaS) ───────────────────────────────────────
port = free_port()
tok = secrets.token_urlsafe(32)
p, out, _ = run_bridge({"PORT": str(port), "ZS_BRIDGE_HOST": "0.0.0.0",
                        "ZS_BRIDGE_TOKEN": tok})
ok("$PORT is used when ZS_BRIDGE_PORT is unset", f":{port}" in out, out[-300:])
conn, text = try_connect(port, tok)
ok("PaaS-style deploy serves tools", conn and text == "secret-data",
   f"connected={conn} text={text!r}")
stop(p)

# ── HTTP on the same port ──────────────────────────────────────────────────
# A WebSocket-only server answers a plain GET with 426, which every PaaS health
# check reads as DOWN - the container is then killed and restarted in a loop.
import urllib.request
import urllib.error


def http(port, path, token=None, header=False):
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url)
    if token and not header:
        url += ("&" if "?" in path else "?") + "token=" + token
        req = urllib.request.Request(url)
    if token and header:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return 0, str(e)


port = free_port()
p, out, _ = run_bridge({"ZS_BRIDGE_PORT": str(port)})
code, body = http(port, "/healthz")
ok("GET /healthz returns 200 (not 426)", code == 200, f"{code} {body[:80]}")
ok("/healthz reports a version", '"version"' in body, body[:80])
code, body = http(port, "/status")
ok("GET /status works locally without a token", code == 200, f"{code} {body[:80]}")
ok("/status reports the tool count", '"tools"' in body, body[:120])
code, body = http(port, "/")
ok("GET / serves a human-readable page", code == 200 and "<title>" in body, str(code))
code, _ = http(port, "/nope")
ok("an unknown path 404s", code == 404, str(code))
stop(p)

# remote: everything except /healthz must require the token
tok = secrets.token_urlsafe(32)
port = free_port()
p, out, _ = run_bridge({"ZS_BRIDGE_HOST": "0.0.0.0", "ZS_BRIDGE_PORT": str(port),
                        "ZS_BRIDGE_TOKEN": tok})
code, body = http(port, "/healthz")
ok("remote /healthz stays public for PaaS probes", code == 200, str(code))
ok("remote /healthz leaks nothing but liveness",
   "servers" not in body and "tools" not in body, body[:100])
code, _ = http(port, "/status")
ok("remote /status without a token is 401", code == 401, str(code))
code, _ = http(port, "/status", token="wrong-token-0123456789")
ok("remote /status with a wrong token is 401", code == 401, str(code))
code, body = http(port, "/status", token=tok)
ok("remote /status with the right token is 200", code == 200, str(code))
code, _ = http(port, "/status", token=tok, header=True)
ok("Authorization: Bearer also works", code == 200, str(code))
stop(p)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
