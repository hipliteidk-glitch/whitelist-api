# SPDX-License-Identifier: GPL-3.0-or-later
# script_server.py
# ──────────────────────────────────────────────────────────────────────────
#  "No MCP" tools for the ZeroScript bridge.
#
#  Upstream ZeroScript can only talk to MCP servers: every target must speak
#  JSON-RPC over stdio (initialize / tools/list / tools/call). That is a lot of
#  ceremony when all you want is "let the AI run these three commands".
#
#  A ScriptClient lets you declare tools DIRECTLY in config.json as ordinary
#  shell commands. No MCP server, no JSON-RPC, no protocol to implement:
#
#    "servers": {
#      "shell": {
#        "type": "script",
#        "tools": [
#          {
#            "name": "list_files",
#            "description": "List files in a folder.",
#            "params": {"path": {"type": "string", "description": "folder"}},
#            "run": ["ls", "-la", "{path}"]
#          }
#        ]
#      }
#    }
#
#  It is deliberately duck-type compatible with MCPClient, so MCPManager, the
#  status probes and the WebSocket API cannot tell the difference - a script
#  server and a real MCP server can even run side by side.
#
#  SAFETY: "run" is a LIST (argv), executed WITHOUT a shell, so there is no
#  string interpolation into `sh -c` and therefore no shell-injection surface
#  from a model-supplied argument. A placeholder only ever becomes ONE argv
#  element. If you genuinely want a shell pipeline, set "shell": true on that
#  tool and accept the risk - it is off by default.
# ──────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import base64
import json
import os
import re
import signal
import subprocess
import threading
import time

# Placeholder syntax in a "run" entry: {param_name}
_PLACEHOLDER_OPEN = "{"
_PLACEHOLDER_CLOSE = "}"

DEFAULT_TIMEOUT = 60
MAX_OUTPUT = 60000  # chars of combined stdout/stderr handed back to the model
# Cap on an image handed to the model. Base64 inflates by ~4/3 and the bridge's
# WebSocket frame limit is 16MB, so keep well clear of it.
MAX_IMAGE_BYTES = 4 * 1024 * 1024


def _substitute(token: str, args: dict, used: set):
    """Replace {name} placeholders in ONE argv token.

    Returns the token with placeholders filled. A token that is exactly one
    placeholder ("{path}") and whose value is a list expands to several argv
    entries; the caller flattens that. Missing values become "".
    """
    if (token.startswith(_PLACEHOLDER_OPEN) and token.endswith(_PLACEHOLDER_CLOSE)
            and token.count(_PLACEHOLDER_OPEN) == 1):
        key = token[1:-1]
        used.add(key)
        if key in args:
            val = args[key]
            if isinstance(val, list):
                return [str(v) for v in val]
            return [str(val)]
        # Not a tool parameter: fall back to the ENVIRONMENT, so a config can
        # reference {ZS_APP_DIR} / {HOME} to locate a helper script without
        # hardcoding a machine-specific path. Env values are set by the user
        # who started the bridge, never by the model, so this adds no
        # model-controlled input. Unknown names become "" as before.
        if key in os.environ:
            return [os.environ[key]]
        return [""]
    # Inline placeholders inside a bigger token, e.g. "--path={path}" or
    # "{ZS_APP_DIR}/helper.sh".
    out = token
    for key, val in args.items():
        needle = _PLACEHOLDER_OPEN + key + _PLACEHOLDER_CLOSE
        if needle in out:
            used.add(key)
            out = out.replace(needle, "" if val is None else str(val))
    # Any placeholder still unfilled may name an environment variable (same
    # rationale as the whole-token case: env is set by whoever launched the
    # bridge, never by the model). Only substitute names that actually exist,
    # so an unknown {foo} stays visible instead of silently becoming "".
    if _PLACEHOLDER_OPEN in out:
        for m in set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", out)):
            if m in os.environ:
                out = out.replace(_PLACEHOLDER_OPEN + m + _PLACEHOLDER_CLOSE,
                                  os.environ[m])
    return [out]


def _reap_group(proc):
    """Kill a timed-out tool and everything it spawned.

    start_new_session makes the child its own process-group leader, so its pid
    IS the group id. Killing the GROUP catches background grandchildren that a
    plain proc.kill() would leave running (and which keep the output pipes
    open). Guarded so we can never signal our own group.
    """
    if proc is None:
        return
    pid = getattr(proc, "pid", None)
    if pid and os.name == "posix":
        try:
            if os.getpgid(pid) != os.getpgid(0):
                os.killpg(pid, signal.SIGKILL)
        except Exception:
            pass
    try:
        proc.kill()
    except Exception:
        pass
    try:
        proc.wait(timeout=5)
    except Exception:
        pass


