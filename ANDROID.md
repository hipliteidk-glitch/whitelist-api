# Running ZeroScript on an Android phone (no PC)

## Quick start (ONE command)

First press **Ctrl-C** in Termux to stop anything already running. Then paste
this single line and press Enter:

```bash
cd ~ && rm -rf zs-app && pkg install -y python git && git clone -b arena/019f97f5-potential-waddle https://github.com/hipliteidk-glitch/potential-waddle zs-app && cd zs-app/vendor/ZeroScript-Free && bash fix-termux.sh && bash start-termux.sh
```

It downloads the right version, writes a phone config, and starts the bridge.
Because it is one line, it stops at the first failure instead of continuing
with a half-finished setup.

To start it again later:

```bash
cd ~/zs-app/vendor/ZeroScript-Free && bash start-termux.sh
```

### Running it non-interactively

`start-termux.sh` normally runs in the foreground and blocks until Ctrl-C, so a
script or automation running it never gets any output. Use `-b` to start it in
the background: it waits for the boot line, prints a short report, then exits.

```bash
bash start-termux.sh -b        # start in the background and return
bash start-termux.sh --stop    # stop it
```

The log is written to `bridge.out` next to the script.

If you still see `[roblox]` after this, the command did not finish - scroll up
to the FIRST red error and send me that line.

## Step by step

In Termux:

```bash
pkg update && pkg install -y python git
git clone -b arena/019f97f5-potential-waddle https://github.com/hipliteidk-glitch/potential-waddle
cd potential-waddle/vendor/ZeroScript-Free
bash fix-termux.sh
bash start-termux.sh
```

> **The `-b arena/019f97f5-potential-waddle` is required.** Without it you get
> the `main` branch, which does not contain ZeroScript at all - there is no
> `vendor/` folder, so the `cd` fails and nothing else runs.
>
> Sanity check after the `cd`: `ls script_server.py` should print the filename.
> If it says *No such file*, you are on the wrong branch or in the wrong folder.

That installs the one dependency, creates a `~/zs` workspace, holds a wake lock
so Android does not suspend the bridge, and starts it. You should see:

```
  ZeroScript Bridge v1.4.9  - my phone - ws://127.0.0.1:17613

configured 1 server(s) (0 MCP + 1 script): phone
ready 7 tools available - my phone connected
```

Leave that session running, then install the extension (step 4 below) and open
an AI chat. The AI gets seven tools over your `~/zs` folder: `list_files`,
`read_file`, `write_file`, `append_file`, `search_text`, `delete_file` and
`phone_status`.

This uses **no MCP and no Roblox** - the tools are plain commands (see
`NO-MCP.md`). To change what the AI can do, edit the `tools` list in
`config.json`. To use a different folder:
`ZS_WORKSPACE=~/notes bash start-termux.sh`.

## If you want a real MCP server instead

The quick start above uses plain commands, so nothing has to speak MCP. If you
specifically want a **real MCP server**, that works in Termux too - it just
needs Node:

```bash
pkg install -y nodejs
cp config.termux-mcp.json config.json
bash start-termux.sh
```

That runs the official filesystem MCP server over one folder. Edit the last
argument in `config.json` to choose which folder. Expect:

```
configured 1 server(s) (1 MCP): files
[files] MCP server up  (14 tools advertised)
```

Notes:

- The **first** launch downloads the server with `npx` and can take several
  minutes on a phone. Later launches are fast (npm caches it).
- Any MCP server that runs on Android works - it must be pure Node or Python.
  Desktop-app servers (Blender, Roblox Studio) do not.
- You can use both at once: keep `mcpServers` for the MCP server and add a
  `servers` block of script tools. The AI sees one merged command list.

ZeroScript has no cloud mode. The extension only ever connects to
`ws://127.0.0.1:<port>` (hardcoded in `background.js`; the manifest only grants
`127.0.0.1` host permissions), so **the bridge and the browser must run on the
same device**. On Android that is possible: Termux runs the Python bridge, and a
Chromium browser with extension support runs the extension. Both are on the
phone, so `127.0.0.1` resolves between them.

