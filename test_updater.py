#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Tests for the self-updater.

An updater that can destroy a working install is worse than no updater, so the
refusals matter more than the happy path. Every case runs against REAL git
repositories in a temp dir - nothing is mocked.

Run:  python3 test_updater.py
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

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


def git(*a, cwd):
    return subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True)


def run_updater(cwd, *args):
    r = subprocess.run([sys.executable, "updater.py", *args], cwd=cwd,
                       capture_output=True, text=True, timeout=90)
    try:
        return json.loads(r.stdout)
    except Exception:
        return {"ok": False, "reason": "bad output", "raw": r.stdout + r.stderr}


def make_install():
    """A bare 'origin' plus a clone laid out like a real install."""
    root = tempfile.mkdtemp()
    bare = os.path.join(root, "origin.git")
    subprocess.run(["git", "init", "-q", "--bare", bare], check=True)
    work = os.path.join(root, "install")
    subprocess.run(["git", "clone", "-q", bare, work], check=True)
    git("config", "user.email", "t@e.com", cwd=work)
    git("config", "user.name", "T", cwd=work)
    sub = os.path.join(work, "vendor", "ZeroScript-Free")
    os.makedirs(sub)
    shutil.copy(os.path.join(HERE, "updater.py"), sub)
    with open(os.path.join(sub, "config.json"), "w") as f:
        f.write('{"mine": true}\n')
    git("add", "-A", cwd=work)
    git("commit", "-qm", "initial", cwd=work)
    git("push", "-q", "origin", "HEAD", cwd=work)
    return root, bare, sub


def publish(bare, n=1):
    """Push n new commits to origin from a separate clone."""
    tmp = tempfile.mkdtemp()
    c = os.path.join(tmp, "c")
    subprocess.run(["git", "clone", "-q", bare, c], check=True)
    git("config", "user.email", "t@e.com", cwd=c)
    git("config", "user.name", "T", cwd=c)
    for i in range(n):
        with open(os.path.join(c, f"feature{i}.txt"), "w") as f:
            f.write("x")
        git("add", "-A", cwd=c)
        git("commit", "-qm", f"upstream change {i}", cwd=c)
    git("push", "-q", cwd=c)
    shutil.rmtree(tmp, ignore_errors=True)


# ── up to date ─────────────────────────────────────────────────────────────
root, bare, sub = make_install()
r = run_updater(sub)
ok("clean install reports ok", r.get("ok"), r)
ok("no updates when in sync", r.get("updates") == 0, r.get("updates"))
ok("reports the branch and sha", bool(r.get("branch")) and bool(r.get("sha")), r)
ok("tree is not dirty", r.get("dirty") is False)

# ── an update exists ───────────────────────────────────────────────────────
publish(bare, 2)
r = run_updater(sub)
ok("detects both upstream commits", r.get("updates") == 2, r.get("updates"))
ok("lists what changed", len(r.get("changes") or []) == 2, r.get("changes"))
ok("checking does NOT apply anything",
   not os.path.exists(os.path.join(os.path.dirname(os.path.dirname(sub)), "feature0.txt")))

# ── the refusals: these protect the user's work ────────────────────────────
cfg = os.path.join(sub, "config.json")
with open(cfg, "a") as f:
    f.write('{"user_edit": true}\n')
r = run_updater(sub, "apply")
ok("REFUSES to update a dirty tree", r.get("ok") is False and r.get("reason") == "local changes", r)
ok("says nothing was lost", "NOT applied" in (r.get("detail") or ""), r.get("detail"))
ok("names the changed file", "config.json" in (r.get("detail") or ""), r.get("detail"))
with open(cfg) as f:
    ok("the user's edit survives untouched", "user_edit" in f.read())

git("checkout", "--", ".", cwd=sub)

# local commits -> no fast-forward
with open(os.path.join(sub, "local.txt"), "w") as f:
    f.write("local work\n")
git("add", "-A", cwd=sub)
git("commit", "-qm", "my own commit", cwd=sub)
r = run_updater(sub, "apply")
ok("REFUSES when the checkout has local commits",
   r.get("ok") is False and r.get("reason") == "local commits", r)
ok("the local commit is still there",
   "my own commit" in git("log", "--oneline", "-1", cwd=sub).stdout)
git("reset", "-q", "--hard", "HEAD~1", cwd=sub)

# ── the happy path ─────────────────────────────────────────────────────────
r = run_updater(sub, "apply")
ok("applies a clean fast-forward", r.get("ok") and r.get("applied"), r)
ok("reports from -> to", bool(r.get("from")) and bool(r.get("to")), r)
ok("the new files arrived",
   os.path.exists(os.path.join(os.path.dirname(os.path.dirname(sub)), "feature0.txt")))
ok("tells the user to restart", "estart" in (r.get("detail") or ""), r.get("detail"))

r = run_updater(sub)
ok("no updates remain after applying", r.get("updates") == 0, r)

# ── not a git install ──────────────────────────────────────────────────────
plain = tempfile.mkdtemp()
shutil.copy(os.path.join(HERE, "updater.py"), plain)
r = run_updater(plain)
ok("a non-git install fails safely", r.get("ok") is False, r)
ok("and explains why", "git" in (r.get("detail") or "").lower(), r.get("detail"))

shutil.rmtree(root, ignore_errors=True)
shutil.rmtree(plain, ignore_errors=True)

# ── fix-termux.sh must not ship a stale copy of the config ─────────────────
# It did: the script wrote 6 tools while config.termux.json shipped 9, so
# running it DOWNGRADED an install and silently removed screenshot/show_image.
fix_sh = os.path.join(HERE, "fix-termux.sh")
if os.path.exists(fix_sh):
    body = open(fix_sh).read()
    ok("fix-termux.sh prefers the shipped config",
       "cp config.termux.json config.json" in body)
    ok("fix-termux.sh says why the fallback is smaller",
       "fallback" in body.lower())
    shipped = json.load(open(os.path.join(HERE, "config.termux.json")))
    names = [t["name"] for t in shipped["servers"]["phone"]["tools"]]
    ok("the shipped config still has the image tools",
       "screenshot" in names and "show_image" in names, names)

# ── the not-a-git-install message must be actionable ───────────────────────
up = open(os.path.join(HERE, "updater.py")).read()
ok("not-a-git-install gives a real command", "git clone -b" in up)
ok("and preserves the old copy", "zs-app.old" in up)

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
