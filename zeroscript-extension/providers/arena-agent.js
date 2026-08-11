// SPDX-License-Identifier: GPL-3.0-or-later
// providers/arena-agent.js - the Arena AGENT MODE provider (arena.ai/agent).
//
// Exports the same ZSProvider interface as providers/arena.js; the core
// (core/main.js) is provider-agnostic.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE USING IT
//
// Agent Mode is Arena's OWN autonomous agent: it has a workspace, file uploads
// and its own tool loop (the page exposes "Open workspace", "Toggle workspace
// sidebar", "Add files"). Running ZeroScript on top means TWO agent loops share
// one composer and each reads the other's output. Direct mode is the supported,
// upstream-tested path and does the same job. This provider exists because it
// was explicitly asked for; treat it as experimental.
// ─────────────────────────────────────────────────────────────────────────────
//
// DOM notes - derived from live captures of /agent (2026-08), NOT from the
// /text/direct layout, which does not apply here:
//
//  - There is NO message list. /agent has no <ol>, <ul>, role="log" or
//    role="feed" (verified: the query returned an empty array). Turns are
//    plain <div>s inside a scroll container, so allItems() collects the turn
//    BODIES directly instead of listing children of a list element.
//
//  - CRITICAL COLLISION: the composer is a TipTap/ProseMirror contenteditable
//    that itself carries `prose`:
//        "tiptap ProseMirror prose max-w-none … bg-surface-secondary"
//    A bare `.prose` selector therefore matches the INPUT BOX. Left unhandled
//    the core would read the user's own typing as an assistant reply, parse
//    commands out of it and feed results back into it - a self-feeding loop.
//    Every lookup here filters `.prose` WITHOUT `.tiptap`/`.ProseMirror`.
//
//  - Turn bodies are `div.prose … body-base`, each inside `div.flex.flex-col.gap-2`.
//    The ROLE lives on the grandparent:
//        user      -> "px-3 text-text-primary body-base py-2"
//        assistant -> "px-3 pb-3"
//    Verified against a real two-exchange transcript: classification alternated
//    user/assistant/user/assistant exactly.
//
//  - DOM order is chronological (oldest first) - unlike /text/direct, which is
//    flex-col-reverse. Do NOT reverse here.
//
//  - The send button is aria-label "Send message". A stop control was not
//    observed while idle; isGenerating() therefore falls back to stream-growth
//    tracking, which is what the DeepSeek provider does during reasoning.
//
//  - The composer is contenteditable, NOT a <textarea>: value must be set via
//    an input event / execCommand path, not the native textarea setter.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};

  // A turn's OUTER wrapper. The role classes live here (see DOM notes), and
  // crucially this exists even when the reply contains NO .prose paragraph -
  // e.g. a reply that is only a code/JSON widget ("{} JSON" + copy button) or
  // only a "Thought for N seconds" block. Keying turns on .prose alone made
  // such replies invisible: assistantCount() never rose, the core waited out
  // NO_TURN_GRACE and reported "Arena Agent did not respond in time" even
  // though the model HAD answered (seen live 2026-08 on the very first
  // list_commands turn, which Arena renders as a JSON widget).
  // Anchor on the TURN INNER, not the outer wrapper.
  //
  // The outer wrapper's class varies: a plain text reply sits under
  // "px-3 pb-3", but the failing list_commands reply (a "Thought for N
  // seconds" block plus a JSON widget) is laid out differently - the captured
  // ancestor chain from that widget was:
  //     CODE > PRE.shiki > .code-block_container > .not-prose > PRE
  //          > .prose > .flex.flex-col.gap-2 > (wrapper)
  // Every turn observed so far - text, widget, or both - has the SAME inner
  // container: div.flex.flex-col.gap-2. Keying on that is stable, whereas
  // guessing the outer class made widget-only turns invisible: allItems()
  // skipped them, so the JSON never reached the parser even though the parser
  // handles it correctly (verified against the exact captured text).
  const TURN_INNER = "div.flex.flex-col.gap-2";
  // The role classes live 1-2 levels ABOVE the inner container, so look upward
  // rather than assuming a fixed depth.
  const ROLE_UP = 3;

  const S = {
    // The composer: TipTap contenteditable.
    // Match on the TipTap classes only - NOT on contenteditable="true".
    // Arena DISABLES the composer while the agent is generating (it flips
    // contenteditable off), so a selector requiring "true" returns null for the
    // whole generation. Reported live by the in-page self-test:
    //   "getEditor() finds the composer -> null" with generating:true.
    // The bar then cannot anchor and the loop cannot send its next turn.
    editor: '.tiptap[contenteditable], .ProseMirror[contenteditable], ' +
            'div.tiptap, div.ProseMirror',
    // A turn body is .prose that is NOT the composer.
    proseAny: ".prose",
    sendAria: /send message/i,
    stopAria: /stop|cancel|arr[êe]ter/i,
    errorSurfaces:
      '[role="alert"],[class*="toast"],[class*="error"],[data-sonner-toast]',
  };

  // ── the collision guard ────────────────────────────────────────────────────
  // TRUE only for a real transcript body. The composer shares `.prose`, so it
  // must be excluded everywhere or the agent reads its own input as a reply.
  const isComposerNode = (el) =>
    !!el && (el.classList.contains("tiptap") ||
             el.classList.contains("ProseMirror") ||
             el.isContentEditable ||
             !!el.closest('[contenteditable="true"]'));

  const isTurnBody = (el) =>
    !!el && el.classList && el.classList.contains("prose") && !isComposerNode(el);

  // Is this wrapper a real transcript turn? It must carry one of the two role
  // shapes AND hold some content, but must never be the composer's own
  // container. Widget-only replies (JSON blocks, thought blocks) qualify.
  // Walk up looking for whichever ancestor carries a role class. Returns
  // "user" | "assistant"; defaults to assistant, matching the observed layout
  // where only user turns are specially marked.
  const roleFromAncestors = (el) => {
    let n = el;
    for (let i = 0; i < ROLE_UP && n; i++) {
      const c = n.className || "";
      if (typeof c === "string" && /text-text-primary/.test(c) && /py-2/.test(c))
        return "user";
      n = n.parentElement;
    }
    return "assistant";
  };

  // Arena's own UI chrome reuses div.flex.flex-col.gap-2. The "Do you want to
  // undo the last turn? / Undo" banner did, and was counted as the NEWEST
  // assistant turn: lastAssistant() returned the banner, so the parser saw
  // "nothing to parse" while the model's real reply sat one turn earlier
  // (seen live 2026-08-05).
  //
  // Exclude by LOCATION rather than by requiring a specific wrapper class.
  // Turn wrappers vary (px-3 pb-3, px-3 text-text-primary py-2, and
  // relative pl-6 pr-2 pt-4 for a thought block - requiring px-3 hid that
  // last one, which a replayed fixture caught). What chrome has in common is
  // that it lives in the COMPOSER area below the transcript.
  const inComposerArea = (el) => {
    let n = el;
    for (let i = 0; i < 6 && n; i++) {
      const c = typeof n.className === "string" ? n.className : "";
      if (/\bpx-4\b/.test(c) && /\bpb-6\b/.test(c)) return true;
      n = n.parentElement;
    }
    return false;
  };

  const isTurnWrap = (el) => {
    if (!el || isComposerNode(el)) return false;
    if (el.querySelector && el.querySelector('[contenteditable="true"]')) return false;
    if (inComposerArea(el)) return false;
    // A turn counts if it has text, a code/JSON widget, OR a .prose body that
    // is merely still empty.
    //
    // That last case matters: Arena inserts the assistant's turn BEFORE the
    // first token arrives, so requiring content made the opening moments of
    // every reply invisible. assistantCount() then did not rise when the reply
    // began, and the core could conclude the model never answered - the same
    // class of failure as the widget-only reply. Caught by the HTTP mock's
    // "thinking" scenario, not by inspection.
    const txt = (el.textContent || "").trim();
    if (txt.length) return true;
    if (el.querySelector && el.querySelector("pre, code, .not-prose")) return true;
    // An empty .prose body means a reply that has started but written nothing
    // yet. Must exclude the COMPOSER, which also carries .prose (tiptap) - the
    // naive version of this counted the composer's wrapper as a third turn.
    if (!el.querySelector) return false;
    const bodies = [...el.querySelectorAll(".prose")]
      .filter((n) => !n.classList.contains("tiptap") &&
                     !n.classList.contains("ProseMirror") &&
                     !n.isContentEditable);
    return bodies.length > 0;
  };

  // Role lives on the grandparent's class list (see DOM notes).
  const roleOf = (el) => {
    const g = el && el.parentElement && el.parentElement.parentElement;
    const c = (g && g.className) || "";
    if (/text-text-primary/.test(c) && /py-2/.test(c)) return "user";
    return "assistant";
  };

  // ── turns ──────────────────────────────────────────────────────────────────
  function allItems() {
    // Collect TURN WRAPPERS, not .prose bodies: a reply may be a widget with no
    // .prose at all (see TURN_WRAP). Nested wrappers are dropped so one turn is
    // counted once. DOM order here is already chronological.
    const wraps = [...document.querySelectorAll(TURN_INNER)].filter(isTurnWrap);
    return wraps.filter((w) => !wraps.some((o) => o !== w && o.contains(w)));
  }
  const roleOfWrap = (el) => roleFromAncestors(el);
  const isUserItem = (el) => isTurnWrap(el) && roleOfWrap(el) === "user";
  const isAssistantItem = (el) => isTurnWrap(el) && roleOfWrap(el) === "assistant";
  const itemText = (el) => (el && el.textContent) || "";

  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => {
    const a = assistantItems();
    return a.length ? a[a.length - 1] : null;
  };
  // No stable per-turn id attribute was observed; index is stable because turns
  // are appended and never virtualised away on this route.
  const lastAssistantId = () => {
    const n = assistantCount();
    return n ? `a${n}` : "";
  };
  const readAssistant = (el) => itemText(el || lastAssistant());
  const snapshot = () => ({ a: assistantCount(), u: userCount() });
  const classifyText = (el) => itemText(el);

  // ── generation detection ───────────────────────────────────────────────────
  // A stop button is the strongest signal when present; otherwise fall back to
  // stream growth (the reply text getting longer), which is how the DeepSeek
  // provider survives its reasoning phase where no spinner exists.
  const buttonsByAria = (re) =>
    [...document.querySelectorAll("button[aria-label]")].filter(
      (b) => re.test(b.getAttribute("aria-label") || "") && b.offsetParent !== null);

  const sendButton = () => buttonsByAria(S.sendAria)[0] || null;
  const stopButton = () => {
    // Only treat it as a stop control if it is NOT the send button.
    const send = sendButton();
    return buttonsByAria(S.stopAria).find((b) => b !== send) || null;
  };

  // Streaming detection with NO reliable site signal.
  // Confirmed live: the /agent DOM looks IDENTICAL mid-generation - no stop
  // button appears and no streaming marker is added - so growth of the reply
  // text is the only thing to go on.
  //
  // Two windows, because one is not enough:
  //  - FIRST_TOKEN_MS: an assistant wrapper is inserted BEFORE the model writes
  //    anything, and Arena may spend seconds on a "Thought for N seconds" pass
  //    and on rendering a widget. A single short idle window declared an EMPTY
  //    turn finished (verified by replay: at 3s with 0 chars the old code said
  //    "done"), which is exactly the "did not respond in time" / truncated-read
  //    failure mode. While the turn is still empty we keep waiting much longer.
  //  - IDLE_MS: once text HAS appeared, a shorter stall means finished.
  const FIRST_TOKEN_MS = 45000;
  const IDLE_MS = 4000;
  let _max = -1, _at = 0, _item = null, _born = 0;
  function streamLen(item) {
    const el = item === undefined ? lastAssistant() : item;
    return (el && el.textContent ? el.textContent.length : 0);
  }
  function growing() {
    const el = lastAssistant();
    const len = streamLen(el);
    const now = Date.now();
    if (el !== _item) { _item = el; _max = len; _at = now; _born = now; return true; }
    if (len > _max) { _max = len; _at = now; return true; }
    // Nothing written yet: give the model its full first-token budget.
    if (_max <= 0) return now - _born < FIRST_TOKEN_MS;
    return now - _at < IDLE_MS;
  }
  const isGenerating = () => !!stopButton() || growing();
  const isHardGenerating = () => !!stopButton();
  const isBusyNow = () => isGenerating();

  // ── composer ───────────────────────────────────────────────────────────────
  // The composer, whether or not it is currently editable. Prefer a visible,
  // editable one; fall back to a visible disabled one (mid-generation) so the
  // bar keeps its anchor and the core can wait rather than error out.
  // Visibility WITHOUT offsetParent. offsetParent is null for a
  // position:fixed element and for anything inside a display:none ancestor -
  // and Arena's composer area is re-rendered while the agent generates. A
  // strict offsetParent filter therefore discarded a perfectly usable composer
  // and getEditor() returned null for the whole generation (reported twice by
  // the in-page self-test, both times with generating:true, even though the
  // bootstrap turn had already been sent successfully through that same
  // composer). getClientRects() is the robust test.
  const isVisible = (e) => {
    if (!e) return false;
    if (e.getClientRects && e.getClientRects().length) return true;
    return e.offsetParent !== null; // fallback for detached-but-laid-out cases
  };

  // Widen progressively rather than failing: an editor that exists but is
  // momentarily hidden is far more useful than null, which strands the bar.
  const getEditor = () => {
    const all = [...document.querySelectorAll(S.editor)];
    if (!all.length) return null;
    const visible = all.filter(isVisible);
    const pool = visible.length ? visible : all;
    return pool.find((e) => e.getAttribute("contenteditable") === "true") || pool[0];
  };
  // Can we type into it right now? typeAndSend waits on this instead of
  // assuming the composer is always writable.
  const editorWritable = () => {
    const e = getEditor();
    return !!e && e.getAttribute("contenteditable") === "true";
  };
  const editorText = () => {
    const e = getEditor();
    return e ? (e.textContent || "").trim() : "";
  };
  const chatIsEmpty = () => allItems().length === 0;
  const isFreshChat = () => chatIsEmpty() && !!getEditor();
  // The container the bar is anchored to. MUST be OUTSIDE the contenteditable:
  // closest() starts AT the element, so closest("form, div") returned the
  // editor itself (it is a DIV) and the bar was rendered INSIDE the composer.
  // Arena then treated the bar's own text as the user's draft - the composer
  // filled with "Agent Mode / Drop files / Connect your GitHub" and there was
  // nothing to click (seen live 2026-08-05).
  //
  // Walk UP from the editor's parent to the composer's outer wrapper, and
  // never return a node that contains the editor's editable region only.
  const composerFrame = () => {
    const e = getEditor();
    if (!e) return null;
    let n = e.parentElement;
    // Prefer a real form, else the first ancestor that is NOT part of the
    // editable subtree and has some width to host a bar.
    for (let i = 0; i < 5 && n && n.tagName !== "BODY"; i++) {
      if (n.tagName === "FORM") return n;
      if (!n.isContentEditable && !n.closest('[contenteditable="true"]')) return n;
      n = n.parentElement;
    }
    return e.parentElement && !e.parentElement.isContentEditable
      ? e.parentElement : (e.parentElement || null);
  };
  const barAnchor = () => composerFrame();
  const chipAnchor = () => lastAssistant();
  const chipAppend = true;
  const chipAtItemLevel = false;
  // Where the tool chip goes, and which node it hides.
  //
  // CONTRACT: {parent, ref} or null - NOT an element. Returning the turn made
  // core/main.js call spot.parent.insertBefore(...) with spot.parent undefined:
  // "Cannot read properties of undefined (reading 'insertBefore')", killing
  // startup right after the model wrote a valid command. Found on Dola and
  // present here identically (the same line was copied), so fixed in both.
  const CMD_SHAPE = /\{\s*["']command["']\s*:/;
  function findToolBlockSpot(item /*, chip */) {
    if (!item || !item.querySelectorAll) return null;
    let spot = null;
    item.querySelectorAll("pre").forEach((pre) => {
      if (spot || pre.closest(".zs-chip")) return;
      if (CMD_SHAPE.test(pre.textContent || "")) {
        pre.classList.add("zs-tool-hide");
        item.classList.add("zs-cmd-mask");
        if (pre.parentElement) spot = { parent: pre.parentElement, ref: pre };
      }
    });
    if (spot) return spot;
    const body = item.querySelector(".prose") || item;
    [...(body.children || [])].forEach((el) => {
      if (spot || el.classList.contains("zs-chip") || el.querySelector("pre")) return;
      const t = el.textContent || "";
      if (t.length < 600 && CMD_SHAPE.test(t)) {
        el.classList.add("zs-tool-hide");
        item.classList.add("zs-cmd-mask");
        if (el.parentElement) spot = { parent: el.parentElement, ref: el };
      }
    });
    return spot;
  }

  function setInputLock(on, msg) {
    const e = getEditor();
    if (!e) return;
    try {
      if (on) e.setAttribute("data-zs-locked", "1");
      else e.removeAttribute("data-zs-locked");
      if (msg) e.setAttribute("data-placeholder", msg);
    } catch {}
  }

  // A contenteditable needs real input events; setting textContent alone leaves
  // React/TipTap's model empty and the send button disabled.
  function setEditorText(el, text) {
    el.focus();
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      // insertText fires the beforeinput/input pair TipTap listens for.
      if (!document.execCommand("insertText", false, text)) throw new Error("execCommand");
    } catch {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, data: text,
                                                 inputType: "insertText" }));
    }
  }

  async function waitFor(pred, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
      await sleep(120);
    }
    return false;
  }

  async function typeAndSend(text) {
    let editor = getEditor();
    if (!editor) throw new Error("Arena Agent input box not found");
    // The composer is disabled for the whole of the previous generation. Typing
    // into it then silently does nothing, so wait for it to come back first.
    if (!editorWritable()) {
      await waitFor(editorWritable, 120000);
      editor = getEditor() || editor;
    }
    setEditorText(editor, text);
    const ready = () => {
      const b = sendButton();
      return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
    };
    await waitFor(ready, 30000);
    const b = sendButton();
    if (b) b.click();
    else editor.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", bubbles: true, cancelable: true }));
    diag("arena-agent.sent", { len: (text || "").length });
    return true;
  }

  function stopGeneration() {
    const b = stopButton();
    if (b) { try { b.click(); return true; } catch {} }
    return false;
  }

  // ── mode / environment guards ──────────────────────────────────────────────
  const onAgentRoute = () => /^\/agent(\/|$)/.test(location.pathname);
  function modeWarning() {
    if (!onAgentRoute())
      return `This is the Agent Mode provider but the page is not <b>arena.ai/agent</b>.`;
    return "";
  }
  const captchaPresent = () => false;
  const overlayBlocking = () => false;
  const enforceComposer = () => ({ ready: !!getEditor() });
  async function ensureComposerReady() {
    const ok = await waitFor(() => !!getEditor(), 15000);
    return { ready: ok };
  }

  function scanError() {
    for (const n of document.querySelectorAll(S.errorSurfaces)) {
      if (n.offsetParent === null) continue;
      const t = (n.textContent || "").trim();
      if (t) return t.slice(0, 300);
    }
    return "";
  }
  const isBusyMsg = (t) => /rate limit|too many requests|try again/i.test(t || "");
  const isTooLongMsg = (t) => /too long|maximum context|token limit/i.test(t || "");
  const turnHalted = () => false;
  const findContinueBtn = () => null;
  const clickContinueBtn = () => false;

  // Agent Mode has its own file handling ("Add files"); ZeroScript does not
  // drive it. Declaring no vision keeps image-only tools hidden rather than
  // offered and then refused.
  const attachImages = async () => false;
  const clearAttachments = () => {};

  const conversationKey = () => location.pathname;

  function installSendHooks(handlers) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const editor = getEditor();
      if (!editor || !editor.contains(e.target)) return;
      if (editorText() === "") return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(snapshot());
    }, true);
  }

  return {
    id: "arena-agent",
    displayName: "Arena Agent",
    supportsVision: false,
    reliableCounts: true,
    timings: { NO_TURN_GRACE: 30000, IDLE_MS: 8000 },
    init({ diag: d } = {}) { if (d) diag = d; },
    // turns
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, readAssistant,
    streamLen, snapshot,
    // composer / state
    getEditor, editorWritable, editorText, chatIsEmpty, isFreshChat,
    composerFrame, barAnchor,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady, modeWarning, captchaPresent,
    overlayBlocking, turnHalted, findContinueBtn, clickContinueBtn,
    // chips
    chipAnchor, chipAppend, chipAtItemLevel, findToolBlockSpot,
    // errors
    scanError, isBusyMsg, isTooLongMsg,
    // images (not supported here)
    attachImages, clearAttachments, conversationKey,
    installSendHooks,
  };
})();
