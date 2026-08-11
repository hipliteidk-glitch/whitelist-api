# Driving something other than Roblox Studio

Upstream ZeroScript is hardwired to Roblox Studio. This vendored copy adds a
**target profile** layer so the same bridge + browser extension can drive *any*
MCP server, with Roblox as just one profile.

Nothing about the Roblox experience changes: with no `target` key in
`config.json` you get the Roblox profile, and the system prompt the model
receives is **byte-for-byte identical** to upstream (locked in by
`zeroscript-extension/test-target.js`).

## How it works

```
AI chat (browser)  ->  ZeroScript extension  ->  bridge.py  ->  ANY MCP server
```

The bridge reads a `target` block from `config.json`, decides what it is
driving, and reports that profile to the extension on every status message. The
extension words its prompt, status bar, buttons and error feedback from that
profile instead of hardcoding "Roblox Studio".

## Configuring a target

Add a `target` block to `config.json` next to `mcpServers`:

```json
{
  "target": {
    "id": "blender",
    "kind": "generic",
    "name": "Blender",
    "short": "Blender",
    "offline_hint": "Open Blender and make sure its MCP add-on is enabled."
  },
  "mcpServers": {
    "blender": { "command": "uvx", "args": ["blender-mcp"] }
  }
}
```

| Field | Meaning |
| --- | --- |
| `id` | Must match a key in `mcpServers`. This becomes the **primary** server (the one `list_commands` defaults to, and the one the extension refuses to let you delete). |
| `kind` | `roblox` keeps all the Windows/StudioMCP supervision. Use `generic` (or anything else) for a normal MCP server. |
| `name` | Display name in the UI and in the model's prompt (e.g. "Blender"). |
| `short` | Short form used in buttons/status ("▶ Start Blender agent"). Defaults to `name`. |
| `offline_hint` | One sentence telling the user how to bring the target up. Shown in the terminal action box, the status bar, and the model's offline error. |
| `probe` | Optional liveness check — see below. |

More ready-to-copy profiles are in `config.examples.json`.

### The `probe` block

Roblox needs a two-level check ("is Studio attached?" and "is a place open?").
Most MCP servers don't. So `probe` is optional:

- **Omit it** (or `"probe": {}`) — readiness is inferred from the server being
  alive and advertising tools. This is right for almost every MCP server.
- **`probe.tool`** — a side-effect-free, no-argument tool the bridge calls to
  confirm the target is really reachable.
- **`probe.state_tool` + `probe.not_ready_markers`** — additionally detect a
  target that is attached but *not usable*; if the state tool's output contains
  any marker substring, the status degrades to "connected but not ready".

A non-Roblox target never inherits Roblox's probe: declaring a different `kind`
without a `probe` disables probing rather than calling `list_roblox_studios`,
which would never resolve.

## What is gated behind `kind: "roblox"`

These only run for a Roblox target, so a generic target never sees Windows-only
or Studio-specific behaviour:

- `StudioMCP.exe` discovery, zombie-process cleanup, and port-13469 squatter
  detection/killing (all Windows-only `tasklist`/`taskkill` work).
- The Studio version-bump scan and the "toggle Assistant Settings > MCP
  Servers" action banners.
- The `###LUA###` / `execute_luau` prompt section, the Luau/`Instance.new`
  build guidance, and the `game.ServerStorage.ZeroScript.Memory` project-memory
  instructions. A generic target keeps the plain JSON command contract and a
  target-neutral "never delete/overwrite broadly" safety rule.

## Tests

```bash
cd zeroscript-extension
node test-target.js     # target profile: no Roblox regression, no leakage
node test-parser.js     # upstream parser tests (unchanged)
```

`test-target.js` asserts both directions that matter: the Roblox prompt/feedback
strings are unchanged, and a generic target's prompt contains **no** mention of
Roblox, Luau or Studio.

## Limitations

- Only **one** primary target at a time. Extra MCP servers still attach as
  addons and are reachable via `list_mcp_servers` / `list_commands` with a
  `server` param.
- The provider files (`providers/*.js`) are about the AI chat sites, not the
  target, so they are untouched.
- Changing `target.id` means the old primary becomes an ordinary addon; keep
  `id` in sync with the `mcpServers` key you actually want as primary.

## Running without a PC

The bridge and browser must be on the same device, but that device does not have
to be a desktop. See `ANDROID.md` for running a **generic** target entirely on an
Android phone via Termux. A Roblox target still requires Windows/macOS.

## Not using MCP at all

You do not even need an MCP server: tools can be declared as plain commands in
`config.json`. See `NO-MCP.md`.