## Read this first: what will and will not work

| | Works on Android? |
| --- | --- |
| The bridge (`bridge.py`) | **Yes** — pure Python, one dependency (`websockets`). |
| The extension | **Yes**, in a Chromium browser that loads extensions. |
| A **generic** MCP target | **Yes** — this is the supported path. |
| A **Roblox Studio** target | **No.** Roblox Studio is Windows/macOS only; there is no Android build, and the Roblox path shells out to Windows `tasklist`/`taskkill`. |

So on a phone you must use a **generic target** (see `TARGETS.md`). The
target-profile layer in this vendored copy is what makes that possible; upstream
ZeroScript is Roblox-only and cannot do this. All the Windows-only supervision
is gated behind `kind: "roblox"`, so a generic target never calls it.

You also need an MCP server that itself runs on Android. Anything pure-Python or
pure-Node that Termux can run is fine (a filesystem server, a notes/database
server, your own script). Desktop apps like Blender are not.

## 1. Install Termux

Get Termux from **F-Droid** or its GitHub releases — *not* the Play Store
version, which is obsolete and unmaintained.

```bash
pkg update && pkg upgrade -y
pkg install python git -y
```

Do **not** run `pip install --upgrade pip` in Termux; it breaks the packaged pip.
Use `pkg install python-pip` if pip needs updating.

## 2. Get the bridge and its dependency

```bash
cd ~
git clone -b arena/019f97f5-potential-waddle https://github.com/hipliteidk-glitch/potential-waddle
cd potential-waddle/vendor/ZeroScript-Free
pip install websockets
```

## 3. Point it at a non-Roblox target

Replace `config.json` with a generic profile. Example using a filesystem MCP
server over a folder on the phone:

```json
{
  "target": {
    "id": "files",
    "kind": "generic",
    "name": "my phone files",
    "short": "Files",
    "offline_hint": "Check the MCP server command is installed in Termux."
  },
  "mcpServers": {
    "files": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data/data/com.termux/files/home/notes"]
    }
  }
}
```

That one needs Node: `pkg install nodejs -y`. Any MCP server Termux can execute
works — see `config.examples.json`.

Start it:

```bash
python bridge.py
```

You want a green `ready N tools available - <your target> connected`. Leave this
Termux session running. Run `termux-wake-lock` (or enable Termux's wake lock
from its notification) so Android doesn't suspend the process when the screen
turns off.

## 4. Install the extension in a browser that supports them

**Kiwi Browser is dead** — discontinued and removed from the Play Store in
January 2025. Do not follow older guides that recommend it. Current options:

- **Microsoft Edge Canary** — inherited Kiwi's extension code. Settings > About,
  tap the build number 5 times to unlock Developer Options, then use
  "Extension install by id" or load an unpacked/CRX extension.
- **Quetta** or **Lemur** — Chromium browsers on the Play Store that support
  Chrome Web Store and Edge add-ons, and can sideload a local CRX/ZIP.

ZeroScript is unpacked and unsigned, so you need a browser that accepts a local
folder or a ZIP/CRX you build from `zeroscript-extension/`. Load it, then open
one of the supported AI chat sites (DeepSeek is the most reliable).

## 5. Use it

The status dot should go green and the button should read **▶ Start Files
agent** (or whatever your target's `short` name is). If it says the bridge is
offline, the Termux process died or was suspended by Android's battery
optimisation — re-check step 3 and the wake lock.

## Honest caveats

- This is a **fiddly, unsupported setup**. Upstream tests on Windows/macOS
  desktops; nobody tests Android.
- Android aggressively kills background processes. Expect the bridge to drop
  unless you hold a wake lock and exempt Termux from battery optimisation.
- Mobile Chromium extension support is second-class; MV3 service workers can be
  unreliable on these builds.
- Screen-real-estate: the ZeroScript status bar sits above the chat composer and
  is cramped on a phone.
- **If your goal was Roblox specifically, this does not get you there.** No
  amount of phone setup gives you Roblox Studio.
