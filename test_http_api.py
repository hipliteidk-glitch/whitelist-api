#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the bridge's HTTP API.

WHY THIS MATTERS
The WebSocket API can only be driven by the browser extension, so the bridge
was untestable from a terminal, from CI, or from any machine without Chrome -
which is exactly the situation that made every provider bug this session a
slow guess-and-check loop. The HTTP surface exposes the same calls, so the
whole stack can be verified with plain requests.

Everything here starts a REAL bridge on a free port and talks to it over HTTP.

Run:  python3 test_http_api.py
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
import urllib.parse
import urllib.request

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


CONFIG = {
    "target": {"id": "t", "kind": "generic", "name": "test", "short": "test"},
    "servers": {"t": {"type": "script", "tools": [
        {"name": "read_file", "params": {"path": "f"}, "cwd": "{ZS_WORKSPACE}",
         "run": ["cat", "{path}"]},
        {"name": "boom", "run": ["sh", "-c", "echo bad >&2; exit 3"]},
    ]}},
}


class Bridge:
    def __init__(self, port, env_extra=None):
        self.dir = tempfile.mkdtemp()
        self.ws = tempfile.mkdtemp()
        with open(os.path.join(self.ws, "note.txt"), "w") as f:
            f.write("hello over http")
        for fn in ("bridge.py", "script_server.py"):
            shutil.copy(os.path.join(HERE, fn), self.dir)
        with open(os.path.join(self.dir, "config.json"), "w") as f:
            json.dump(CONFIG, f)
        env = dict(os.environ)
        for k in ("ZS_BRIDGE_HOST", "ZS_BRIDGE_TOKEN", "PORT"):
            env.pop(k, None)
        env["ZS_WORKSPACE"] = self.ws
        env["ZS_BRIDGE_PORT"] = str(port)
        env.update(env_extra or {})
        self.log = open(os.path.join(self.dir, "out.log"), "w+")
        self.p = subprocess.Popen([PY, "bridge.py"], cwd=self.dir, env=env,
                                  stdout=self.log, stderr=self.log,
                                  stdin=subprocess.DEVNULL)
        self.port = port

    def wait(self, timeout=30):
        for _ in range(timeout * 2):
            try:
                get(self.port, "/healthz")
                return True
            except Exception:
                time.sleep(0.5)
        return False

    def stop(self):
        try:
            self.p.terminate(); self.p.wait(timeout=5)
        except Exception:
            try: self.p.kill()
            except Exception: pass
        shutil.rmtree(self.dir, ignore_errors=True)
        shutil.rmtree(self.ws, ignore_errors=True)


def get(port, path, token=None, timeout=20):
    url = f"http://127.0.0.1:{port}{path}"
    if token:
        url += ("&" if "?" in url else "?") + "token=" + token
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def call(port, name, args=None, token=None):
    q = urllib.parse.urlencode({"name": name, "args": json.dumps(args or {})})
    return get(port, f"/call?{q}", token=token)


# ── no auth (loopback) ─────────────────────────────────────────────────────
port = free_port()
b = Bridge(port)
ok("the bridge starts and answers HTTP", b.wait(), "never became reachable")

code, body = get(port, "/healthz")
ok("/healthz returns 200", code == 200, f"{code} {body[:80]}")
ok("/healthz reports a version", '"version"' in body, body[:80])

code, body = get(port, "/status")
ok("/status returns 200", code == 200, code)
st = json.loads(body)
ok("/status names the service", st.get("service") == "zeroscript-bridge", st)
ok("/status reports the target", st.get("target", {}).get("id") == "t", st.get("target"))
ok("/status lists servers", isinstance(st.get("servers"), list), st.get("servers"))

code, body = get(port, "/tools")
tools = json.loads(body)
ok("/tools lists the configured tools", tools.get("count") == 2, tools.get("count"))
ok("/tools includes the schema",
   any("inputSchema" in t for t in tools.get("tools", [])), tools)

code, body = call(port, "read_file", {"path": "note.txt"})
res = json.loads(body)
ok("/call runs a tool", code == 200 and res.get("ok"), body[:120])
ok("/call returns the tool's output", res.get("text") == "hello over http", res)

code, body = call(port, "boom")
res = json.loads(body)
ok("a failing tool returns 400", code == 400, code)
ok("and reports the error", res.get("ok") is False and "exit 3" in (res.get("error") or ""),
   res)

code, body = call(port, "nope")
ok("an unknown tool is reported", "unknown tool" in body, body[:100])

code, body = get(port, "/call")
ok("/call without a name returns 400", code == 400, code)
ok("and explains the usage", "usage" in body and "example" in body, body[:120])

code, body = get(port, "/call?name=read_file&args=notjson")
ok("invalid args JSON is reported", code == 400 and "valid JSON" in body, body[:120])

code, body = get(port, "/nope")
ok("an unknown route returns 404", code == 404, code)

code, body = get(port, "/")
ok("/ serves a human-readable page", code == 200 and "<h2>" in body, code)
b.stop()

# ── with a token ───────────────────────────────────────────────────────────
port = free_port()
tok = secrets.token_urlsafe(32)
b = Bridge(port, {"ZS_BRIDGE_TOKEN": tok})
ok("the bridge starts with a token", b.wait())

code, _ = get(port, "/healthz")
ok("/healthz stays open (a PaaS must poll it)", code == 200, code)

code, body = get(port, "/status")
ok("/status without a token is 401", code == 401, f"{code} {body[:60]}")
code, body = call(port, "read_file", {"path": "note.txt"})
ok("/call without a token is 401", code == 401, code)
code, body = call(port, "read_file", {"path": "note.txt"}, token="wrong-" + "x" * 20)
ok("a wrong token is 401", code == 401, code)

code, body = get(port, "/status", token=tok)
ok("/status with the token works", code == 200, code)
code, body = call(port, "read_file", {"path": "note.txt"}, token=tok)
ok("/call with the token works", code == 200 and json.loads(body).get("ok"), body[:100])
b.stop()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
