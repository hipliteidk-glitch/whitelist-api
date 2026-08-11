// SPDX-License-Identifier: GPL-3.0-or-later
// test-dola-dom.js - the REAL Dola provider against the REAL captured DOM.
//
// Markup reproduced from live captures of dola.com/chat/<id>, including the
// three things that would otherwise have been guessed wrong:
//   1. the role marker is justify-end on a DESCENDANT, not an ancestor
//   2. the last .v_list_row is a SPACER with no data-observe-row
//   3. Semi keeps a second, class-less <textarea> offscreen for autosize
//
// Run:  node test-dola-dom.js      (needs: npm install --no-save jsdom)
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let JSDOM;
try { ({ JSDOM } = require("jsdom")); }
catch { console.log("SKIP  jsdom not installed - run: npm install --no-save jsdom"); process.exit(0); }

let pass = 0, fail = 0;
const ok = (n, c, extra) => {
  if (c) { console.log("PASS ", n); pass++; }
  else { console.log("FAIL ", n, extra === undefined ? "" : "\n      " + extra); fail++; }
};

// Real class strings from the capture (trimmed but structurally faithful).
const ASSIST_FLEX = "flex flex-row w-full w-full max-w-full s-font-base p-0 bg-transparent group";
const USER_FLEX = "flex flex-row w-full justify-end w-full max-w-full s-font-base p-0 bg-transparent";
const INNER = 'pl-8 pr-0 w-full';

const row = (id, flexCls, text) => `
  <div class=" v_list_row" data-observe-row="${id}" style="width:100%">
    <div class="${INNER}"><div class="my-0 w-full mx-auto"><div class="w-full inner-item-BjaxFt">
      <div class="w-full"><div class="${flexCls}">
        <div class="flex flex-col flex-grow max-w-full min-w-0">${text}</div>
      </div></div>
    </div></div></div>
  </div>`;

const HTML = `<!doctype html><html><body>
<div class="scroller v_list_scroller-BxcoIX"><div class="scroller_content"><div class="list_items">
  <!-- TOP spacer, seen live. Given an id so ONLY the indicator check excludes
       it - otherwise the two guards mask each other. -->
  <div class="v_list_row" data-observe-row="block_spacer_top" style="width:100%;z-index:1">
    <div><div class="v_list_top_indicator-OESqxW"></div><div class="${INNER}">
      <div class="w-full top-item-bAlX0F"></div></div></div>
  </div>
  ${row("block_1275552801841681", USER_FLEX, "O")}
  ${row("block_1275552801841682", ASSIST_FLEX, 'It looks like you only typed "O" - did you mean to send something?')}
  ${row("block_1276056118724113", USER_FLEX, "run list_commands please")}
  ${row("block_1276056118730513", ASSIST_FLEX, '<pre><code>{"command":"list_commands"}</code></pre>')}
  <!-- SPACER A: no data-observe-row (as captured) -->
  <div class="v_list_row" style="width:100%;z-index:1">
    <div><div class="v_list_bottom_indicator-nnTzdE"></div><div class="${INNER}">
      <div class="w-full bottom-item-ProfSp"></div></div></div>
  </div>
  <!-- SPACER B: same indicator but WITH an id, so only the indicator check
       can exclude it. Without this the two guards mask each other and a
       mutation removing either one still passes. -->
  <div class="v_list_row" data-observe-row="block_spacer_999" style="width:100%">
    <div><div class="v_list_bottom_indicator-nnTzdE"></div><div class="${INNER}">
      <div class="w-full bottom-item-ProfSp">   </div></div></div>
  </div>
</div></div></div>
<textarea></textarea>
<div class="container-kxxSU4 flex-1">
  <textarea class="semi-input-textarea semi-input-textarea-autosize"></textarea>
</div>
<button>Send</button>
</body></html>`;

const dom = new JSDOM(HTML, { url: "https://www.dola.com/chat/38416201189847313",
                              pretendToBeVisual: true });
// jsdom gives no layout; treat everything as laid out EXCEPT the bare mirror
// textarea, so the "pick the classed one" logic is genuinely exercised.
Object.defineProperty(dom.window.HTMLElement.prototype, "getClientRects", {
  // BOTH textareas are laid out. Semi's mirror is not hidden in practice, so
  // getEditor() must pick the right one by CLASS, not by visibility - an
  // earlier version of this stub hid the mirror and let a loose "textarea"
  // selector pass by accident.
  value() { return [{ width: 300, height: 40 }]; },
});
Object.defineProperty(dom.window.HTMLElement.prototype, "clientWidth", {
  get() { return this.tagName === "TEXTAREA" ? 200 : 400; },
});

