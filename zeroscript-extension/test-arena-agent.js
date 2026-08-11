// SPDX-License-Identifier: GPL-3.0-or-later
// test-arena-agent.js - the Arena Agent Mode provider's DOM logic.
//
// Built from live captures of arena.ai/agent. The critical property is the
// COMPOSER COLLISION: the TipTap composer itself carries `prose`, so a naive
// `.prose` lookup returns the input box and the agent would read its own
// typing as an assistant reply, parse commands from it, and feed results back
// into it. These tests pin that guard and the user/assistant discriminator.
//
// Run:  node test-arena-agent.js
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { console.log("PASS ", name); pass++; }
  else { console.log("FAIL ", name, extra === undefined ? "" : "\n      " + extra); fail++; }
};

// ── the real class strings captured from /agent ────────────────────────────
const COMPOSER_CLS =
  "tiptap ProseMirror prose max-w-none focus:outline-none bg-surface-secondary " +
  "max-h-[40vh] min-h-[32px] overflow-y-auto p-1 md:min-h-[80px] md:p-3";
const BODY_CLS =
  "prose prose-pre:bg-transparent prose-pre:p-0 text-wrap break-words prose-base body-base";
const USER_GPARENT = "px-3 text-text-primary body-base py-2";
const ASSISTANT_GPARENT = "px-3 pb-3";

// ── minimal element stand-ins ──────────────────────────────────────────────
function el(cls, { editable = false, gparentCls = null, text = "" } = {}) {
  const node = {
    className: cls,
    textContent: text,
    isContentEditable: editable,
    classList: { contains: (c) => cls.split(/\s+/).includes(c) },
    offsetParent: {},
    closest: (sel) => (editable && sel.includes("contenteditable") ? node : null),
  };
  if (gparentCls !== null) {
    node.parentElement = { parentElement: { className: gparentCls } };
  }
  return node;
}

// ── the logic under test, mirroring providers/arena-agent.js ───────────────
const isComposerNode = (e) =>
  !!e && (e.classList.contains("tiptap") || e.classList.contains("ProseMirror") ||
          e.isContentEditable || !!e.closest('[contenteditable="true"]'));
const isTurnBody = (e) =>
  !!e && e.classList && e.classList.contains("prose") && !isComposerNode(e);
const roleOf = (e) => {
  const g = e && e.parentElement && e.parentElement.parentElement;
  const c = (g && g.className) || "";
  return /text-text-primary/.test(c) && /py-2/.test(c) ? "user" : "assistant";
};

// ── the collision ──────────────────────────────────────────────────────────
const composer = el(COMPOSER_CLS, { editable: true });
ok("the composer is NOT treated as a turn body", !isTurnBody(composer));
ok("the composer IS recognised as the composer", isComposerNode(composer));

const body = el(BODY_CLS, { gparentCls: ASSISTANT_GPARENT, text: "hi" });
ok("a real reply IS a turn body", isTurnBody(body));
ok("a real reply is not the composer", !isComposerNode(body));

// ── user vs assistant, against the captured transcript ─────────────────────
// A REAL 14-turn transcript captured from /agent. Note it does NOT strictly
// alternate: the user sent two messages in a row more than once (sequence is
// UUAUAUAUUAUAUA). An earlier version of this test asserted alternation from a
// 4-turn sample - that was an accident of the sample, not a property of the
// site, so nothing may depend on it.
const REAL = [
  ["user", "https://github.com/hipliteidk-glitch/pot"],
  ["user", "Write essay"],
  ["assistant", "The Evolution of Game Creation: An Overv"],
  ["user", "How many words"],
  ["assistant", "The essay is 576 words long."],
  ["user", "I want 1 min"],
  ["assistant", "ZeroScript Free: AI-Powered Roblox Devel"],
  ["user", "I want u speak 1 min"],
  ["user", "I want u text 1 min"],
  ["assistant", "ZeroScript Free is an innovative, open-s"],
  ["user", "I want u text 1 min not read u didn't te"],
  ["assistant", "ZeroScript Free represents a significant"],
  ["user", "Text then sleep"],
  ["assistant", "ZeroScript Free is a revolutionary open-"],
];
const transcript = REAL.map(([role, text]) =>
  el(BODY_CLS, { gparentCls: role === "user" ? USER_GPARENT : ASSISTANT_GPARENT, text }));
