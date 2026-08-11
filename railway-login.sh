#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# railway-login.sh - make `railway login --browserless` usable from a
# non-interactive tool (the ZeroScript bridge).
#
#   railway-login.sh start   - begin login, print the pairing code, RETURN
#   railway-login.sh status  - has the login completed yet?
#   railway-login.sh cancel  - abandon a pending login
#
# WHY THIS EXISTS
# `railway login --browserless` prints a pairing code and then BLOCKS until the
# user confirms in a browser. A tool that runs it directly either hangs forever
# or (with stdin closed) is killed before printing anything - which is why the
# AI kept getting empty output.
#
# So: run it in the BACKGROUND, tee its output to a file, wait only long enough
# for the pairing code to appear, print that, and exit. The login process keeps
# waiting in the background while the user confirms on any device. `status`
# then reports whether it finished.
#
# This does NOT bypass the browser step - nothing can; the user still confirms.
# It just stops the blocking call from breaking automation.
set -u

STATE_DIR="${RAILWAY_LOGIN_STATE:-${TMPDIR:-/tmp}/zs-railway-login}"
OUT="$STATE_DIR/login.out"
PIDF="$STATE_DIR/login.pid"
MAX_WAIT="${RAILWAY_LOGIN_WAIT:-25}"   # seconds to wait for the pairing code

mkdir -p "$STATE_DIR" 2>/dev/null || true

have_cli() {
  command -v railway >/dev/null 2>&1
}

running() {
  [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null
}

no_cli_msg() {
  echo "The Railway CLI is not installed."
  echo "Install it with one of:"
  echo "  npm i -g @railway/cli"
  echo "  bash <(curl -fsSL railway.com/install.sh) -y"
}

case "${1:-start}" in

  start)
    if ! have_cli; then no_cli_msg; exit 1; fi

    # Already authenticated? Then there is nothing to do - saying so is far more
    # useful than starting a second login the user must also confirm.
    if railway whoami >/dev/null 2>&1; then
      echo "Already logged in:"
      railway whoami 2>&1 | head -3
      exit 0
    fi

    if running; then
      echo "A login is already pending. Its pairing details were:"
      sed -e 's/\x1b\[[0-9;]*m//g' "$OUT" 2>/dev/null | grep -iE "code|http" | head -4
      echo
      echo "Finish it in a browser, then run the status check."
      echo "To abandon it, run this script with: cancel"
      exit 0
    fi

    : > "$OUT"
    # Detach it: this script must return while the CLI keeps waiting. stdin is
    # /dev/null because there is no terminal - the confirmation happens in the
    # browser, not on stdin.
    railway login --browserless >"$OUT" 2>&1 </dev/null &
    echo $! > "$PIDF"

    # Poll for the pairing code rather than sleeping a fixed time.
    i=0
    while [ "$i" -lt "$MAX_WAIT" ]; do
      if grep -qiE "pairing code|cli-login|railway\.com/cli|code is" "$OUT" 2>/dev/null; then
        break
      fi
      # The CLI exited early (e.g. "cannot login in non-interactive mode").
      if ! running; then break; fi
      sleep 1
      i=$((i + 1))
    done

    if [ -s "$OUT" ]; then
      echo "Railway login started. Complete it in a browser:"
      echo
      sed -e 's/\x1b\[[0-9;]*m//g' "$OUT" | grep -viE "^\s*$" | head -8
      echo
      if running; then
        echo "Waiting for you to confirm. Once done, run the status check."
      else
        echo "NOTE: the CLI exited already - see the output above for why."
      fi
    else
      echo "The CLI produced no output within ${MAX_WAIT}s."
      echo "It may be unreachable from this machine. Check with:  railway whoami"
    fi
    ;;

  status)
    if ! have_cli; then no_cli_msg; exit 1; fi
    if railway whoami >/dev/null 2>&1; then
      echo "Logged in:"
      railway whoami 2>&1 | head -3
      rm -f "$PIDF" 2>/dev/null
      exit 0
    fi
    if running; then
      echo "Not logged in yet - a login is still pending."
      echo "Finish it in the browser using the pairing code from the start step:"
      sed -e 's/\x1b\[[0-9;]*m//g' "$OUT" 2>/dev/null | grep -iE "code|http" | head -3
    else
      echo "Not logged in, and no login is pending. Run the start step."
      if [ -s "$OUT" ]; then
        echo "Last attempt said:"
        sed -e 's/\x1b\[[0-9;]*m//g' "$OUT" | tail -4
      fi
    fi
    exit 1
    ;;

  cancel)
    if running; then
      kill "$(cat "$PIDF")" 2>/dev/null
      rm -f "$PIDF"
      echo "Pending login cancelled."
    else
      echo "No login was pending."
    fi
    ;;

  *)
    echo "Usage: railway-login.sh [start|status|cancel]"
    exit 2
    ;;
esac
