# Using ZeroScript without MCP

Upstream ZeroScript can only talk to **MCP servers**: anything you want the AI to
drive must speak JSON-RPC over stdio (`initialize`, `tools/list`, `tools/call`).
That is a lot of ceremony when all you want is *"let the AI run these three
commands."*

This vendored copy adds a **script server**: you declare tools directly in
`config.json` as ordinary commands. No MCP server to install, no protocol to
implement, no `uvx`/`npx` needed.

## The shortest possible example

```json
{
  "target": {
    "id": "shell",
    "kind": "generic",
    "name": "my computer",
    "short": "Shell"
  },
  "servers": {
    "shell": {
      "type": "script",
      "tools": [
        {
          "name": "list_files",
          "description": "List the files in a folder.",
          "params": { "path": { "description": "folder to list", "required": true } },
          "run": ["ls", "-la", "{path}"]
        },
        {
          "name": "read_file",
          "description": "Show the contents of a file.",
          "params": { "path": "file to read" },
          "run": ["cat", "{path}"]
        }
      ]
    }
  }
}
```

Then `python bridge.py`. That's it — the AI now has `list_files` and
`read_file`, with no MCP anywhere in the stack.

## How a tool is defined

| Key | Required | Meaning |
| --- | --- | --- |
| `name` | yes | The command name the AI writes. |
| `run` | yes | Argv **list**, e.g. `["grep", "-n", "{pattern}", "{path}"]`. `{name}` placeholders are filled from the AI's arguments. |
| `description` | no | Shown to the model. Write it well — this is how the AI knows when to use the tool. |
| `params` | no | Map of parameter name → `{type, description, required}`, or just a description string as shorthand. |
| `cwd` | no | Working directory for the command. |
| `env` | no | Extra environment variables. |
| `timeout` | no | Seconds before the command is killed (default 60). |
| `shell` | no | Run through a shell. **Off by default — see safety below.** |

Placeholder rules:

- `"{path}"` as a whole token becomes exactly **one** argv entry, even if the
  value contains spaces or `;`.
- A placeholder inside a bigger token works too: `"--path={path}"`.
- If the value is a **list**, it expands into several argv entries.
- An omitted optional placeholder at the end is dropped rather than passed as
  an empty string.

## Safety

`run` is a **list executed without a shell**, so a model-supplied argument can
never start a second command. This is tested: passing
`somefile; touch PWNED` as a path produces a "no such file" error and **no**
`PWNED` file.

Setting `"shell": true` opts out of that protection and interpolates arguments
into a shell string. Only use it for fixed commands with no model-controlled
placeholders.

Bear in mind the AI decides when to call these tools. Give it read-only or
narrowly-scoped commands unless you genuinely want it able to modify things,
and prefer a `cwd` plus relative paths over exposing your whole filesystem.

## Mixing with MCP

`servers` and `mcpServers` can both be present — script tools and real MCP
servers run side by side and the AI sees one merged command list (verified in
testing). `mcpServers` alone keeps working exactly as before, so **existing
configs need no changes**.

A server entry is treated as a script server when it has `"type": "script"`
(or declares `tools` with no `command`); otherwise it is launched as MCP.

## Probes

If your target profile declares a `probe`, point it at a script tool that takes
no arguments and exits 0 (e.g. `["true"]` or an `echo`). Or omit `probe`
entirely — readiness is then inferred from the server having tools, which is
right for almost every script server.

## Tests

```bash
python3 test_script_server.py    # 48 assertions
```

Covers schema generation, placeholder/argv handling, injection safety, timeouts,
error reporting, and duck-type compatibility with the MCP client.

## Limitations

- Tools are **stateless one-shot commands**. There is no long-lived session
  between calls; use a wrapper script if you need state.
- No image output — script tools return text only (MCP servers can return
  images).
- The command must exist on the machine running the bridge.
