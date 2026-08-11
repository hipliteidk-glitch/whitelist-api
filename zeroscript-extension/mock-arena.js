// SPDX-License-Identifier: GPL-3.0-or-later
// mock-arena.js - a local HTTP replica of arena.ai/agent.
//
// WHY
// arena.ai is unreachable from a dev sandbox, so every provider bug this
// session was diagnosed by asking the user to paste a capture. This serves the
// SAME page shapes over real HTTP, from real captures, so the provider can be
// driven end-to-end offline - including the states that are hardest to catch
// by hand: mid-generation, a disabled composer, and a widget-only reply.
//
//   node mock-arena.js            # serve on :8731
//   node mock-arena.js --port N
//
// Then browse http://127.0.0.1:8731/agent, or point the tests at it.
//
// The markup is copied from real self-test fixtures, NOT invented - that is
// the whole point. When Arena changes, capture a new fixture and the mock
// follows.
const http = require("http");

const PROSE =
  "prose prose-pre:bg-transparent prose-pre:p-0 text-wrap break-words prose-base body-base";

// ── page pieces, verbatim shapes from captures ─────────────────────────────
const userTurn = (text) => `
<div class="flex w-full shrink-0 flex-col gap-4 mx-auto max-w-3xl px-4 pt-14 md:pt-12">
 <div class="scroll-mt-[72px] md:scroll-mt-16">
  <div class="group flex min-w-0 flex-col items-end gap-1">
   <div class="relative overflow-hidden bg-surface-raised rounded-lg w-fit max-w-[min(70%,768px)]">
    <div class="px-3 text-text-primary body-base py-2">
     <div class="flex flex-col gap-2"><div class="${PROSE}"><p>${text}</p></div></div>
    </div>
   </div>
  </div>
 </div>
</div>`;

// A plain prose reply.
const textReply = (text) => `
<div class="flex w-full shrink-0 flex-col gap-4 mx-auto max-w-3xl px-4 pt-14 md:pt-12">
 <div><div class="relative overflow-hidden bg-surface-primary rounded-xl border w-full">
  <div class="px-3 pb-3">
   <div class="flex flex-col gap-2"><div class="${PROSE}"><p>${text}</p></div></div>
  </div>
 </div></div>
</div>`;

// The shape that broke the provider: a "Thought for N seconds" block plus a
// JSON code widget, with NO paragraph of its own.
const widgetReply = (json) => `
<div class="flex w-full shrink-0 flex-col gap-4 mx-auto max-w-3xl px-4 pt-14 md:pt-12">
 <div><div class="relative overflow-hidden bg-surface-primary rounded-xl border w-full">
  <div class="px-3 pb-3">
   <div class="flex flex-col gap-2">
    <div data-state="closed" class="not-prose">
     <button type="button"><p class="leading-[normal]">Thought for 2 seconds</p></button>
    </div>
    <div class="${PROSE}">
     <pre><div class="not-prose my-0 flex w-full flex-col overflow-clip border" data-code-block="true">
      <div class="border-border flex items-center justify-between border-b px-4 py-2">
       <span class="text-text-secondary text-sm font-medium">JSON</span>
      </div>
      <div class="code-block_container__lbMX4">
       <pre class="shiki github-dark shiki-code-block"><code
         class="whitespace-pre-wrap break-words">${json}</code></pre>
      </div>
     </div></pre>
    </div>
   </div>
  </div>
 </div></div>
</div>`;

// The composer. Arena DISABLES it while the agent generates - the bug that
// made getEditor() return null for a whole generation.
const composer = (writable) => `
<div class="relative px-4 pb-4">
 <div class="flex flex-col gap-2">
  <div contenteditable="${writable ? "true" : "false"}"
       class="tiptap ProseMirror prose max-w-none focus:outline-none bg-surface-secondary
              max-h-[40vh] min-h-[32px] overflow-y-auto p-1 md:min-h-[80px] md:p-3"></div>
 </div>
</div>
<button aria-label="Send message"${writable ? "" : " disabled"}></button>
${writable ? "" : '<button aria-label="Stop generation"></button>'}`;

// ── scenarios ──────────────────────────────────────────────────────────────
// Each is a state the provider must handle. `?state=` selects one.
const SCENARIOS = {
  empty: { generating: false, turns: [] },
  chat: {
    generating: false,
    turns: [userTurn("Write essay"), textReply("The essay is 576 words long.")],
  },
  // The live failure: a JSON command inside a widget, while still generating.
  widget: {
    generating: true,
    turns: [userTurn("list your commands"),
            widgetReply('{"command":"list_commands"}')],
  },
  // Generating with nothing written yet - the empty-turn case that a single
  // short idle window wrongly treated as "finished".
  thinking: {
    generating: true,
    turns: [userTurn("hello"), textReply("")],
  },
  // Consecutive user turns: real transcripts do NOT strictly alternate.
  consecutive: {
    generating: false,
    turns: [userTurn("one"), userTurn("two"), textReply("answering both")],
  },
};

function page(name) {
  const s = SCENARIOS[name] || SCENARIOS.chat;
  return `<!doctype html><html><head><title>Arena Agent (mock)</title></head><body>
<div class="relative flex h-full flex-col">
 <div class="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
  <div class="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pt-4">
   ${s.turns.join("\n")}
  </div>
  ${composer(!s.generating)}
 </div>
</div>
<script>window.__mockState = ${JSON.stringify(name)};</script>
</body></html>`;
}

function start(port = 8731) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/scenarios") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(Object.keys(SCENARIOS)));
      return;
    }
    // Everything under /agent serves the app, like the real SPA.
    const state = url.searchParams.get("state") || "chat";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(page(state));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => {
    // With port 0 the OS assigns a free one, so read it back rather than
    // echoing the 0 we asked for.
    const actual = server.address().port;
    resolve({ server, port: actual, url: `http://127.0.0.1:${actual}` });
  }));
}

module.exports = { start, SCENARIOS, page };

if (require.main === module) {
  const i = process.argv.indexOf("--port");
  const port = i > -1 ? Number(process.argv[i + 1]) : 8731;
  start(port).then(({ url }) => {
    console.log(`mock Arena on ${url}/agent`);
    console.log("scenarios: " + Object.keys(SCENARIOS).join(", "));
    console.log(`e.g. ${url}/agent?state=widget`);
  });
}
