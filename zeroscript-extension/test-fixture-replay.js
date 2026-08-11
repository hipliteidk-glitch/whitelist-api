// SPDX-License-Identifier: GPL-3.0-or-later
// test-fixture-replay.js - replay a captured page as an offline regression test.
//
//   node test-fixture-replay.js fixtures/arena-agent-widget.json
//   node test-fixture-replay.js            # replays every file in fixtures/
//
// The extension's self-test (core/selftest.js, via the popup button) exports a
// JSON fixture containing the real markup of the turns it saw. This harness
// rebuilds that markup in jsdom, loads the REAL provider file into it, and
// asserts the provider can still find the turns and parse a command.
//
// That is the missing half of the loop: a bug reproduced once on the real site
// becomes a test that runs forever offline, instead of a screenshot that has to
// be re-diagnosed by hand every time something changes.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch { console.log("SKIP  jsdom not installed - run: npm install --no-save jsdom"); process.exit(0); }

const DIR = path.join(__dirname, "fixtures");
const args = process.argv.slice(2);
const files = args.length ? args
  : (fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))
      .map((f) => path.join(DIR, f)) : []);

if (!files.length) {
  console.log("No fixtures. Capture one from the extension popup:");
  console.log("  Run self-test → the report + fixture are copied to your clipboard");
  console.log("  Save the FIXTURE section as fixtures/<name>.json");
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { console.log("PASS ", n); pass++; }
  else { console.log("FAIL ", n, extra === undefined ? "" : "\n      " + extra); fail++; }
};

const PROVIDER_FOR = {
  "arena-agent": "providers/arena-agent.js",
  arena: "providers/arena.js",
  deepseek: "providers/deepseek.js",
};

for (const file of files) {
  const fx = JSON.parse(fs.readFileSync(file, "utf8"));
  const name = path.basename(file);
  console.log(`\n=== ${name} — ${fx.url} (${fx.provider}) ===`);

  const providerRel = PROVIDER_FOR[fx.provider];
  if (!providerRel) { ok(`${name}: known provider`, false, `unknown: ${fx.provider}`); continue; }

  // Rebuild the page from the captured turn markup.
  const body = (fx.turns || []).map((t) => t.html).join("\n");
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`,
                        { url: fx.url, pretendToBeVisual: true });
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent",
    { get() { return this.parentNode || null; } });

  const sandbox = {
    window: dom.window, document: dom.window.document,
    location: dom.window.location, navigator: dom.window.navigator,
    setTimeout, clearTimeout, console, Date,
    InputEvent: dom.window.InputEvent, KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    chrome: { storage: { local: { get: () => {}, set: () => {} },
                         onChanged: { addListener: () => {} } },
              runtime: { onMessage: { addListener: () => {} } } },
  };
  vm.createContext(sandbox);
  let P;
  try {
    vm.runInContext(fs.readFileSync(path.join(__dirname, providerRel), "utf8") +
                    "\n;globalThis.__P = ZSProvider;", sandbox);
    P = sandbox.__P;
  } catch (e) { ok(`${name}: provider loads`, false, e.message); continue; }
  ok("provider loads", !!P);

  const items = P.allItems();
  // A fixture may deliberately include NON-turn markup (Arena UI chrome) to
  // prove it is excluded. Count only entries the capture marked as real turns.
  const expected = (fx.turns || []).filter((t) => t.role !== "chrome").length;
  ok(`finds the captured turns (${expected})`, items.length === expected,
     `found ${items.length}`);

  const expectedBots = (fx.turns || []).filter((t) => t.role === "assistant").length;
  const bots = items.filter((i) => { try { return P.isAssistantItem(i); } catch { return false; } });
  ok(`classifies ${expectedBots} assistant turn(s)`, bots.length === expectedBots,
     `got ${bots.length}`);

  // If any captured turn held a command, the provider + parser must recover it.
  const parserSrc = fs.readFileSync(path.join(__dirname, "core", "parser.js"), "utf8");
  const ZSParse = vm.runInNewContext(parserSrc + ";ZSParse", { console });
  const withCmd = (fx.turns || []).filter((t) => /"command"\s*:/.test(t.html));
  if (withCmd.length) {
    const last = P.lastAssistant();
    const txt = last ? P.readAssistant(last) : "";
    const calls = ZSParse.parseToolCalls(txt);
    ok("a command in the captured reply is parsed",
       Array.isArray(calls) && calls.length > 0,
       `text=${JSON.stringify((txt || "").slice(0, 80))} calls=${JSON.stringify(calls)}`);
  }

  // Whatever the page, the composer must never be read as a reply.
  const leak = items.some((i) => i.querySelector &&
    i.querySelector('[contenteditable="true"]'));
  ok("no composer leaked into the turn list", !leak);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
