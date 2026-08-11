#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the /fixture HTTP capture route.

The browser can reach the AI site; the bridge and the test suite cannot. This
route is how a live page becomes a permanent regression test, so it has to
behave under bad input rather than only on the happy path.

Run:  python3 test_http_fixture.py
"""
import base64, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
passed = failed = 0


def ok(name, cond, extra=""):
    global passed, failed
    if cond:
        print("PASS ", name); passed += 1
    else:
        print("FAIL ", name, ("\n      " + str(extra)) if extra else ""); failed += 1


def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p


def get(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode())
        except Exception: return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def blob(obj):
    return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")


d = tempfile.mkdtemp()
for f in ("bridge.py", "script_server.py", "updater.py"):
    shutil.copy(os.path.join(HERE, f), d)
os.makedirs(os.path.join(d, "zeroscript-extension", "fixtures"))
with open(os.path.join(d, "config.json"), "w") as f:
    json.dump({"target": {"id": "t", "kind": "generic", "name": "t", "short": "t"},
               "servers": {"t": {"type": "script",
                                 "tools": [{"name": "noop", "run": ["true"]}]}}}, f)

port = free_port()
env = dict(os.environ, ZS_BRIDGE_PORT=str(port), ZS_WORKSPACE=d)
proc = subprocess.Popen([sys.executable, "bridge.py"], cwd=d, env=env,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
base = f"http://127.0.0.1:{port}"
for _ in range(40):
    time.sleep(0.5)
    if get(base + "/healthz", 3)[0]: break

try:
    ok("bridge answers /healthz", get(base + "/healthz")[0] in (200, 503))

    st, body = get(base + "/fixtures")
    ok("GET /fixtures lists (empty at first)", st == 200 and body.get("fixtures") == [], body)

    good = {"url": "https://arena.ai/agent/abc123", "provider": "arena-agent",
            "generating": True, "turns": [{"role": "user", "html": "<div>hi</div>"}]}
    st, body = get(f"{base}/fixture?data={blob(good)}")
    ok("a capture is accepted", st == 200 and body.get("saved"), body)
    saved = body.get("saved", "")
    ok("the filename reflects the page", "arena-agent" in saved and "generating" in saved, saved)
    ok("it reports the turn count", body.get("turns") == 1, body)

    st, body = get(base + "/fixtures")
    ok("it now appears in the list", saved in (body.get("fixtures") or []), body)

    # re-capturing the same page overwrites instead of piling up
    get(f"{base}/fixture?data={blob(good)}")
    st, body = get(base + "/fixtures")
    ok("re-capturing does not duplicate", len(body.get("fixtures") or []) == 1, body)

    ok("the file is valid JSON on disk",
       json.load(open(os.path.join(d, "zeroscript-extension", "fixtures", saved)))["url"]
       == good["url"])

    # bad input must be rejected clearly, never crash the bridge
    st, body = get(base + "/fixture")
    ok("missing data is rejected", st == 400 and "hint" in body, (st, body))
    st, body = get(base + "/fixture?data=not-valid-base64!!")
    ok("bad base64 is rejected", st == 400, (st, body))
    st, body = get(f"{base}/fixture?data={blob({'no': 'turns'})}")
    ok("a non-fixture object is rejected", st == 400 and "turns" in str(body), (st, body))
    st, body = get(f"{base}/fixture?data={blob([1, 2, 3])}")
    ok("a JSON array is rejected", st == 400, (st, body))

    ok("the bridge is still alive after bad input", get(base + "/healthz")[0] in (200, 503))
    ok("an unknown route still 404s", get(base + "/nope")[0] == 404)
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()
    shutil.rmtree(d, ignore_errors=True)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
