// SPDX-License-Identifier: GPL-3.0-or-later
// discover.js - DOM discovery for a NEW provider.
//
//   Paste this whole file into the browser console on the AI chat site,
//   with a conversation of at least TWO exchanges on screen.
//
// WHY
// Every provider is DOM reverse-engineering, and the sites cannot be reached
// from a development sandbox. Adding Arena Agent took several rounds of
// hand-written console snippets to answer, one at a time: where is the
// composer, where are the turns, how is a user turn distinguished from an
// assistant one. This asks all of it at once.
//
// It runs WITHOUT the extension installed, so it works on a site ZeroScript
// does not support yet - which is the whole point.
//
// PRIVACY: message text is truncated to 60 characters and only the last 6
// turns are inspected. Class names and structure are the useful part, not
// content. Review the output before sharing it.
(() => {
  "use strict";
  const cls = (e) => (typeof e.className === "string" ? e.className : "").slice(0, 90);
  const txt = (e) => (e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 60);
  const vis = (e) => !!(e.getClientRects && e.getClientRects().length);

  // ── 1. the composer ───────────────────────────────────────────────────────
  // Providers must type into this. Both shapes exist in the wild: a plain
  // <textarea> (Arena Direct) and a contenteditable (Arena Agent, TipTap).
  const editors = [
    ...document.querySelectorAll('[contenteditable="true"], [contenteditable=""], textarea'),
  ].filter(vis).map((e) => ({
    tag: e.tagName, cls: cls(e),
    kind: e.tagName === "TEXTAREA" ? "textarea" : "contenteditable",
    inForm: !!e.closest("form"),
    parent: e.parentElement ? cls(e.parentElement) : null,
  }));

  // ── 2. the turn list ──────────────────────────────────────────────────────
  // Some sites use a real list; Arena Agent has none, which was the single
  // most important thing to learn about it.
  const lists = [...document.querySelectorAll('ol, ul, [role="log"], [role="feed"], [role="list"]')]
    .filter(vis).filter((e) => e.children.length >= 2)
    .map((e) => ({ tag: e.tagName, cls: cls(e), children: e.children.length }));

  // ── 3. candidate turn bodies ──────────────────────────────────────────────
  // Look for repeated containers holding real text. The winning selector is
  // usually the class that appears once per message.
  const counts = new Map();
  for (const e of document.querySelectorAll("div, article, section, li")) {
    const c = cls(e);
    if (!c || !vis(e)) continue;
    const t = (e.textContent || "").trim();
    if (t.length < 15 || t.length > 4000) continue;
    if (e.querySelector('[contenteditable="true"], textarea')) continue; // composer
    // Skip NAVIGATION, not conversation. A sidebar history list looks a lot
    // like a transcript to a naive scan: repeated containers holding text. But
    // its entries are LINKS. A first capture returned two chat TITLES
    // ("Clarification Request", "Accidental Send") wrapped in <a> as if they
    // were messages, which would have produced a provider that reads the
    // sidebar instead of the chat.
    if (e.closest("a, nav, aside, header, footer")) continue;
    if (e.closest('[role="navigation"], [role="banner"], [role="complementary"]')) continue;
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([c, n]) => ({ cls: c, occurrences: n }));

  // ── 4. the last few turns, with ancestry ──────────────────────────────────
  // The ROLE marker (user vs assistant) is usually on an ancestor, not the
  // body itself - that was true on Arena Agent and is the detail that takes
  // longest to find by hand.
  const best = repeated[0] && repeated[0].cls;
  let turns = [];
  if (best) {
    const nodes = [...document.querySelectorAll("div, article, section, li")]
      .filter((e) => cls(e) === best && vis(e)).slice(-6);
    turns = nodes.map((e) => {
      const chain = [];
      let n = e;
      for (let i = 0; i < 5 && n && n.tagName !== "BODY"; i++) {
        chain.push({ tag: n.tagName, cls: cls(n) });
        n = n.parentElement;
      }
      return { text: txt(e), hasCodeBlock: !!e.querySelector("pre, code"), chain };
    });
  }

  // ── 5. send / stop controls ───────────────────────────────────────────────
  const buttons = [...document.querySelectorAll("button")].filter(vis).map((b) => ({
    aria: b.getAttribute("aria-label") || "",
    text: txt(b).slice(0, 24),
    disabled: !!b.disabled || b.getAttribute("aria-disabled") === "true",
  })).filter((b) => b.aria || b.text).slice(0, 20);

  const report = {
    site: location.origin + location.pathname,
    capturedAt: new Date().toISOString(),
    composer: editors,
    turnLists: lists,
    repeatedContainers: repeated,
    sampleTurns: turns,
    buttons,
    hints: {
      // A visible sign-in control means the transcript almost certainly is not
      // rendered, so an empty capture says nothing about the site's real DOM.
      looksSignedOut: [...document.querySelectorAll("button, a")].some((b) =>
        /^(log ?in|sign ?in|登录|登陸)$/i.test((b.textContent || "").trim())),
      noMessagesFound: turns.length === 0,
      noTurnList: lists.length === 0,
      composerIsContentEditable: editors.some((e) => e.kind === "contenteditable"),
      // A composer that shares a class with turn bodies is the collision that
      // made ZeroScript read its own input as a reply on Arena Agent.
      composerSharesTurnClass: !!best && editors.some((e) => e.cls && best &&
        e.cls.split(/\s+/).some((c) => best.split(/\s+/).includes(c))),
    },
  };

  if (report.hints.looksSignedOut || report.hints.noMessagesFound) {
    console.warn(
      "%cZeroScript discover: this capture is NOT usable yet.",
      "font-weight:bold");
    if (report.hints.looksSignedOut) console.warn("  - a Log In / Sign In control is visible, so you are signed out");
    if (report.hints.noMessagesFound) console.warn("  - no message containers were found");
    console.warn("  Log in, send TWO messages, wait for the replies, then run this again.");
  }

  const out = JSON.stringify(report, null, 2);
  try { copy(out); console.log("Copied to clipboard."); } catch { /* copy() is devtools-only */ }
  console.log(out);
  return report;
})();
