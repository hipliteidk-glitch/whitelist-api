#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Merge custom tools from an OLD config.json into the shipped one.

    python3 merge-config.py ~/zs-app.old/vendor/ZeroScript-Free/config.json

Why: switching to a git install means starting from the shipped
config.termux.json, which would drop any tools you added by hand. This copies
those across without touching the shipped ones.

Rules, deliberately conservative:
  - A tool is "custom" only if its NAME is absent from the new config. A tool
    you renamed counts as custom; a shipped tool you edited is NOT overwritten
    back to your version, because the shipped one may carry fixes.
  - The new config.json is backed up first.
  - Nothing else is copied: target, servers and every other key stay as
    shipped, so a stale block in the old file cannot resurrect an old bug.
"""
import json
import os
import shutil
import sys
import time


def tools_of(cfg):
    """The tool list, from either the 'servers' or legacy 'mcpServers' key."""
    for key in ("servers", "mcpServers"):
        for spec in (cfg.get(key) or {}).values():
            if isinstance(spec, dict) and isinstance(spec.get("tools"), list):
                return spec["tools"]
    return []


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    old_path = os.path.expanduser(sys.argv[1])
    new_path = os.path.expanduser(sys.argv[2]) if len(sys.argv) > 2 else "config.json"

    for p in (old_path, new_path):
        if not os.path.isfile(p):
            print(f"error: no such file: {p}")
            return 1

    try:
        old = json.load(open(old_path))
        new = json.load(open(new_path))
    except Exception as e:
        print(f"error: could not read a config as JSON: {e}")
        return 1

    new_tools = tools_of(new)
    old_tools = tools_of(old)
    if not new_tools:
        print(f"error: {new_path} has no tool list - is it the phone config?")
        return 1
    if not old_tools:
        print(f"Nothing to merge: {old_path} has no tools.")
        return 0

    have = {t.get("name") for t in new_tools}
    custom = [t for t in old_tools if t.get("name") and t["name"] not in have]

    if not custom:
        print("Nothing to merge - every tool in the old config is already shipped.")
        return 0

    backup = f"{new_path}.backup.{int(time.time())}"
    shutil.copy(new_path, backup)

    new_tools.extend(custom)
    with open(new_path, "w") as f:
        json.dump(new, f, indent=2)
        f.write("\n")

    print(f"Merged {len(custom)} custom tool(s) into {new_path}:")
    for t in custom:
        print(f"  + {t['name']}")
    print(f"{len(new_tools)} tools total. Backup: {backup}")
    print("Restart the bridge:  bash start-termux.sh --stop && bash start-termux.sh -b")
    return 0


if __name__ == "__main__":
    sys.exit(main())