const providerSrc = fs.readFileSync(
  path.join(__dirname, "providers", "dola.js"), "utf8");
const sandbox = {
  window: dom.window, document: dom.window.document,
  location: dom.window.location, navigator: dom.window.navigator,
  setTimeout, clearTimeout, console, Date,
  Event: dom.window.Event, InputEvent: dom.window.InputEvent,
  KeyboardEvent: dom.window.KeyboardEvent,
};
vm.createContext(sandbox);
vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sandbox);
const P = sandbox.__P;

ok("the real provider file loads", !!P && typeof P.allItems === "function");

// ── turns, and the spacer trap ─────────────────────────────────────────────
const items = P.allItems();
ok("allItems() finds the 4 real turns (spacer excluded)", items.length === 4,
   `found ${items.length}`);
ok("the bottom spacer is not a turn",
   !items.some((i) => i.querySelector('[class*="v_list_bottom_indicator"]')));
ok("the TOP spacer is not a turn (it carries an id, so only the indicator check saves us)",
   !items.some((i) => i.querySelector('[class*="v_list_top_indicator"]')));

// ── the role marker (on a DESCENDANT, not an ancestor) ─────────────────────
const users = items.filter(P.isUserItem);
const bots = items.filter(P.isAssistantItem);
ok("2 user turns via justify-end", users.length === 2, `${users.length}`);
ok("2 assistant turns", bots.length === 2, `${bots.length}`);
ok("assistantCount() agrees", P.assistantCount() === 2);
ok("the first turn is the user's 'O'", P.itemText(items[0]).trim() === "O",
   JSON.stringify(P.itemText(items[0]).trim()));
ok("the reply is classified assistant",
   /only typed/.test(P.itemText(items[1])) && P.isAssistantItem(items[1]));

// ── identity, which is what survives virtualisation ────────────────────────
ok("lastAssistantId() returns the stable row id",
   P.lastAssistantId() === "block_1276056118730513", P.lastAssistantId());
ok("lastAssistant() is the newest reply",
   /list_commands/.test(P.readAssistant()), P.readAssistant().slice(0, 40));
ok("reliableCounts is false (list is virtualised)", P.reliableCounts === false);

// ── the command must survive to the parser ─────────────────────────────────
const ZSParse = vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "core", "parser.js"), "utf8") + ";ZSParse",
  { console });
const calls = ZSParse.parseToolCalls(P.readAssistant());
ok("the real parser extracts the command from the real DOM",
   Array.isArray(calls) && calls.length === 1 && calls[0].tool === "list_commands",
   JSON.stringify(calls));

// ── composer: must pick the CLASSED textarea, not Semi's mirror ────────────
const ed = P.getEditor();
ok("getEditor() finds a textarea", !!ed && ed.tagName === "TEXTAREA");
ok("it is the CLASSED one, not the autosize mirror",
   !!ed && /semi-input-textarea/.test(ed.className), ed && ed.className);
ok("the composer is never counted as a turn",
   !items.some((i) => i.querySelector("textarea")));
ok("composerFrame() is outside the textarea",
   !!P.composerFrame() && P.composerFrame() !== ed);
ok("chatIsEmpty() is false with turns present", P.chatIsEmpty() === false);

// ── an empty / signed-out page ─────────────────────────────────────────────
const dom2 = new JSDOM(`<!doctype html><html><body>
  <textarea class="semi-input-textarea"></textarea>
  <button>Log In</button></body></html>`, { url: "https://www.dola.com/chat/" });
Object.defineProperty(dom2.window.HTMLElement.prototype, "getClientRects",
  { value() { return [{ width: 100, height: 20 }]; } });
const sb2 = {
  window: dom2.window, document: dom2.window.document,
  location: dom2.window.location, navigator: dom2.window.navigator,
  setTimeout, clearTimeout, console, Date,
  Event: dom2.window.Event, InputEvent: dom2.window.InputEvent,
  KeyboardEvent: dom2.window.KeyboardEvent,
};
vm.createContext(sb2);
vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb2);
const P2 = sb2.__P;
ok("an empty chat reports 0 turns", P2.allItems().length === 0);
ok("isFreshChat() is true", P2.isFreshChat() === true);
ok("lastAssistant() is null", P2.lastAssistant() === null);
// NOTE: this page has a Log In button but a USABLE composer, which is the
// logged-in-with-a-promo-strip case. It must NOT warn - warning here would
// disable Start on a perfectly good empty chat. The genuinely signed-out
// cases are covered in the block below.
ok("a usable composer means logged in, even with a Log In control present",
   P2.modeWarning() === "", P2.modeWarning());

