// SPDX-License-Identifier: GPL-3.0-or-later
// test-arena-mode.js - Arena's chat-mode gate.
//
// ZeroScript drives Arena only in Direct mode. Agent Mode is a SEPARATE app on
// its own route, and this content script still loads there (the manifest
// matches arena.ai/*). The mode dropdown may not exist on that page, so
// currentMode() returns null - and the deliberate "unknown fails OPEN" rule
// would then allow Start on a page the provider cannot drive at all. These
// tests pin the route check that closes that hole.
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { console.log("PASS ", name); pass++; }
  else { console.log("FAIL ", name, extra === undefined ? "" : "\n      " + extra); fail++; }
};

const onAgentRoute = (p) => /^\/agent(\/|$)/.test(p);

// blocked on every Agent Mode URL shape
for (const p of ["/agent", "/agent/", "/agent/abc-123"]) {
  ok(`Agent route blocked: ${p}`, onAgentRoute(p));
}
// never blocks a normal chat, nor a route that merely starts with "agent"
for (const p of ["/text/direct", "/c/uuid", "/", "/agents", "/agentic"]) {
  ok(`not blocked: ${p}`, !onAgentRoute(p));
}

// the fail-open rule must still hold OFF the agent route
const SUPPORTED = new Set(["direct"]);
const supported = (route, mode) => {
  if (onAgentRoute(route)) return false;
  return mode === null || SUPPORTED.has(mode);
};
ok("unknown mode still fails OPEN in a normal chat", supported("/text/direct", null));
ok("direct is supported", supported("/text/direct", "direct"));
ok("battle is blocked", !supported("/text/direct", "battle"));
ok("side by side is blocked", !supported("/text/direct", "side by side"));
ok("agent ROUTE blocks even when the dropdown reads direct",
   !supported("/agent", "direct"));
ok("agent route blocks when the dropdown is absent", !supported("/agent", null));

// the provider wires it up and explains it accurately
const src = fs.readFileSync(path.join(__dirname, "providers", "arena.js"), "utf8");
ok("provider defines the route check", src.includes("onAgentRoute"));
ok("isSupportedMode consults it", /isSupportedMode[\s\S]{0,120}onAgentRoute/.test(src));
ok("the warning names Agent Mode", /Agent Mode<\/b>|<b>Agent Mode<\/b>/.test(src));
ok("the warning points at a real chat URL", src.includes("arena.ai/text/direct"));
ok("it does NOT just say 'switch the dropdown' on the agent route",
   /separate Arena app/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
