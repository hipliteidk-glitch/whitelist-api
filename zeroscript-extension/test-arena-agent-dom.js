// SPDX-License-Identifier: GPL-3.0-or-later
// test-arena-agent-dom.js - runs the REAL provider against a REAL DOM.
//
// WHY THIS EXISTS
// test-arena-agent.js re-implements the provider's logic inline and asserts on
// the copy. That catches design mistakes but NOT the thing that actually broke
// live: the shipped file querying a selector that matches nothing. A test that
// re-implements the code can pass while the code fails.
//
// This file instead:
//   1. builds a jsdom document with the EXACT markup captured from arena.ai/agent
//      (including the ancestor chain of a failing JSON widget),
//   2. loads providers/arena-agent.js verbatim into that document,
//   3. calls the real allItems() / lastAssistant() / readAssistant() and feeds
//      the result to the real core/parser.js.
//
// If the provider's selectors are wrong, this fails - which is the point.
//
// Run:  node test-arena-agent-dom.js      (needs: npm install --no-save jsdom)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch {
  console.log("SKIP  jsdom is not installed - run: npm install --no-save jsdom");
  process.exit(0);
}

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { console.log("PASS ", name); pass++; }
  else { console.log("FAIL ", name, extra === undefined ? "" : "\n      " + extra); fail++; }
};

// ── the exact markup captured from arena.ai/agent ──────────────────────────
// User turn, a plain-text assistant reply, and the assistant reply that FAILED
// live: a "Thought for 1 second" block plus a JSON widget and no paragraph.
// The widget's ancestor chain is reproduced verbatim from the capture:
//   CODE > PRE.shiki > .code-block_container > .not-prose > PRE > .prose
//        > .flex.flex-col.gap-2 > wrapper
const PROSE = "prose prose-pre:bg-transparent prose-pre:p-0 text-wrap break-words prose-base body-base";
const HTML = `<!doctype html><html><body>
<div class="relative flex h-full flex-col">
 <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-4">

  <div class="px-3 text-text-primary body-base py-2">
    <div class="flex flex-col gap-2"><div class="${PROSE}">Write essay</div></div>
  </div>

  <div class="px-3 pb-3">
    <div class="flex flex-col gap-2"><div class="${PROSE}">The essay is 576 words long.</div></div>
  </div>

  <div class="px-3 text-text-primary body-base py-2">
    <div class="flex flex-col gap-2"><div class="${PROSE}">list your commands</div></div>
  </div>

  <!-- a reply whose widget has NO extractable text of its own (e.g. an image
       or a still-rendering code block). textContent is whitespace only, so the
       widget check - not the text check - is what must keep it visible. -->
  <div class="px-3 pb-3">
    <div class="flex flex-col gap-2">
      <div class="${PROSE}">   <pre class="shiki"></pre>   </div>
    </div>
  </div>

  <!-- the reply that failed live: thought block + JSON widget, NO paragraph -->
  <div class="relative pl-6 pr-2 pt-4">
    <div class="flex flex-col gap-2">
      <div class="${PROSE}">
        <pre><div class="not-prose my-0 flex w-full flex-col overflow-clip border border-border"
             ><div class="code-block_container__lbMX4"
             ><pre class="shiki github-dark shiki-code-block"
             ><code class="whitespace-pre-wrap break-words">{"command":"list_commands"}</code></pre></div></div></pre>
      </div>
    </div>
  </div>

 </div>
 <div class="relative px-4 pb-4">
   <div class="flex flex-col gap-2">
     <div contenteditable="true"
          class="tiptap ProseMirror prose max-w-none bg-surface-secondary">typed by the user</div>
   </div>
 </div>
 <button aria-label="Send message"></button>
</body></html>`;

const dom = new JSDOM(HTML, { url: "https://arena.ai/agent", pretendToBeVisual: true });

// jsdom leaves offsetParent undefined; the provider uses it as a visibility
// probe, so give every element a truthy one (nothing here is hidden).
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetParent", {
  get() { return this.parentNode || null; },
});