// ── signed-out detection must not block a LOGGED-IN fresh chat ─────────────
// A visible "Log In" control alone is weak evidence: Dola shows app-promo and
// upsell strips to signed-in users too. Since the warning DISABLES Start, a
// false positive would block the agent on a good empty chat - exactly when the
// user presses Start. Require the composer to be unusable as well.
{
  const mk = (html, { disabled = false } = {}) => {
    const d = new JSDOM(`<!doctype html><html><body>${html}</body></html>`,
                        { url: "https://www.dola.com/chat/1" });
    Object.defineProperty(d.window.HTMLElement.prototype, "getClientRects",
      { value() { return [{ width: 200, height: 30 }]; } });
    if (disabled) d.window.document.querySelector("textarea").disabled = true;
    const sb = {
      window: d.window, document: d.window.document, location: d.window.location,
      navigator: d.window.navigator, setTimeout, clearTimeout, console, Date,
      Event: d.window.Event, InputEvent: d.window.InputEvent,
      KeyboardEvent: d.window.KeyboardEvent,
    };
    vm.createContext(sb);
    vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb);
    return sb.__P;
  };
  const TA = '<textarea class="semi-input-textarea"></textarea>';
  const LOGIN = "<button>Log In</button>";

  ok("logged in, no login control -> no warning",
     mk(TA).modeWarning() === "");
  ok("LOGGED IN but a Log In promo is visible -> still no warning (false positive avoided)",
     mk(TA + LOGIN).modeWarning() === "", mk(TA + LOGIN).modeWarning());
  ok("signed out: login control AND a disabled composer -> warns",
     /log in/i.test(mk(TA + LOGIN, { disabled: true }).modeWarning()));
  ok("no composer at all + login control -> warns",
     /log in/i.test(mk(LOGIN).modeWarning()));
}

// ── findToolBlockSpot must return {parent, ref} or null ────────────────────
// It returned the turn ELEMENT, so core/main.js ran
// spot.parent.insertBefore(...) with spot.parent undefined and startup died
// with "Cannot read properties of undefined (reading 'insertBefore')" - AFTER
// the model had written a perfectly good command.
{
  const withCmd = items[3]; // the turn holding <pre>{"command":"list_commands"}</pre>
  const spot = P.findToolBlockSpot(withCmd);
  ok("findToolBlockSpot finds the command block", !!spot, String(spot));
  ok("it returns a {parent, ref} pair, not an element",
     !!spot && !!spot.parent && !!spot.ref && spot.parent.nodeType === 1,
     JSON.stringify(Object.keys(spot || {})));
  ok("parent really contains ref (insertBefore would succeed)",
     !!spot && spot.parent.contains(spot.ref));
  ok("the command block is marked hidden",
     !!spot && spot.ref.classList.contains("zs-tool-hide"));
  ok("a turn with no command returns null",
     P.findToolBlockSpot(items[0]) === null, String(P.findToolBlockSpot(items[0])));
  ok("a missing item is handled", P.findToolBlockSpot(null) === null);
}

