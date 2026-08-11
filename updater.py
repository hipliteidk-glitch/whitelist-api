# SPDX-License-Identifier: GPL-3.0-or-later
# updater.py
# ──────────────────────────────────────────────────────────────────────────
#  Self-update for a git-cloned ZeroScript install.
#
#  Fixes a real workflow problem: every fix this session ended with "git pull,
#  then reload the extension" typed by hand on a phone. The bridge is already a
#  git checkout and already talks to the extension, so it can do both.
#
#  DESIGN RULES (deliberate, and the reason this is not just `git pull`):
#    - NEVER discard the user's work. A dirty tree or local commits abort the
#      update with an explanation. config.json in particular is edited by hand
#      and by the extension, so it is never touched.
#    - NEVER update silently. The bridge reports what changed; restarting is a
#      separate, explicit step.
#    - Fail closed. Any git error, no network, not a repo -> report and carry
#      on running the current version. An update mechanism that can brick a
#      working install is worse than none.
# ──────────────────────────────────────────────────────────────────────────
from __future__ import annotations

import json
import os
import subprocess
import time

HERE = os.path.dirname(os.path.abspath(__file__))
# Where an updatable install comes from. Named here so the "not a git install"
# message can hand back a command that actually works, instead of the useless
# "download the latest version manually".
_REPO = "https://github.com/hipliteidk-glitch/potential-waddle"
_BRANCH = "arena/019f97f5-potential-waddle"
# The checkout root: this file lives in vendor/ZeroScript-Free/ inside the repo.
GIT_TIMEOUT = 60


def _git(*args, cwd=None, timeout=GIT_TIMEOUT):
    """Run git; return (ok, output). Never raises."""
    try:
        r = subprocess.run(["git", *args], cwd=cwd or HERE, capture_output=True,
                           text=True, timeout=timeout, errors="replace")
        return r.returncode == 0, (r.stdout or r.stderr or "").strip()
    except FileNotFoundError:
        return False, "git is not installed"
    except subprocess.TimeoutExpired:
        return False, f"git {args[0]} timed out after {timeout}s"
    except Exception as e:  # pragma: no cover - defensive
        return False, f"git {args[0]} failed: {e}"


def repo_root():
    ok, out = _git("rev-parse", "--show-toplevel")
    return out if ok else None


def is_git_install():
    return repo_root() is not None


def local_state():
    """Branch, short sha and whether the tree is dirty."""
    _, branch = _git("rev-parse", "--abbrev-ref", "HEAD")
    _, sha = _git("rev-parse", "--short", "HEAD")
    ok, status = _git("status", "--porcelain")
    dirty = bool(ok and status.strip())
    return {"branch": branch, "sha": sha, "dirty": dirty,
            "dirty_files": [l[3:] for l in status.splitlines()[:10]] if dirty else []}


def check(timeout=GIT_TIMEOUT):
    """Is a newer commit available? Read-only: fetch, never merge.

    Returns a dict the extension can render directly.
    """
    if not is_git_install():
        return {"ok": False, "reason": "not a git install",
                "detail": "This copy was not cloned with git, so it cannot self-update. "
                          "To switch to an updatable install, run in Termux:\n"
                          "  cd ~ && mv zs-app zs-app.old\n"
                          "  git clone -b " + _BRANCH + " " + _REPO + " zs-app\n"
                          "  cd zs-app/vendor/ZeroScript-Free\n"
                          "  cp config.termux.json config.json\n"
                          "  bash start-termux.sh -b\n"
                          "Your old copy stays in ~/zs-app.old."}
    st = local_state()
    ok, out = _git("fetch", "--quiet", "origin", st["branch"], timeout=timeout)
    if not ok:
        return {"ok": False, "reason": "fetch failed", "detail": out, **st}
    ok, behind = _git("rev-list", "--count", f"HEAD..origin/{st['branch']}")
    if not ok:
        return {"ok": False, "reason": "compare failed", "detail": behind, **st}
    ok, ahead = _git("rev-list", "--count", f"origin/{st['branch']}..HEAD")
    n_behind = int(behind) if behind.isdigit() else 0
    n_ahead = int(ahead) if ok and ahead.isdigit() else 0
    log = ""
    if n_behind:
        _, log = _git("log", "--oneline", "--no-decorate", "-10",
                      f"HEAD..origin/{st['branch']}")
    return {"ok": True, "updates": n_behind, "ahead": n_ahead,
            "changes": [l for l in log.splitlines() if l], **st}


def apply(timeout=GIT_TIMEOUT):
    """Fast-forward to origin. Refuses anything that could lose work."""
    info = check(timeout=timeout)
    if not info.get("ok"):
        return info
    if not info["updates"]:
        return {**info, "ok": True, "applied": False, "detail": "Already up to date."}

    # Refuse to touch a tree with uncommitted changes: a pull could clobber
    # them, and this runs unattended from a chat window.
    if info["dirty"]:
        return {**info, "ok": False, "applied": False, "reason": "local changes",
                "detail": "You have uncommitted changes, so the update was NOT applied "
                          "(nothing was lost). Commit or stash them, then update again. "
                          "Changed: " + ", ".join(info["dirty_files"])}
    if info["ahead"]:
        return {**info, "ok": False, "applied": False, "reason": "local commits",
                "detail": f"This checkout has {info['ahead']} commit(s) the remote does "
                          f"not, so a fast-forward is not possible. Push or reset them "
                          f"first."}

    before = info["sha"]
    ok, out = _git("merge", "--ff-only", f"origin/{info['branch']}", timeout=timeout)
    if not ok:
        return {**info, "ok": False, "applied": False, "reason": "merge failed",
                "detail": out}
    _, after = _git("rev-parse", "--short", "HEAD")
    return {"ok": True, "applied": True, "from": before, "to": after,
            "changes": info["changes"], "branch": info["branch"],
            "detail": f"Updated {before} -> {after}. Restart the bridge and reload "
                      f"the extension to run the new version."}


def summary_line(info):
    """One line for the bridge's console."""
    if not info.get("ok"):
        return f"update check: {info.get('reason')} - {info.get('detail', '')[:120]}"
    if info.get("applied"):
        return f"updated {info.get('from')} -> {info.get('to')}"
    n = info.get("updates", 0)
    return f"{n} update(s) available" if n else "up to date"


if __name__ == "__main__":  # manual use: python updater.py [apply]
    import sys
    r = apply() if len(sys.argv) > 1 and sys.argv[1] == "apply" else check()
    print(json.dumps(r, indent=2))