// ── load the REAL provider into that document ──────────────────────────────
const providerSrc = fs.readFileSync(path.join(__dirname, "providers", "arena-agent.js"), "utf8");
const sandbox = {
  window: dom.window, document: dom.window.document,
  location: dom.window.location, navigator: dom.window.navigator,
  setTimeout, clearTimeout, console,
  InputEvent: dom.window.InputEvent, KeyboardEvent: dom.window.KeyboardEvent,
  Event: dom.window.Event, Date,
};
vm.createContext(sandbox);
vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sandbox);
const P = sandbox.__P;

ok("the real provider file loads", !!P && typeof P.allItems === "function");

// ── the actual questions ───────────────────────────────────────────────────
const items = P.allItems();
ok("real allItems() finds all 5 turns", items.length === 5, `found ${items.length}`);

const users = items.filter(P.isUserItem);
const assistants = items.filter(P.isAssistantItem);
ok("2 user turns", users.length === 2, `${users.length}`);
ok("3 assistant turns", assistants.length === 3, `${assistants.length}`);
ok("real assistantCount() agrees", P.assistantCount() === 3, `${P.assistantCount()}`);

const composerText = "typed by the user";
ok("the composer is NEVER returned as a turn",
   !items.some((i) => (i.textContent || "").includes(composerText)));

// the whole point: the widget-only reply must be the newest assistant turn
const last = P.lastAssistant();
const lastText = P.readAssistant(last);
ok("lastAssistant() is the widget-only reply",
   /list_commands/.test(lastText), JSON.stringify((lastText || "").slice(0, 60)));

// ── and the REAL parser must get the command out of it ─────────────────────
const parserSrc = fs.readFileSync(path.join(__dirname, "core", "parser.js"), "utf8");
const ZSParse = vm.runInNewContext(parserSrc + ";ZSParse", { console });
const calls = ZSParse.parseToolCalls(lastText);
ok("the real parser extracts a command from the real DOM text",
   Array.isArray(calls) && calls.length === 1, JSON.stringify(calls));
ok("a text-less widget reply is still collected (widget check, not text)",
   items.some((i) => (i.textContent || "").trim() === "" &&
                     !!i.querySelector("pre, code, .not-prose")));
ok("the command is list_commands",
   calls && calls[0] && calls[0].tool === "list_commands",
   JSON.stringify(calls && calls[0]));

// ── composer plumbing ──────────────────────────────────────────────────────
ok("getEditor() finds the TipTap composer", !!P.getEditor());
ok("editorText() reads it", P.editorText() === composerText, P.editorText());
ok("chatIsEmpty() is false with turns present", P.chatIsEmpty() === false);

// ── the composer while GENERATING ──────────────────────────────────────────
// Reported by the in-page self-test on a live page (generating:true):
//   "getEditor() finds the composer -> null - the bar cannot anchor"
// Arena disables the composer for the whole generation, so a selector keyed on
// contenteditable="true" finds nothing and the loop cannot send its next turn.
{
  const gen = new JSDOM(`<!doctype html><html><body>
    <div class="px-3 pb-3"><div class="flex flex-col gap-2">
      <div class="${PROSE}">generating…</div></div></div>
    <div class="relative px-4 pb-4"><div class="flex flex-col gap-2">
      <div contenteditable="false" class="tiptap ProseMirror prose"></div>
    </div></div>
    <button aria-label="Send message"></button>
  </body></html>`, { url: "https://arena.ai/agent" });
  Object.defineProperty(gen.window.HTMLElement.prototype, "offsetParent",
    { get() { return this.parentNode || null; } });
  const sb = {
    window: gen.window, document: gen.window.document,
    location: gen.window.location, navigator: gen.window.navigator,
    setTimeout, clearTimeout, console, Date,
    InputEvent: gen.window.InputEvent, KeyboardEvent: gen.window.KeyboardEvent,
    Event: gen.window.Event,
  };
  vm.createContext(sb);
  vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb);
  const PG = sb.__P;
  ok("getEditor() still finds a DISABLED composer", !!PG.getEditor());
  ok("editorWritable() reports it is not writable", PG.editorWritable() === false);
  ok("the disabled composer is still not a turn",
     !PG.allItems().some((i) => i.querySelector && i.querySelector(".tiptap")));
}