const roles = transcript.map(roleOf);
ok("every turn in a real 14-turn transcript is classified correctly",
   roles.join() === REAL.map((r) => r[0]).join(), roles.join());
ok("assistant turns counted correctly", roles.filter((r) => r === "assistant").length === 6);
ok("user turns counted correctly", roles.filter((r) => r === "user").length === 8);
ok("consecutive user turns are handled (no alternation assumed)",
   roles[7] === "user" && roles[8] === "user");

// with the composer mixed in, it must never be counted
const withComposer = [...transcript, composer];
const bodies = withComposer.filter(isTurnBody);
ok("the composer is excluded from the turn list", bodies.length === 14, `${bodies.length}`);
const lastAssistant = bodies.filter((b) => roleOf(b) === "assistant").pop();
ok("lastAssistant is the newest reply, not the composer",
   lastAssistant.textContent === "ZeroScript Free is a revolutionary open-",
   lastAssistant.textContent);

// ── DOM order is chronological here (NOT reversed like /text/direct) ───────
ok("first turn is the oldest",
   bodies[0].textContent === "https://github.com/hipliteidk-glitch/pot");

// ── the provider file itself ───────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, "providers", "arena-agent.js"), "utf8");
ok("provider guards the composer collision", src.includes("isComposerNode"));
ok("provider documents that there is no message list", /NO message list/i.test(src));
ok("provider does NOT reverse DOM order", !/\.reverse\(\)/.test(src));
ok("provider declares no vision (image tools stay hidden)",
   /supportsVision:\s*false/.test(src));
ok("provider warns it is experimental", /experimental/i.test(src));
ok("provider uses execCommand for the contenteditable",
   src.includes("insertText"));
ok("provider exports the interface the core needs",
   ["allItems", "assistantCount", "lastAssistant", "typeAndSend", "getEditor",
    "installSendHooks", "streamLen", "snapshot"].every((k) => src.includes(k)));

// ── widget-only replies must still count as a turn ─────────────────────────
// Live failure (2026-08): the first list_commands reply rendered as a JSON
// widget + "Thought for 1 second", with NO .prose paragraph. Keying turns on
// .prose alone made it invisible, so the core reported "did not respond in
// time" even though the model had answered.
{
  const wrap = (cls, { text = "", widget = false, editable = false } = {}) => ({
    className: cls,
    textContent: text,
    isContentEditable: false,
    classList: { contains: (c) => cls.split(/\s+/).includes(c) },
    offsetParent: {},
    closest: () => null,
    querySelector: (sel) => {
      if (sel.includes("contenteditable")) return editable ? {} : null;
      return widget && /pre|code|not-prose/.test(sel) ? {} : null;
    },
  });
  const isComposer = (e) => !!e && (e.classList.contains("tiptap") ||
    e.classList.contains("ProseMirror") || e.isContentEditable);
  const isTurnWrap = (el) => {
    if (!el || isComposer(el)) return false;
    if (el.querySelector && el.querySelector('[contenteditable="true"]')) return false;
    const c = el.className || "";
    const roleish = (/text-text-primary/.test(c) && /py-2/.test(c)) || /\bpb-3\b/.test(c);
    if (!roleish) return false;
    const txt = (el.textContent || "").trim();
    const hasWidget = !!(el.querySelector && el.querySelector("pre, code, .not-prose"));
    return txt.length > 0 || hasWidget;
  };
  const roleOfWrap = (el) => /text-text-primary/.test(el.className) &&
    /py-2/.test(el.className) ? "user" : "assistant";

  const jsonOnly = wrap("px-3 pb-3", { text: "", widget: true });
  ok("a widget-only reply still counts as a turn", isTurnWrap(jsonOnly));
  ok("a widget-only reply is an assistant turn", roleOfWrap(jsonOnly) === "assistant");

  const textReply = wrap("px-3 pb-3", { text: "Hey!" });
  ok("a normal text reply still counts", isTurnWrap(textReply));

  const userTurn = wrap("px-3 text-text-primary body-base py-2", { text: "Oo" });
  ok("a user turn is still detected", isTurnWrap(userTurn) && roleOfWrap(userTurn) === "user");

  const composerWrap = wrap("px-3 pb-3", { text: "typing", editable: true });
  ok("the composer wrapper is never a turn", !isTurnWrap(composerWrap));

  const empty = wrap("px-3 pb-3", { text: "" });
  ok("an empty wrapper with no widget is not a turn", !isTurnWrap(empty));

  const unrelated = wrap("px-3", { text: "toolbar" });
  ok("a non-role wrapper is not a turn", !isTurnWrap(unrelated));

  const src2 = fs.readFileSync(path.join(__dirname, "providers", "arena-agent.js"), "utf8");
  ok("provider keys turns on wrappers", src2.includes("TURN_WRAP"));
  ok("provider de-duplicates nested wrappers", src2.includes("o.contains(w)"));
}

