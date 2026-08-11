#!/data/data/com.termux/files/usr/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# start-termux.sh - launch the ZeroScript bridge on Android / Termux.
#
#   bash start-termux.sh
#
# Handles the Termux-specific bits: installs python if missing, installs the one
# dependency, creates the workspace folder the tools operate in, holds a wake
# lock so Android does not suspend the bridge, and starts bridge.py.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE" || exit 1

# The folder the AI's tools can see. Override:  ZS_WORKSPACE=~/notes bash start-termux.sh
export ZS_WORKSPACE="${ZS_WORKSPACE:-$HOME/zs}"

say() { printf '\033[96m[zs]\033[0m %s\n' "$*"; }
ok() { printf '\033[92m[zs]\033[0m %s\n' "$*"; }
warn() { printf '\033[93m[zs]\033[0m %s\n' "$*"; }
die() { printf '\033[91m[zs]\033[0m %s\n' "$*"; exit 1; }

# ── 1. python ──────────────────────────────────────────────────────────────
if ! command -v python >/dev/null 2>&1; then
  say "Python not found - installing it (this takes a minute)..."
  pkg install -y python || die "could not install python. Run: pkg update && pkg install python"
fi

# ── 2. the single dependency ───────────────────────────────────────────────
# NOTE: never `pip install --upgrade pip` on Termux - it breaks the packaged pip.
if ! python -c "import websockets" >/dev/null 2>&1; then
  say "Installing the 'websockets' dependency..."
  pip install websockets || die "pip install websockets failed. Try: pkg install python-pip"
fi

# ── 3. config ──────────────────────────────────────────────────────────────
if [ ! -f config.json ]; then
  die "config.json is missing."
fi
if grep -q '"launch_studio_mcp.py"' config.json 2>/dev/null; then
  warn "config.json is still the ROBLOX default, which cannot work on Android."
  warn "Switch to the phone profile with:   cp config.termux.json config.json"
  warn "Continuing anyway - expect 'no StudioMCP.exe found'."
fi

# A config that launches an MCP server via npx/node needs Node installed. Say so
# up front instead of letting the user watch a crash-restart loop.
if grep -qE '"(npx|node)"' config.json 2>/dev/null && ! command -v node >/dev/null 2>&1; then
  warn "config.json runs an MCP server with npx/node, but Node is not installed."
  warn "Install it with:   pkg install -y nodejs"
  warn "Continuing anyway - that server will fail to start until you do."
fi
if grep -q '"npx"' config.json 2>/dev/null; then
  say "Note: the first npx launch downloads the MCP server and can take several"
  say "      minutes on a phone. Later starts are fast."
fi

# ── 4. workspace ───────────────────────────────────────────────────────────
mkdir -p "$ZS_WORKSPACE" || die "could not create workspace $ZS_WORKSPACE"
if [ -z "$(ls -A "$ZS_WORKSPACE" 2>/dev/null)" ]; then
  printf 'This is your ZeroScript workspace.\nThe AI can read and write files in here.\n' \
    > "$ZS_WORKSPACE/README.txt"
fi
say "Workspace: $ZS_WORKSPACE"

# ── 5. keep Android from killing us ────────────────────────────────────────
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock && say "Wake lock held (release later with termux-wake-unlock)."
else
  warn "termux-wake-lock not available - Android may suspend the bridge when the"
  warn "screen is off. Install it with:  pkg install termux-api"
fi
trap 'command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock' EXIT

# ── 6. go ──────────────────────────────────────────────────────────────────
# Two modes:
#   (default)  foreground - blocks until Ctrl-C. Right for a normal Termux
#              session, but it NEVER returns, so any non-interactive runner
#              (a script, an automation, a chat tool running the command for
#              you) just hangs and shows no output at all.
#   -b|--bg    background - start it, wait for the boot line, print a short
#              report and EXIT. Safe to run non-interactively.
MODE="${1:-}"
LOGFILE="${ZS_LOG:-$HERE/bridge.out}"

if [ "$MODE" = "-b" ] || [ "$MODE" = "--bg" ] || [ "${ZS_BACKGROUND:-0}" = "1" ]; then
  # Already running? Don't start a second one fighting for the port.
  if pgrep -f "python .*bridge\.py" >/dev/null 2>&1; then
    warn "A bridge is already running. Stop it first:  bash start-termux.sh --stop"
    exit 1
  fi
  say "Starting the bridge in the BACKGROUND..."
  : > "$LOGFILE"
  nohup python bridge.py >> "$LOGFILE" 2>&1 &
  BPID=$!
  # Poll the log for the boot verdict instead of sleeping a fixed time.
  for _ in $(seq 1 40); do
    sleep 1
    grep -qE "ready [0-9]+ tools|could not start|Traceback" "$LOGFILE" 2>/dev/null && break
    kill -0 "$BPID" 2>/dev/null || break
  done
  echo
  sed -e 's/\x1b\[[0-9;]*m//g' "$LOGFILE" | head -20
  echo
  if grep -q "ready .* tools" "$LOGFILE" 2>/dev/null; then
    ok "Bridge is UP (pid $BPID). Log: $LOGFILE"
    if grep -q "\[roblox\]" "$LOGFILE" 2>/dev/null; then
      warn "...but it is running the ROBLOX config, which cannot work here."
      warn "Run:  bash fix-termux.sh   then start it again."
    fi
  else
    warn "The bridge did not report ready. Full log: $LOGFILE"
  fi
  say "Stop it with:  bash start-termux.sh --stop"
  exit 0
fi

if [ "$MODE" = "--stop" ]; then
  if pkill -f "python .*bridge\.py" 2>/dev/null; then
    ok "Stopped the bridge."
  else
    say "No bridge was running."
  fi
  command -v termux-wake-unlock >/dev/null 2>&1 && termux-wake-unlock
  exit 0
fi

say "Starting the bridge. Leave this session open, then load the extension."
say "Press Ctrl-C to stop.  (Non-interactive? use:  bash start-termux.sh -b )"
echo
exec python bridge.py