// ── composer present but offsetParent === null ─────────────────────────────
// Reported TWICE by the live self-test with generating:true, even though the
// bootstrap turn had already been sent through that same composer - so the
// selector was right and the VISIBILITY test was wrong. offsetParent is null
// for position:fixed elements and inside display:none ancestors; Arena
// re-renders the composer area while generating.
{
  const fx = new JSDOM(`<!doctype html><html><body>
    <div class="px-3 pb-3"><div class="flex flex-col gap-2">
      <div class="${PROSE}">reply</div></div></div>
    <div class="relative px-4 pb-4"><div class="flex flex-col gap-2">
      <div contenteditable="true" class="tiptap ProseMirror prose"></div>
    </div></div>
  </body></html>`, { url: "https://arena.ai/agent" });
  // offsetParent null everywhere (what a fixed/hidden container looks like),
  // but the element still has layout boxes.
  Object.defineProperty(fx.window.HTMLElement.prototype, "offsetParent",
    { get() { return null; } });
  fx.window.HTMLElement.prototype.getClientRects = function () {
    return this.classList && (this.classList.contains("tiptap") ||
      this.classList.contains("prose")) ? [{ width: 300, height: 40 }] : [];
  };
  const sb = {
    window: fx.window, document: fx.window.document,
    location: fx.window.location, navigator: fx.window.navigator,
    setTimeout, clearTimeout, console, Date,
    InputEvent: fx.window.InputEvent, KeyboardEvent: fx.window.KeyboardEvent,
    Event: fx.window.Event,
  };
  vm.createContext(sb);
  vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb);
  const PF = sb.__P;
  ok("getEditor() survives offsetParent === null", !!PF.getEditor());
  ok("and reports it as writable", PF.editorWritable() === true);
}

// ── the bar must never be anchored INSIDE the composer ─────────────────────
// Seen live: the bar rendered inside the contenteditable, so Arena treated its
// text as the user's draft ("Agent Mode / Drop files / Connect your GitHub"
// appeared in the composer) and Start could not be clicked. Cause:
// closest("form, div") starts AT the element and the editor IS a div.
{
  const frame = P.composerFrame();
  ok("composerFrame() returns something", !!frame);
  const editor = P.getEditor();
  ok("the anchor is NOT the editor itself", frame !== editor);
  ok("the anchor does not sit inside the editable region",
     !!frame && !frame.closest('[contenteditable="true"]'));
  ok("the anchor CONTAINS the editor (so the bar sits with the composer)",
     !!frame && !!editor && frame.contains(editor));
  ok("barAnchor() agrees with composerFrame()", P.barAnchor() === frame);
}

// ── an empty conversation ──────────────────────────────────────────────────
const dom2 = new JSDOM(`<!doctype html><html><body>
  <div class="relative px-4 pb-4"><div class="flex flex-col gap-2">
    <div contenteditable="true" class="tiptap ProseMirror prose">  </div>
  </div></div>
  <button aria-label="Send message"></button>
</body></html>`, { url: "https://arena.ai/agent" });
Object.defineProperty(dom2.window.HTMLElement.prototype, "offsetParent", {
  get() { return this.parentNode || null; },
});
const sandbox2 = {
  window: dom2.window, document: dom2.window.document,
  location: dom2.window.location, navigator: dom2.window.navigator,
  setTimeout, clearTimeout, console,
  InputEvent: dom2.window.InputEvent, KeyboardEvent: dom2.window.KeyboardEvent,
  Event: dom2.window.Event, Date,
};
vm.createContext(sandbox2);
vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sandbox2);
const P2 = sandbox2.__P;
ok("an empty chat reports 0 turns", P2.allItems().length === 0, `${P2.allItems().length}`);
ok("isFreshChat() is true on an empty chat", P2.isFreshChat() === true);
ok("lastAssistant() is null with no turns", P2.lastAssistant() === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