// ── the widget-only reply that actually failed live ────────────────────────
// Captured ancestor chain from the JSON widget of a failing list_commands
// reply:  CODE > PRE.shiki > .code-block_container > .not-prose > PRE
//              > .prose > .flex.flex-col.gap-2 > (outer wrapper)
// The outer wrapper class VARIES, so keying on it hid this turn. The inner
// container is constant, so turns anchor there.
{
  const mk = (cls, { text = "", widget = false, parent = null, editable = false } = {}) => ({
    className: cls,
    textContent: text,
    isContentEditable: false,
    classList: { contains: (c) => cls.split(/\s+/).includes(c) },
    offsetParent: {},
    parentElement: parent,
    closest: () => null,
    querySelector: (sel) => {
      if (sel.includes("contenteditable")) return editable ? {} : null;
      return widget && /pre|code|not-prose/.test(sel) ? {} : null;
    },
    contains: () => false,
  });

  const isComposer = (e) => !!e && (e.classList.contains("tiptap") ||
    e.classList.contains("ProseMirror") || e.isContentEditable);
  const isTurnWrap = (el) => {
    if (!el || isComposer(el)) return false;
    if (el.querySelector && el.querySelector('[contenteditable="true"]')) return false;
    const txt = (el.textContent || "").trim();
    const hasWidget = !!(el.querySelector && el.querySelector("pre, code, .not-prose"));
    return txt.length > 0 || hasWidget;
  };
  const roleFromAncestors = (el) => {
    let n = el;
    for (let i = 0; i < 3 && n; i++) {
      const c = n.className || "";
      if (typeof c === "string" && /text-text-primary/.test(c) && /py-2/.test(c)) return "user";
      n = n.parentElement;
    }
    return "assistant";
  };

  // the real failing reply: thought block + JSON widget, no plain paragraph
  const outer = mk("px-3 pb-3");
  const inner = mk("flex flex-col gap-2", {
    text: 'JSON{"command":"list_commands"}', widget: true, parent: outer });
  ok("the widget-only turn IS collected", isTurnWrap(inner));
  ok("the widget-only turn is an assistant turn", roleFromAncestors(inner) === "assistant");
  ok("its text carries the JSON for the parser",
     inner.textContent.includes('"command":"list_commands"'));

  // an outer wrapper with an UNEXPECTED class must still work
  const oddOuter = mk("relative pl-6 pr-2 pt-4");
  const oddInner = mk("flex flex-col gap-2", {
    text: 'JSON{"command":"list_commands"}', widget: true, parent: oddOuter });
  ok("an unexpected outer wrapper class no longer hides the turn", isTurnWrap(oddInner));
  ok("it still classifies as assistant", roleFromAncestors(oddInner) === "assistant");

  // a user turn: the role class is on an ancestor
  const userOuter = mk("px-3 text-text-primary body-base py-2");
  const userInner = mk("flex flex-col gap-2", { text: "Write essay", parent: userOuter });
  ok("a user turn is found via its ancestor role class",
     roleFromAncestors(userInner) === "user");

  // the composer must never count
  const compInner = mk("flex flex-col gap-2", { text: "typing", editable: true });
  ok("the composer is still excluded", !isTurnWrap(compInner));

  const src4 = fs.readFileSync(path.join(__dirname, "providers", "arena-agent.js"), "utf8");
  ok("provider anchors on the inner container", src4.includes("TURN_INNER"));
  ok("provider looks upward for the role", src4.includes("roleFromAncestors"));
  ok("provider records the captured chain", src4.includes("code-block_container"));
}