// EVERY provider must honour the same contract - this is a core call site.
{
  const fs2 = require("fs");
  const dir = path.join(__dirname, "providers");
  for (const f of fs2.readdirSync(dir).filter((x) => x.endsWith(".js"))) {
    const src2 = fs2.readFileSync(path.join(dir, f), "utf8");
    if (!/findToolBlockSpot/.test(src2)) continue;
    // A one-line arrow returning a bare element is the shape that broke Dola.
    const bad = /findToolBlockSpot\s*=\s*\(\s*\)\s*=>\s*(?!null)[a-zA-Z_$][\w$]*\(/.test(src2);
    ok(`${f}: findToolBlockSpot does not return a bare element`, !bad);
  }
}

// ── the chip must never be read back as model output ───────────────────────
// Live: readAssistant() returned 'jsonlist_commandsnot run{"command":...}'.
// The prefix is ZeroScript's OWN chip (its label plus the "not run" status),
// glued to the reply because itemText used plain .textContent. That feeds our
// UI text back to the model and can make a command look malformed.
{
  const d = new JSDOM(`<!doctype html><html><body>
   <div class="scroller v_list_scroller-x"><div class="list_items">
    <div class=" v_list_row" data-observe-row="block_1">
      <div class="flex flex-row w-full group">
        <div class="zs-chip cat-tool"><span class="zs-chip-tx">json list_commands</span><span>not run</span></div>
        <div class="flex flex-col flex-grow"><pre><code>{"command":"list_commands"}</code></pre>
        <p>Got it - fetching the full command list.</p></div>
      </div>
    </div>
   </div></div></body></html>`, { url: "https://www.dola.com/chat/9" });
  Object.defineProperty(d.window.HTMLElement.prototype, "getClientRects",
    { value() { return [{ width: 200, height: 30 }]; } });
  const sb = {
    window: d.window, document: d.window.document, location: d.window.location,
    navigator: d.window.navigator, setTimeout, clearTimeout, console, Date,
    Event: d.window.Event, InputEvent: d.window.InputEvent,
    KeyboardEvent: d.window.KeyboardEvent,
  };
  vm.createContext(sb);
  vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb);
  const PC = sb.__P;
  const read = PC.readAssistant();
  ok("the chip's label is not read back", !/json list_commands/.test(read), JSON.stringify(read.slice(0, 60)));
  ok("the chip's status is not read back", !/not run/.test(read), JSON.stringify(read.slice(0, 60)));
  ok("the model's own text IS read", /Got it/.test(read), JSON.stringify(read.slice(0, 60)));
  ok("the command still survives for the parser",
     ZSParse.parseToolCalls(read).length === 1);
}

// ── data-streaming decides "is it still generating", not text growth ───────
// Live failure: a SHORT reply ("Got it - I'm fetching the full command
// reference...") finished inside the growth heuristic's idle window, so
// isGenerating() stayed true, the core waited, and the loop died with "Dola
// did not respond in time" - while the command had already parsed and the
// chip sat on "not run".
{
  const mkStream = (flag) => {
    const d = new JSDOM(`<!doctype html><html><body>
     <div class="scroller v_list_scroller-x"><div class="list_items">
      <div class=" v_list_row" data-observe-row="block_1">
        <div class="flex flex-row w-full group"><div class="flex flex-col flex-grow">
          <div data-streaming="${flag}" class="container-qX9Csx md-box-root">
            <pre><code>{"command":"list_commands"}</code></pre>
            <p>Got it - fetching the command reference.</p>
          </div>
        </div></div>
      </div>
     </div></div></body></html>`, { url: "https://www.dola.com/chat/7" });
    Object.defineProperty(d.window.HTMLElement.prototype, "getClientRects",
      { value() { return [{ width: 200, height: 30 }]; } });
    const sb = {
      window: d.window, document: d.window.document, location: d.window.location,
      navigator: d.window.navigator, setTimeout, clearTimeout, console, Date,
      Event: d.window.Event, InputEvent: d.window.InputEvent,
      KeyboardEvent: d.window.KeyboardEvent,
    };
    vm.createContext(sb);
    vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb);
    return sb.__P;
  };

  const done = mkStream("false");
  ok("a finished reply is NOT generating (data-streaming=false)",
     done.isGenerating() === false, String(done.isGenerating()));
  ok("and its command still parses",
     ZSParse.parseToolCalls(done.readAssistant()).length === 1);

  const live = mkStream("true");
  ok("a streaming reply IS generating (data-streaming=true)",
     live.isGenerating() === true, String(live.isGenerating()));
  ok("isHardGenerating agrees while streaming", live.isHardGenerating() === true);

  // No flag at all -> must fall back to the growth heuristic, not crash.
  const d2 = new JSDOM(`<!doctype html><html><body>
    <div class="scroller v_list_scroller-x"><div class="list_items">
     <div class=" v_list_row" data-observe-row="b1">
      <div class="flex flex-row w-full group"><div class="flex flex-col flex-grow">
        <p>plain reply, no streaming attribute</p></div></div>
     </div></div></div></body></html>`, { url: "https://www.dola.com/chat/8" });
  Object.defineProperty(d2.window.HTMLElement.prototype, "getClientRects",
    { value() { return [{ width: 200, height: 30 }]; } });
  const sb2 = {
    window: d2.window, document: d2.window.document, location: d2.window.location,
    navigator: d2.window.navigator, setTimeout, clearTimeout, console, Date,
    Event: d2.window.Event, InputEvent: d2.window.InputEvent,
    KeyboardEvent: d2.window.KeyboardEvent,
  };
  vm.createContext(sb2);
  vm.runInContext(providerSrc + "\n;globalThis.__P = ZSProvider;", sb2);
  ok("no data-streaming falls back to the heuristic without throwing",
     typeof sb2.__P.isGenerating() === "boolean");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