class ScriptTool:
    def __init__(self, spec: dict):
        self.name = (spec.get("name") or "").strip()
        if not self.name:
            raise ValueError("every script tool needs a 'name'")
        self.description = spec.get("description") or f"Run the '{self.name}' command."
        self.params = spec.get("params") or {}
        run = spec.get("run")
        if isinstance(run, str):
            # A bare string is only allowed with shell:true - otherwise we would
            # have to guess at word splitting, which is exactly how quoting bugs
            # and injection holes get in.
            if not spec.get("shell"):
                raise ValueError(
                    f"tool '{self.name}': \"run\" must be a LIST of arguments "
                    f"(e.g. [\"ls\", \"-la\", \"{{path}}\"]). Use \"shell\": true only if "
                    f"you really want a shell string.")
            self.run = run
        elif isinstance(run, list) and run:
            self.run = [str(x) for x in run]
        else:
            raise ValueError(f"tool '{self.name}': missing a non-empty \"run\"")
        self.shell = bool(spec.get("shell"))
        # cwd may reference an env var, e.g. "{ZS_WORKSPACE}" or "$HOME/zs", so
        # one config file works across machines (and Termux's odd home path).
        self.cwd = spec.get("cwd")
        self.env = spec.get("env") or {}
        self.timeout = float(spec.get("timeout") or DEFAULT_TIMEOUT)
        # A tool may produce an IMAGE rather than text. "returns": "image" means
        # the command writes an image file and prints nothing useful; the file
        # is read, base64-encoded and handed back in the MCP image shape so the
        # extension can attach it to the chat exactly like a real MCP server's.
        self.returns = str(spec.get("returns") or "text").lower()
        # Where the image lands. Supports {placeholders} (params + env) and
        # defaults to a temp file the tool is expected to write.
        self.image_path = spec.get("image_path") or ""

    def schema(self):
        """The MCP-shaped tool descriptor the extension/model consumes."""
        props = {}
        required = []
        for key, meta in self.params.items():
            if isinstance(meta, str):
                meta = {"type": "string", "description": meta}
            meta = dict(meta or {})
            if meta.pop("required", False):
                required.append(key)
            meta.setdefault("type", "string")
            props[key] = meta
        schema = {"type": "object", "properties": props}
        if required:
            schema["required"] = required
        return {"name": self.name, "description": self.description,
                "inputSchema": schema}

    def resolved_cwd(self):
        """Expand env vars / ~ in cwd. {NAME} is read from the environment too,
        so a config can say {ZS_WORKSPACE} without hardcoding a phone path."""
        if not self.cwd:
            return None
        path = str(self.cwd)
        for key, val in os.environ.items():
            path = path.replace("{" + key + "}", val)
        path = os.path.expanduser(os.path.expandvars(path))
        # An unresolved {PLACEHOLDER} means the variable is not set; fall back to
        # the process cwd rather than trying to chdir into a literal "{X}".
        if "{" in path and "}" in path:
            return None
        return path or None

    def _defaults(self):
        """Per-parameter "default" values from the schema, applied when the model
        omits an optional argument. Without this, `grep {pattern} {path}` with no
        path would drop the argument and grep would read stdin forever."""
        out = {}
        for key, meta in (self.params or {}).items():
            if isinstance(meta, dict) and meta.get("default") is not None:
                out[key] = meta["default"]
        return out

    def build_argv(self, args: dict):
        used = set()
        merged = dict(self._defaults())
        merged.update({k: v for k, v in (args or {}).items()
                       if v is not None and v != ""})
        args = merged
        if self.shell:
            cmd = self.run
            if isinstance(cmd, list):
                cmd = " ".join(cmd)
            for key, val in args.items():
                cmd = cmd.replace(_PLACEHOLDER_OPEN + key + _PLACEHOLDER_CLOSE,
                                  "" if val is None else str(val))
            return cmd, used
        argv = []
        for token in self.run:
            argv.extend(_substitute(token, args, used))
        # Drop empty trailing args produced by an omitted optional placeholder,
        # so `grep {pattern} {path}` with no path doesn't pass a stray "".
        while argv and argv[-1] == "":
            argv.pop()
        return argv, used

    def _resolved_image_path(self, args: dict):
        """Fill {placeholders} in image_path from the tool's args, then the
        environment - same rules as an argv token, so a config can write
        {ZS_APP_DIR}/shot.png or {path}."""
        if not self.image_path:
            return ""
        out = str(self.image_path)
        for key, val in (args or {}).items():
            out = out.replace(_PLACEHOLDER_OPEN + key + _PLACEHOLDER_CLOSE,
                              "" if val is None else str(val))
        for m in set(re.findall(r"\{([A-Za-z_][A-Za-z0-9_]*)\}", out)):
            if m in os.environ:
                out = out.replace(_PLACEHOLDER_OPEN + m + _PLACEHOLDER_CLOSE,
                                  os.environ[m])
        out = os.path.expanduser(os.path.expandvars(out))
        # A RELATIVE image_path (e.g. the tool's own {path} parameter, "shot.png")
        # must resolve against the tool's cwd, exactly like the command itself
        # does - otherwise it is looked up next to the bridge and reported as
        # "did not produce an image" even though the file is right there.
        if out and not os.path.isabs(out):
            base = self.resolved_cwd()
            if base:
                out = os.path.join(base, out)
        return out

    def execute(self, args: dict, timeout=None):
        argv, _ = self.build_argv(args or {})
        env = dict(os.environ)
        env.update({str(k): str(v) for k, v in self.env.items()})
        try:
            # Run in its OWN PROCESS GROUP so a timeout can kill the whole
            # tree. subprocess.run() only kills the direct child: a shell that
            # spawned background work (`cmd &`, a daemon, an interactive CLI
            # waiting on a browser) leaves grandchildren running forever, and
            # they keep holding the output pipes. Killing the group prevents
            # that pile-up across repeated timeouts.
            # Manage the process ourselves instead of subprocess.run(): on a
            # timeout we need the PID to kill the whole process GROUP, and
            # TimeoutExpired does NOT carry one (verified: it exposes only cmd,
            # timeout, output, stderr). Without the group kill, a shell that
            # spawned background work leaves grandchildren running forever.
            popen_kw = {}
            if os.name == "posix":
                popen_kw["start_new_session"] = True  # child becomes group leader
            proc = subprocess.Popen(
                argv, shell=self.shell, cwd=self.resolved_cwd(), env=env,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                # Detach stdin. With no terminal attached, anything that reads
                # stdin (an interactive prompt, `grep` with no file operand)
                # would hang until the timeout instead of returning.
                stdin=subprocess.DEVNULL, errors="replace", **popen_kw)
            secs = float(timeout or self.timeout)
            try:
                stdout, stderr = proc.communicate(timeout=secs)
            except subprocess.TimeoutExpired:
                _reap_group(proc)
                raise TimeoutError(
                    f"'{self.name}' timed out after {secs:g}s and was stopped. If it "
                    f"needs longer, raise its \"timeout\" in config.json; if it waits "
                    f"for input or a browser it will NEVER finish here - tools run "
                    f"with no terminal.")
            res = subprocess.CompletedProcess(argv, proc.returncode, stdout, stderr)
        except FileNotFoundError:
            prog = argv if isinstance(argv, str) else (argv[0] if argv else "?")
            raise RuntimeError(
                f"'{self.name}' could not run: command not found ({prog}). "
                f"Check the \"run\" entry in config.json.")
        except PermissionError:
            raise RuntimeError(f"'{self.name}' could not run: permission denied.")

        out = (res.stdout or "").strip()
        err = (res.stderr or "").strip()
        # A non-zero exit is reported to the MODEL as an error string (so it can
        # adapt) rather than raised, unless there is no output at all to explain
        # it - matching how a real MCP tool surfaces a failed operation.
        if res.returncode != 0:
            detail = err or out or f"exit code {res.returncode}"
            raise RuntimeError(f"'{self.name}' failed (exit {res.returncode}): {detail}"[:MAX_OUTPUT])
        text = out
        if err:
            text = (text + "\n[stderr] " + err).strip()

        if self.returns == "image":
            path = self._resolved_image_path(args or {})
            if not path:
                raise RuntimeError(
                    f"'{self.name}' is declared as returning an image but no "
                    f"\"image_path\" was configured.")
            if not os.path.isfile(path):
                raise RuntimeError(
                    f"'{self.name}' did not produce an image at {path}. "
                    f"{text or 'The command printed no output.'}"[:MAX_OUTPUT])
            try:
                with open(path, "rb") as fh:
                    raw = fh.read()
            except Exception as e:
                raise RuntimeError(f"'{self.name}' could not read its image: {e}")
            if not raw:
                raise RuntimeError(f"'{self.name}' produced an empty image file.")
            if len(raw) > MAX_IMAGE_BYTES:
                raise RuntimeError(
                    f"'{self.name}' produced a {len(raw) // 1024}KB image, over the "
                    f"{MAX_IMAGE_BYTES // 1024}KB limit. Capture a smaller area or "
                    f"lower the resolution.")
            mime = "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
            return {
                "text": text or f"(captured {len(raw) // 1024}KB {mime})",
                "images": [{"data": base64.b64encode(raw).decode("ascii"),
                            "mimeType": mime}],
            }

        if not text:
            text = f"(ok, '{self.name}' produced no output)"
        return text[:MAX_OUTPUT]