// ── streaming detection with no site signal ────────────────────────────────
// Confirmed live: the /agent DOM is IDENTICAL mid-generation - no stop button,
// no streaming marker - so growth is the only signal. The turn wrapper is
// inserted BEFORE any text, so a single short idle window declared an EMPTY
// turn finished, which reads as "did not respond in time".
{
  const FIRST_TOKEN_MS = 45000, IDLE_MS = 4000;
  let _max = -1, _at = 0, _item = null, _born = 0;
  const growing = (el, len, now) => {
    if (el !== _item) { _item = el; _max = len; _at = now; _born = now; return true; }
    if (len > _max) { _max = len; _at = now; return true; }
    if (_max <= 0) return now - _born < FIRST_TOKEN_MS;
    return now - _at < IDLE_MS;
  };

  const slow = {};
  growing(slow, 0, 0);
  ok("an empty new turn is generating", growing(slow, 0, 100));
  ok("still generating at 3s with no text yet", growing(slow, 0, 3000));
  ok("still generating at 30s with no text yet", growing(slow, 0, 30000));
  ok("gives up after the first-token budget", !growing(slow, 0, FIRST_TOKEN_MS + 1000));

  const norm = {};
  growing(norm, 0, 0);
  ok("generating while text grows", growing(norm, 40, 1000));
  ok("still generating during a short stall", growing(norm, 40, 3000));
  ok("finished after the idle window", !growing(norm, 40, 8000));

  const src3 = fs.readFileSync(path.join(__dirname, "providers", "arena-agent.js"), "utf8");
  ok("provider has a separate first-token budget", src3.includes("FIRST_TOKEN_MS"));
  ok("provider documents that the DOM is identical mid-generation",
     /IDENTICAL mid-generation/i.test(src3));
}

// ── manifest wiring: the two Arena providers must NEVER share a document ───
// Both files declare `const ZSProvider`; loading both would throw
// "Identifier 'ZSProvider' has already been declared" and neither would run.
{
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
  const arenaBlocks = man.content_scripts.filter((cs) =>
    cs.matches.some((m) => m.includes("arena.ai")));
  const direct = arenaBlocks.find((cs) => cs.js.includes("providers/arena.js"));
  const agent = arenaBlocks.find((cs) => cs.js.includes("providers/arena-agent.js"));
  ok("both Arena providers are registered", !!direct && !!agent);
  ok("the agent provider is scoped to /agent",
     !!agent && agent.matches.every((m) => m.includes("/agent")));
  ok("the direct provider EXCLUDES /agent",
     !!direct && (direct.exclude_matches || []).some((m) => m.includes("/agent")));
  ok("they never both load on /agent",
     !!direct && !!agent &&
     (direct.exclude_matches || []).some((m) => m === "https://arena.ai/agent/*"));
  ok("the agent block loads the core too",
     !!agent && agent.js.includes("core/main.js") && agent.js.includes("core/config.js"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
