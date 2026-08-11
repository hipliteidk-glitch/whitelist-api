#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the no-MCP (plain command) tool layer.

Run:  python3 test_script_server.py
"""
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from script_server import (ScriptClient, ScriptTool, looks_like_script_spec)

passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        print("PASS ", name); passed += 1
    else:
        print("FAIL ", name, ("\n      " + str(extra)) if extra else ""); failed += 1


def raises(fn, substr=""):
    try:
        fn()
        return False
    except Exception as e:
        return substr.lower() in str(e).lower()


tmp = tempfile.mkdtemp()
note = os.path.join(tmp, "note.txt")
with open(note, "w") as f:
    f.write("hello no-mcp")

# ── spec detection ─────────────────────────────────────────────────────────
ok("type:script is a script spec", looks_like_script_spec({"type": "script", "tools": []}))
ok("tools without command is a script spec", looks_like_script_spec({"tools": [{"name": "a"}]}))
ok("an MCP entry is NOT a script spec",
   not looks_like_script_spec({"command": "uvx", "args": ["blender-mcp"]}))
ok("a non-dict is not a script spec", not looks_like_script_spec("nope"))

# ── schema generation ──────────────────────────────────────────────────────
t = ScriptTool({"name": "ls", "description": "list", "run": ["ls", "{path}"],
                "params": {"path": {"type": "string", "required": True},
                           "extra": "an optional thing"}})
sch = t.schema()
ok("schema has the tool name", sch["name"] == "ls")
ok("schema marks required params", sch["inputSchema"].get("required") == ["path"])
ok("string param shorthand expands",
   sch["inputSchema"]["properties"]["extra"]["type"] == "string" and
   sch["inputSchema"]["properties"]["extra"]["description"] == "an optional thing")
ok("'required' is not leaked into the property",
   "required" not in sch["inputSchema"]["properties"]["path"])

# ── argv building / injection safety ───────────────────────────────────────
argv, _ = t.build_argv({"path": "/tmp/a b"})
ok("a spacey path stays ONE argv entry", argv == ["ls", "/tmp/a b"], argv)
argv, _ = t.build_argv({"path": "x; rm -rf /"})
ok("shell metacharacters stay one literal arg", argv == ["ls", "x; rm -rf /"], argv)
argv, _ = ScriptTool({"name": "g", "run": ["grep", "--path={path}"],
                      "params": {"path": "p"}}).build_argv({"path": "/etc"})
ok("inline placeholder substitutes", argv == ["grep", "--path=/etc"], argv)
argv, _ = ScriptTool({"name": "m", "run": ["echo", "{items}"],
                      "params": {"items": "list"}}).build_argv({"items": ["a", "b"]})
ok("a list argument expands to several argv entries", argv == ["echo", "a", "b"], argv)
argv, _ = ScriptTool({"name": "o", "run": ["ls", "{missing}"],
                      "params": {"missing": "x"}}).build_argv({})
ok("omitted optional placeholder is dropped", argv == ["ls"], argv)

# ── validation ─────────────────────────────────────────────────────────────
ok("a tool with no name is rejected", raises(lambda: ScriptTool({"run": ["ls"]}), "name"))
ok("a tool with no run is rejected", raises(lambda: ScriptTool({"name": "x"}), "run"))
ok("a bare string run needs shell:true",
   raises(lambda: ScriptTool({"name": "x", "run": "ls -la"}), "must be a LIST"))
ok("a string run IS allowed with shell:true",
   ScriptTool({"name": "x", "run": "ls -la", "shell": True}).shell is True)

# ── execution through the client ───────────────────────────────────────────
client = ScriptClient("shell", {"type": "script", "tools": [
    {"name": "read_file", "description": "cat", "run": ["cat", "{path}"],
     "params": {"path": "file"}},
    {"name": "fail", "run": ["cat", "/definitely/not/here"]},
    {"name": "nocmd", "run": ["this-command-does-not-exist-xyz"]},
    {"name": "quiet", "run": ["true"]},
]})
client.start()
ok("client reports alive with valid tools", client.is_alive())
ok("client advertises every tool", len(client.tools_cache) == 4)
res = client.call_tool("read_file", {"path": note}, 10)
ok("a tool returns its stdout", res["text"] == "hello no-mcp", res)
ok("result carries an empty images list", res["images"] == [])
ok("a non-zero exit raises with detail",
   raises(lambda: client.call_tool("fail", {}, 10), "No such file"))
ok("a missing binary is a clear error",
   raises(lambda: client.call_tool("nocmd", {}, 10), "command not found"))
ok("silent success still returns text",
   "no output" in client.call_tool("quiet", {}, 10)["text"])
ok("an unknown tool raises",
   raises(lambda: client.call_tool("ghost", {}, 10), "unknown tool"))

# a shell-injection attempt must NOT spawn a second command
marker = os.path.join(tmp, "PWNED")
try:
    client.call_tool("read_file", {"path": f"{note}; touch {marker}"}, 10)
except Exception:
    pass
ok("injection via an argument does not run a second command", not os.path.exists(marker))

# ── timeout + degenerate config ────────────────────────────────────────────
slow = ScriptClient("s", {"type": "script", "tools": [
    {"name": "sleeper", "run": ["sleep", "5"], "timeout": 1}]})
slow.start()
ok("a slow tool times out", raises(lambda: slow.call_tool("sleeper", {}, 1), "timed out"))

empty = ScriptClient("e", {"type": "script", "tools": []})
empty.start()
ok("a server with no tools is not alive", not empty.is_alive())

bad = ScriptClient("b", {"type": "script", "tools": [{"run": ["ls"]}]})
bad.start()
ok("an invalid tool is reported via start_error", bool(bad.start_error))

# ── image-returning tools ──────────────────────────────────────────────────
import base64 as _b64
_png = _b64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxV"
    "SF+FABJADveWkH6oAAAAAElFTkSuQmCC")
_img = os.path.join(tmp, "shot.png")
with open(_img, "wb") as f:
    f.write(_png)

icl = ScriptClient("cam", {"type": "script", "tools": [
    {"name": "shot", "returns": "image", "image_path": _img,
     "run": ["echo", "captured"]},
    {"name": "missing", "returns": "image",
     "image_path": os.path.join(tmp, "nope.png"), "run": ["echo", "nothing"]},
    {"name": "nopath", "returns": "image", "run": ["echo", "x"]},
]})
icl.start()
res = icl.call_tool("shot", {}, 10)
ok("an image tool returns one image", len(res["images"]) == 1, res)
ok("image is base64 of the real file",
   _b64.b64decode(res["images"][0]["data"]) == _png)
ok("PNG is detected as image/png", res["images"][0]["mimeType"] == "image/png")
ok("image tool keeps its stdout as text", "captured" in res["text"])
ok("a declared image that was not produced errors clearly",
   raises(lambda: icl.call_tool("missing", {}, 10), "did not produce an image"))
ok("an image tool with no image_path errors clearly",
   raises(lambda: icl.call_tool("nopath", {}, 10), "image_path"))

# a text tool must still return the old shape
ok("text tools still return an empty images list",
   client.call_tool("read_file", {"path": note}, 10)["images"] == [])

# a RELATIVE image_path must resolve against the tool's cwd, not the bridge dir
_rel = ScriptClient("rel", {"type": "script", "tools": [
    {"name": "show", "params": {"path": "p"}, "returns": "image",
     "image_path": "{path}", "cwd": tmp, "run": ["echo", "ok"]}]})
_rel.start()
_relres = _rel.call_tool("show", {"path": "shot.png"}, 10)
ok("a relative image_path resolves against cwd", len(_relres["images"]) == 1, _relres)

# ── timeout hygiene (from a live Railway log: "timed out after 120.0s" at 238.7s) ──
import subprocess as _sp
import threading as _th

# A timed-out tool must not leave background grandchildren running. Plain
# subprocess.run() kills only the direct child.
_spawner = ScriptClient("sp", {"type": "script", "tools": [
    {"name": "spawner", "run": ["sh", "-c", "sleep 97 & sleep 97"], "timeout": 2}]})
_spawner.start()
try:
    _spawner.call_tool("spawner", {}, 2)
except Exception:
    pass
time.sleep(1)
_left = _sp.run(["pgrep", "-fc", "sleep 97"], capture_output=True, text=True).stdout.strip()
ok("a timed-out tool leaves no orphaned grandchildren", _left in ("", "0"), f"{_left} left")
_sp.run(["pkill", "-f", "sleep 97"], capture_output=True)

ok("the timeout message says the tool was stopped",
   raises(lambda: _spawner.call_tool("spawner", {}, 2), "was stopped"))
ok("the timeout message explains how to fix it",
   raises(lambda: _spawner.call_tool("spawner", {}, 2), "timeout"))
_sp.run(["pkill", "-f", "sleep 97"], capture_output=True)

# Calls are serialised, so a queued call's WALL time exceeds its own timeout.
# The error must say so, or it reads as a broken timeout in the bridge log.
_q = ScriptClient("q", {"type": "script", "tools": [
    {"name": "slow", "run": ["sleep", "20"], "timeout": 3}]})
_q.start()
_msgs = {}


def _run_q(i):
    try:
        _q.call_tool("slow", {}, 3)
    except Exception as e:
        _msgs[i] = str(e)


_threads = [_th.Thread(target=_run_q, args=(i,)) for i in (1, 2)]
for t in _threads:
    t.start()
for t in _threads:
    t.join()
ok("the first call has no queue note", "queue" not in _msgs.get(1, ""))
ok("a queued call reports its wait", "queue" in _msgs.get(2, ""), _msgs.get(2, "")[-90:])
_sp.run(["pkill", "-f", "sleep 20"], capture_output=True)

# ── MCPClient duck-type compatibility ──────────────────────────────────────
for attr in ("id", "tools_cache", "call_lock", "start", "is_alive", "restart",
             "stop", "refresh_tools", "call_tool", "last_exit", "stderr_tail",
             "restart_times", "loop_warned_at", "start_error",
             "saw_foreign_ws_host", "proc"):
    ok(f"duck-type: has .{attr}", hasattr(client, attr))

ok("probe_text returns text for a runnable probe",
   ScriptClient("p", {"type": "script", "tools": [
       {"name": "ping", "run": ["echo", "pong"]}]}).__class__ is ScriptClient)
p = ScriptClient("p", {"type": "script", "tools": [{"name": "ping", "run": ["echo", "pong"]}]})
p.start()
ok("probe_text runs the probe tool", p.probe_text("ping") == "pong")
ok("probe_text on an unknown tool is None", p.probe_text("nope") is None)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
