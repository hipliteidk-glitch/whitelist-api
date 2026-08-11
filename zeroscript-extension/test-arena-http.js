// SPDX-License-Identifier: GPL-3.0-or-later
// test-arena-http.js - drive the real provider against a real HTTP server.
//
// The gap this closes: arena.ai is unreachable from a dev sandbox, and
// Playwright cannot download a browser here either, so until now the only way
// to exercise the provider against a live page was to ask the user to run it
// and paste the result. Round-trips took a message each, and several fixes
// went out unverified.
//
// mock-arena.js serves the SAME page shapes over real HTTP (from real
// captures). This fetches them like a browser would, builds a document, loads
// providers/arena-agent.js verbatim into it, and asserts the provider handles
// every state - including the ones that actually broke: a widget-only reply,
// and a composer disabled mid-generation.
//
// It is not a browser: no CSS, no React, no real streaming. What it does test
// is every selector and every branch of the provider's DOM logic, which is
// where all six live bugs were.
//
// Run:  node test-arena-http.js      (needs: npm install --no-save jsdom)
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const http = require("http");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch { console.log("SKIP  jsdom not installed - run: npm install --no-save jsdom"); process.exit(0); }

const { start } = require("./mock-arena.js");

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { console.log("PASS ", n); pass++; }
  else { console.log("FAIL ", n, extra === undefined ? "" : "\n      " + extra); fail++; }
};

const providerSrc = fs.readFileSync(
  path.join(__dirname, "providers", "arena-agent.js"), "utf8");
const parserSrc = fs.readFileSync(path.join(__dirname, "core", "parser.js"), "utf8");
const ZSParse = vm.runInNewContext(parserSrc + ";ZSParse", { console });

// A real HTTP GET - the point of the exercise.
const get = (url) => new Promise((resolve, reject) => {
  http.get(url, (res) => {
    let body = "";
    res.on("data", (d) => (body += d));
    res.on("end", () => resolve({ status: res.statusCode, body }));
  }).on("error", reject);
});

// Load a fetched page and instantiate the provider against it.
function providerFor(html, url) {
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  // jsdom has no layout: give elements boxes so the provider's visibility
  // checks behave as they do in a browser.
  dom.window.HTMLElement.prototype.getClientRects = function () {
    return [{ width: 200, height: 20 }];
  };
  Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent",
    { get() { return this.parentNode || null; } });
  const sb = {
    window: dom.window, document: dom.window.document,
    location: dom.window.location, navigator: dom.window.navigator,
    setTimeout, clearTimeout, console, Date,
    InputEvent: dom.window.InputEvent, KeyboardEvent: dom.window.KeyboardEvent,
    Event: dom.window.Event,
    chrome: { storage: { local: { get: () => {}, set: () => {} },
                         onChanged: { addListener: () => {} } } },
  };
  vm.createContext(sb);
  vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb);
  return { P: sb.__P, dom };
}

(async () => {
  const { server, url } = await start(0); // ephemeral port
  console.log(`mock Arena serving on ${url}\n`);

  // ── the server really answers ───────────────────────────────────────────
  const root = await get(`${url}/agent`);
  ok("mock serves /agent over HTTP", root.status === 200 && root.body.includes("tiptap"),
     `status=${root.status}`);

  // ── a normal conversation ───────────────────────────────────────────────
  {
    const r = await get(`${url}/agent?state=chat`);
    const { P } = providerFor(r.body, `${url}/agent`);
    ok("chat: provider loads", !!P);
    ok("chat: finds both turns", P.allItems().length === 2, P.allItems().length);
    ok("chat: 1 user / 1 assistant",
       P.allItems().filter(P.isUserItem).length === 1 &&
       P.allItems().filter(P.isAssistantItem).length === 1);
    ok("chat: composer found and writable", !!P.getEditor() && P.editorWritable());
    ok("chat: composer is not a turn",
       !P.allItems().some((i) => i.querySelector && i.querySelector(".tiptap")));
  }

  // ── the live failure: widget reply while generating ─────────────────────
  {
    const r = await get(`${url}/agent?state=widget`);
    const { P } = providerFor(r.body, `${url}/agent`);
    ok("widget: finds both turns", P.allItems().length === 2, P.allItems().length);
    const last = P.lastAssistant();
    ok("widget: lastAssistant is the widget reply", !!last);
    const text = P.readAssistant(last);
    ok("widget: reply text carries the JSON", /list_commands/.test(text),
       JSON.stringify((text || "").slice(0, 70)));
    const calls = ZSParse.parseToolCalls(text);
    ok("widget: the real parser extracts the command",
       Array.isArray(calls) && calls[0] && calls[0].tool === "list_commands",
       JSON.stringify(calls));
    // the composer is DISABLED here - it must still be found
    ok("widget: composer found while generating", !!P.getEditor());
    ok("widget: reported as not writable", P.editorWritable() === false);
  }

  // ── generating with nothing written yet ─────────────────────────────────
  {
    const r = await get(`${url}/agent?state=thinking`);
    const { P } = providerFor(r.body, `${url}/agent`);
    ok("thinking: an empty reply turn still counts",
       P.allItems().length === 2, P.allItems().length);
    ok("thinking: treated as generating", P.isGenerating() === true);
  }

  // ── consecutive user turns (real transcripts do not alternate) ──────────
  {
    const r = await get(`${url}/agent?state=consecutive`);
    const { P } = providerFor(r.body, `${url}/agent`);
    const items = P.allItems();
    ok("consecutive: finds all three turns", items.length === 3, items.length);
    ok("consecutive: two user turns in a row",
       P.isUserItem(items[0]) && P.isUserItem(items[1]) && P.isAssistantItem(items[2]));
  }

  // ── an empty conversation ───────────────────────────────────────────────
  {
    const r = await get(`${url}/agent?state=empty`);
    const { P } = providerFor(r.body, `${url}/agent`);
    ok("empty: no turns", P.allItems().length === 0, P.allItems().length);
    ok("empty: isFreshChat is true", P.isFreshChat() === true);
    ok("empty: lastAssistant is null", P.lastAssistant() === null);
  }

  // ── the route gate still applies ────────────────────────────────────────
  {
    const r = await get(`${url}/agent?state=chat`);
    const { P } = providerFor(r.body, `${url}/agent`);
    ok("mode is supported on /agent", !P.modeWarning());
  }

  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
