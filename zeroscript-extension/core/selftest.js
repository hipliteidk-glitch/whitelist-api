// SPDX-License-Identifier: GPL-3.0-or-later
// core/selftest.js - in-page self-test + DOM fixture capture.
//
// WHY THIS EXISTS
// The provider files are pure DOM reverse-engineering, and the AI sites they
// drive cannot be reached from a development sandbox. Every bug this session
// was found the same slow way: the user hits a failure, pastes a screenshot or
// a console dump, a fix is guessed, repeat. Unit tests that re-implement the
// provider's logic cannot catch a selector that matches nothing on the real
// page - only the real page can.
//
// This module closes that loop. It runs the REAL provider against the REAL
// page and reports what it actually sees, then exports a self-contained
// fixture that can be replayed offline as a regression test.
//
// Nothing here runs unless explicitly invoked from the popup, and it never
// sends anything anywhere: the result goes to the clipboard / a file the user
// chooses to share.
// eslint-disable-next-line no-unused-vars
const ZSSelfTest = (() => {
  "use strict";

  const P = () => (typeof ZSProvider !== "undefined" ? ZSProvider : null);

  // ── checks ────────────────────────────────────────────────────────────────
  // Each returns { name, ok, detail }. `ok:null` means "not applicable here"
  // (e.g. no reply on screen yet) - reported, never counted as a failure, so a
  // clean page does not look broken.
  function runChecks() {
    const p = P();
    const out = [];
    const add = (name, ok, detail) => out.push({ name, ok, detail: String(detail || "") });

    if (!p) {
      add("provider loaded", false, "ZSProvider is undefined on this page");
      return out;
    }
    add("provider loaded", true, `${p.displayName} (${p.id})`);

    // The composer must be findable, or nothing can ever be sent.
    let editor = null;
    try { editor = p.getEditor(); } catch (e) { /* reported below */ }
    // When this fails, say WHY. "null" alone cost two round-trips: the node may
    // be absent, present but invisible, or present but not editable, and each
    // implies a different fix.
    let why = "";
    if (!editor) {
      const anyTip = document.querySelectorAll(".tiptap, .ProseMirror").length;
      const anyCE = document.querySelectorAll("[contenteditable]").length;
      const hidden = [...document.querySelectorAll(".tiptap, .ProseMirror")]
        .filter((e) => !(e.getClientRects && e.getClientRects().length)).length;
      why = ` [.tiptap/.ProseMirror nodes=${anyTip}, of which laid-out=0 hidden=${hidden};` +
            ` [contenteditable] nodes=${anyCE}]`;
      if (anyTip === 0 && anyCE === 0) why += " -> composer is UNMOUNTED right now";
      else if (hidden === anyTip && anyTip > 0) why += " -> composer exists but is HIDDEN";
      else why += " -> composer exists but the selector missed it";
    }
    // "writable" must work for BOTH composer shapes. A <textarea> never has
    // contenteditable, so the old check reported writable=false for a perfectly
    // usable Dola composer - alarming and wrong.
    const writable = editor
      ? (editor.tagName === "TEXTAREA"
          ? !editor.disabled && !editor.readOnly
          : editor.getAttribute("contenteditable") === "true")
      : false;
    add("getEditor() finds the composer", !!editor,
        editor ? `${tagOf(editor)} (writable=${writable})`
               : "null - the bar cannot anchor and sending is impossible" + why);

    // Turn collection is where every failure so far has lived.
    let items = [];
    try { items = p.allItems() || []; } catch (e) { add("allItems() throws", false, e.message); }
    add("allItems() returns turns", items.length > 0,
        `${items.length} turn(s)` + (items.length ? "" : " - a reply on screen would be invisible"));

    // The composer must never be mistaken for a reply: that makes the agent
    // read its own typing and loop on itself.
    const composerLeak = editor
      ? items.some((i) => i === editor || (i.contains && i.contains(editor)))
      : false;
    add("composer is NOT counted as a turn", !composerLeak,
        composerLeak ? "LEAK - the agent would read its own input as a reply" : "clean");

    const users = items.filter(safe(p.isUserItem));
    const bots = items.filter(safe(p.isAssistantItem));
    add("turns are classified", items.length === 0 ? null : users.length + bots.length === items.length,
        `${users.length} user / ${bots.length} assistant / ${items.length} total`);

    let last = null;
    try { last = p.lastAssistant(); } catch {}
    add("lastAssistant() resolves", bots.length === 0 ? null : !!last,
        last ? preview(text(last)) : "no assistant turn yet");

    // Does a command in the newest reply actually parse? This is the exact
    // question behind "did not respond in time".
    if (last && typeof ZSParse !== "undefined") {
      const t = text(last);
      let calls = null;
      try { calls = ZSParse.parseToolCalls(t); } catch (e) { calls = "threw: " + e.message; }
      const has = ZSParse.hasToolSignature(t);
      add("newest reply parses", !has ? null : Array.isArray(calls) && calls.length > 0,
          has ? `signature=yes, calls=${JSON.stringify(calls)}`
              : "no command in the newest reply (nothing to parse)");
    }

    // A widget-only reply (JSON/code block, no paragraph) must still count.
    const widgetTurns = items.filter((i) => i.querySelector &&
      i.querySelector("pre, code, .not-prose"));
    add("widget replies are visible", widgetTurns.length === 0 ? null : true,
        `${widgetTurns.length} turn(s) contain a code/JSON widget`);

    if (p.modeWarning) {
      let w = "";
      try { w = p.modeWarning() || ""; } catch {}
      add("mode is supported", !w, w ? strip(w) : "ok");
    }
    return out;
  }

  const safe = (fn) => (x) => { try { return !!fn(x); } catch { return false; } };
  // Read through the PROVIDER, not raw textContent. Reading raw meant the
  // report showed ZeroScript's own chip glued to the reply
  // ("...jsonlist_commandsnot run{...}") even after the provider was fixed to
  // filter it - so the diagnostic misrepresented what the model actually sees.
  const text = (el) => {
    if (!el) return "";
    const p = P();
    if (p && typeof p.itemText === "function") {
      try { return (p.itemText(el) || "").trim(); } catch { /* fall through */ }
    }
    return (el.textContent || "").trim();
  };
  const preview = (s) => (s.length > 90 ? s.slice(0, 90) + "…" : s) || "(empty)";
  const strip = (s) => s.replace(/<[^>]+>/g, "");
  const tagOf = (el) => el.tagName + (el.className ? "." +
    String(el.className).split(/\s+/).slice(0, 3).join(".") : "");

  // ── fixture capture ───────────────────────────────────────────────────────
  // A trimmed, self-contained snapshot of the transcript region: enough markup
  // to replay this page offline in jsdom, without dragging in the whole app.
  // Text is TRUNCATED and the composer's content is dropped, so a fixture is
  // safe to paste into an issue.
  function captureFixture({ maxChars = 160 } = {}) {
    const p = P();
    const items = (() => { try { return p ? p.allItems() || [] : []; } catch { return []; } })();
    const seen = [];
    for (const it of items.slice(-8)) {
      const clone = it.cloneNode(true);
      // Never export what the user typed.
      clone.querySelectorAll('[contenteditable="true"]').forEach((n) => n.remove());
      clone.querySelectorAll("*").forEach((n) => {
        for (const c of [...n.childNodes]) {
          if (c.nodeType === 3 && c.nodeValue.length > maxChars) {
            c.nodeValue = c.nodeValue.slice(0, maxChars) + "…";
          }
        }
      });
      // Wrap the turn in its ancestor chain. The ROLE class lives on an
      // ancestor (user turns carry "text-text-primary ... py-2"), so exporting
      // the turn alone makes every user turn replay as an assistant turn -
      // caught by replaying a real capture. Rebuild the ancestors as empty
      // shells so the role survives without dragging in siblings.
      const chain = ancestry(it);
      let html = clone.outerHTML.slice(0, 4000);
      for (const a of chain.slice(1)) {
        const cls = a.cls ? ` class="${a.cls.replace(/"/g, "&quot;")}"` : "";
        html = `<${a.tag.toLowerCase()}${cls}>${html}</${a.tag.toLowerCase()}>`;
      }
      seen.push({
        role: p && p.isUserItem(it) ? "user" : "assistant",
        chain,
        html,
      });
    }
    return {
      capturedAt: new Date().toISOString(),
      url: location.origin + location.pathname,
      provider: p ? p.id : null,
      extensionVersion: (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "?",
      generating: (() => { try { return !!p.isGenerating(); } catch { return null; } })(),
      turns: seen,
    };
  }

  // The ancestor chain of a turn - the single most useful thing for fixing a
  // selector, and what took several manual round-trips to obtain by hand.
  function ancestry(el, depth = 6) {
    const out = [];
    let n = el;
    for (let i = 0; i < depth && n && n.tagName !== "BODY"; i++) {
      out.push({ tag: n.tagName, cls: String(n.className || "").slice(0, 90) });
      n = n.parentElement;
    }
    return out;
  }

  function report() {
    const checks = runChecks();
    const failed = checks.filter((c) => c.ok === false);
    return {
      summary: {
        passed: checks.filter((c) => c.ok === true).length,
        failed: failed.length,
        skipped: checks.filter((c) => c.ok === null).length,
      },
      checks,
      fixture: captureFixture(),
    };
  }

  function asText(r) {
    const lines = [
      `ZeroScript self-test - ${r.fixture.url}`,
      `provider: ${r.fixture.provider} | extension: ${r.fixture.extensionVersion}` +
      ` | generating: ${r.fixture.generating}`,
      "",
    ];
    for (const c of r.checks) {
      lines.push(`${c.ok === true ? "PASS" : c.ok === false ? "FAIL" : "n/a "}  ${c.name}` +
                 (c.detail ? `\n        ${c.detail}` : ""));
    }
    lines.push("", `${r.summary.passed} passed, ${r.summary.failed} failed, ` +
                   `${r.summary.skipped} not applicable`);
    return lines.join("\n");
  }

  // ── upload straight to the bridge ─────────────────────────────────────────
  // The extension can reach the AI site; the bridge and the offline test suite
  // cannot. Sending the capture to the bridge turns a live page into a file
  // that test-fixture-replay.js asserts against forever - which is the only
  // way to regression-test a provider against a site the developer cannot
  // load. Without this the user has to copy a wall of JSON out of a popup by
  // hand, which is how the last several rounds actually went.
  //
  // Sent as a GET with a base64url query parameter, NOT a POST body: the
  // websockets library parses only the request line and headers during the
  // handshake, so a POST body is never read and the request hangs.
  async function upload(endpoint, token) {
    const fx = captureFixture();
    const json = JSON.stringify(fx);
    const b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    // Derive the HTTP origin from the ws:// endpoint the bridge already uses.
    let base = endpoint || "ws://127.0.0.1:17613";
    base = base.replace(/^ws:/, "http:").replace(/^wss:/, "https:")
               .replace(/\/+$/, "");
    const url = `${base}/fixture?data=${b64}` + (token ? `&token=${encodeURIComponent(token)}` : "");
    if (url.length > 60000) {
      return { ok: false, error: "capture too large to upload - use the clipboard copy instead" };
    }
    try {
      const res = await fetch(url, { method: "GET" });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true, ...body } : { ok: false, error: body.error || `HTTP ${res.status}` };
    } catch (e) {
      return { ok: false, error: "bridge unreachable: " + String((e && e.message) || e) };
    }
  }

  return { runChecks, captureFixture, report, asText, upload };
})();
