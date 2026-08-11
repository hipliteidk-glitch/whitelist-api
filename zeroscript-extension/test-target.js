// SPDX-License-Identifier: GPL-3.0-or-later
// test-target.js - regression tests for the TARGET PROFILE layer.
//
// ZeroScript used to be hardwired to Roblox Studio. The target is now a profile
// the bridge reports, so the same extension can drive any MCP server. These
// tests lock in the two properties that matter:
//   1. NO REGRESSION - with no target (or an explicit roblox one), every string
//      the model sees is byte-for-byte what upstream produced.
//   2. NO LEAKAGE   - with a generic target, nothing mentions Roblox/Luau/Studio.
//
// Run:  node test-target.js
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "core", "config.js"), "utf8");
const ZS = eval(src + ";ZS");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("PASS ", name); pass++; }
  else { console.log("FAIL ", name, extra === undefined ? "" : "\n      " + extra); fail++; }
}

const NB = { id: "notebook", kind: "generic", name: "Notebook", short: "Notebook",
             offline_hint: "Start the notebook app." };
const RBX = { id: "roblox", kind: "roblox", name: "Roblox Studio", short: "Roblox" };

// ── 1. target normalisation ────────────────────────────────────────────────
ok("normTarget defaults to Roblox", ZS.normTarget().id === "roblox" && ZS.isRoblox(ZS.normTarget()));
ok("normTarget keeps a custom profile", ZS.normTarget(NB).name === "Notebook" && !ZS.isRoblox(ZS.normTarget(NB)));
ok("normTarget fills short from name",
   ZS.normTarget({ id: "x", kind: "generic", name: "Thing" }).short === "Thing");
ok("a non-roblox kind is never treated as Roblox", !ZS.isRoblox({ id: "roblox", kind: "generic" }));

// ── 2. no regression on the Roblox path ────────────────────────────────────
const baseline = ZS.buildSystemPrompt({ siteName: "DeepSeek" });
// NOTE: the Roblox prompt is intentionally no longer byte-identical to
// upstream - exactly ONE line was added (the "NEVER invent a command" rule,
// after a live session where the model claimed non-existent shell/screenshot
// commands had "failed"). Nothing upstream was removed or reworded; these
// tests assert the structure below instead of raw equality.
ok("prompt forbids inventing commands", /NEVER invent a command/.test(baseline));
ok("prompt still tells the model to run list_commands",
   /list_commands/.test(baseline));
ok("explicit roblox target === default prompt",
   ZS.buildSystemPrompt({ siteName: "DeepSeek", target: RBX }) === baseline);
ok("string-form opts still supported", ZS.buildSystemPrompt("DeepSeek") === baseline);
ok("roblox prompt keeps the Luau block", /###LUA###/.test(baseline) && /execute_luau/.test(baseline));
ok("roblox prompt keeps project memory", /PROJECT MEMORY/.test(baseline) && /ServerStorage/.test(baseline));
ok("roblox prompt renders `return` cleanly", /`return`/.test(baseline) && !/\\`return/.test(baseline));
ok("targetOffline(roblox) === legacy studioOffline",
   ZS.FEEDBACK.targetOffline(RBX) === ZS.FEEDBACK.studioOffline &&
   ZS.FEEDBACK.targetOffline() === ZS.FEEDBACK.studioOffline);
ok("bridgeOfflineFor(roblox) === legacy bridgeOffline",
   ZS.FEEDBACK.bridgeOfflineFor(RBX) === ZS.FEEDBACK.bridgeOffline);
const someTools = [{ name: "t", description: "d", inputSchema: { properties: { a: {} } } }];
ok("toolsReminder() unchanged with no target",
   ZS.toolsReminder(someTools) === ZS.toolsReminder(someTools, RBX));

// ── 3. no Roblox leakage on a generic target ───────────────────────────────
const generic = ZS.buildSystemPrompt({ siteName: "DeepSeek", target: NB });
const leak = generic.split("\n").filter((l) => /roblox|luau|studio|instance\.new|serverstorage/i.test(l));
ok("generic prompt mentions no Roblox/Luau/Studio", leak.length === 0, leak.join("\n      "));
ok("generic prompt drops the Luau block", !/###LUA###/.test(generic));
ok("generic prompt drops project memory", !/PROJECT MEMORY/.test(generic));
ok("generic prompt names the target", generic.includes("Notebook"));
ok("generic prompt keeps the JSON command contract",
   /"command"/.test(generic) && /list_commands/.test(generic) && /list_mcp_servers/.test(generic));
ok("generic prompt keeps the destructive-action guard", /NEVER DELETE OR OVERWRITE BROADLY/.test(generic));
ok("generic offline feedback uses the hint",
   ZS.FEEDBACK.targetOffline(NB).includes("Start the notebook app.") &&
   !/Roblox/i.test(ZS.FEEDBACK.targetOffline(NB)));
ok("generic bridge-offline feedback is Roblox-free", !/Roblox/i.test(ZS.FEEDBACK.bridgeOfflineFor(NB)));
ok("generic toolsReminder names the target",
   ZS.toolsReminder(someTools, NB).includes("Notebook") &&
   !/Roblox/i.test(ZS.toolsReminder(someTools, NB)));

// ── 4. custom prompt still layers on top ───────────────────────────────────
const withCustom = ZS.buildSystemPrompt({ siteName: "DeepSeek", target: NB, customPrompt: "be terse" });
ok("custom prompt appended for a generic target",
   withCustom.includes("USER'S CUSTOM PROMPT") && withCustom.includes("be terse"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