class ScriptClient:
    """Duck-type twin of MCPClient backed by plain commands (no MCP at all).

    Only the surface MCPManager / the probes actually use is implemented; the
    crash-loop and Studio-forensics attributes exist so the shared supervision
    code can read them without special-casing this class.
    """

    def __init__(self, server_id, spec):
        self.id = server_id
        self.spec = spec or {}
        self.command = f"(script: {len(self.spec.get('tools') or [])} tools)"
        self.args = []
        self.env = self.spec.get("env") or {}
        self.call_lock = threading.Lock()
        self.start_lock = threading.Lock()
        self.tools = {}
        self.tools_cache = []
        self._alive = False
        # Fields the shared supervisor/diagnostics read on every client.
        self.last_exit = None
        self.stderr_tail = []
        self.restart_times = []
        self.loop_warned_at = 0.0
        self.start_error = None
        self.saw_foreign_ws_host = False
        self.proc = None

    # ── lifecycle ─────────────────────────────────────────────────────────
    def start(self):
        with self.start_lock:
            self.tools = {}
            errors = []
            for raw in (self.spec.get("tools") or []):
                try:
                    t = ScriptTool(raw)
                except Exception as e:
                    errors.append(str(e))
                    continue
                self.tools[t.name] = t
            self.tools_cache = [t.schema() for t in self.tools.values()]
            if errors:
                self.start_error = "; ".join(errors)
                self.stderr_tail = errors[-5:]
            else:
                self.start_error = None
                self.stderr_tail = []
            # A script server with no VALID tools is useless; report it as not
            # alive so the usual "0 tools / offline" diagnostics kick in.
            self._alive = bool(self.tools)
            return self.tools_cache

    def is_alive(self):
        return self._alive

    def restart(self):
        self._alive = False
        return self.start()

    def stop(self):
        self._alive = False

    # ── tools ─────────────────────────────────────────────────────────────
    def refresh_tools(self, timeout=20):
        if not self._alive:
            self.start()
        return self.tools_cache

    def call_tool(self, name, arguments, timeout):
        """Returns {"text":..., "images":[]} or raises - same as MCPClient.

        Tool calls are serialised per server. A call that arrives while another
        is running therefore WAITS first - so its wall-clock duration can far
        exceed its own timeout. The bridge logs wall time, which made a queued
        call look like a broken timeout ("timed out after 120s" logged at
        238.7s). We now measure the wait and name it in the error.
        """
        _queued_at = time.monotonic()
        with self.call_lock:
            waited = time.monotonic() - _queued_at
            if waited > 1.0:
                log_wait = (f" (it also waited {waited:.0f}s in the queue behind "
                            f"another '{self.id}' command)")
            else:
                log_wait = ""
            if not self._alive:
                self.start()
            tool = self.tools.get(name)
            if tool is None:
                raise RuntimeError(f"unknown tool '{name}' on script server '{self.id}'")
            try:
                res = tool.execute(arguments or {}, timeout=timeout)
            except TimeoutError as e:
                # Re-raise with the queue wait appended, so the number in the
                # message accounts for the elapsed time the bridge logs.
                if log_wait:
                    raise TimeoutError(str(e) + log_wait) from None
                raise
            # execute() returns a plain string for text tools, or the full
            # {"text","images"} dict for image tools.
            if isinstance(res, dict):
                return res
            return {"text": res, "images": []}

    def probe_text(self, tool_name):
        """Best-effort probe used by the status layer. Never raises."""
        tool = self.tools.get(tool_name)
        if tool is None or not self._alive:
            return None
        if not self.call_lock.acquire(blocking=False):
            return None
        try:
            return tool.execute({}, timeout=min(8, tool.timeout))
        except Exception:
            return None
        finally:
            self.call_lock.release()


def looks_like_script_spec(spec):
    """True when a config.json server entry describes script tools, not MCP."""
    if not isinstance(spec, dict):
        return False
    if str(spec.get("type") or "").lower() in ("script", "shell", "commands"):
        return True
    # No explicit type but it declares tools and no launch command -> script.
    return bool(spec.get("tools")) and not spec.get("command")
