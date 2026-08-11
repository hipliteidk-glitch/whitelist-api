# Tests

```bash
node test-parser.js            # upstream command parser
node test-target.js            # target profiles (no Roblox regression)
node test-deepseek-model.js    # DeepSeek model choice + vision gating
node test-arena-mode.js        # Arena chat-mode gate
node test-arena-agent.js       # Arena Agent Mode logic

npm install --no-save jsdom
node test-arena-agent-dom.js   # the REAL provider against a REAL DOM
```

## Why `test-arena-agent-dom.js` exists

The other suites re-implement a provider's logic inline and assert on the copy.
That catches design mistakes, but **not** the failure that actually happened
live: the shipped file querying a selector that matches nothing. A test that
re-implements the code can pass while the code is broken.

`test-arena-agent-dom.js` loads `providers/arena-agent.js` **verbatim** into a
jsdom document built from markup captured on arena.ai/agent — including the
ancestor chain of the JSON widget whose reply went undetected — then calls the
real `allItems()` / `lastAssistant()` / `readAssistant()` and feeds the result
to the real `core/parser.js`.

It is skipped with a notice if jsdom is absent, so the other suites still run.

## Mutation-checked

The test is only worth anything if it fails when the code breaks. Verified by
reintroducing each real bug and confirming it is caught:

| Reintroduced bug | Result |
| --- | --- |
| turns keyed on the outer wrapper (`div.px-3`) | 6 failures |
| composer guard removed | 7 failures |
| widget check removed (`text only`) | 4 failures |

The third initially **survived**, because the fixture's widget contained text,
so `txt.length > 0` short-circuited the widget check. A reply whose widget has
no text of its own was added to the fixture; it now fails as it should.

## Live browser test (Playwright)

`e2e/arena-agent.spec.js` drives a real Chromium with the extension loaded.
It cannot run in this sandbox (arena.ai is unreachable, HTTP 000), so it is
for **your** machine:

```bash
npm install --no-save @playwright/test && npx playwright install chromium
npx playwright open --save-storage=e2e/.auth.json https://arena.ai   # sign in once
npx playwright test e2e/arena-agent.spec.js
```

Four things the obvious version of this test gets wrong, and how this one
handles them:

| Pitfall | Handling |
| --- | --- |
| Playwright's default `page` has **no extension** loaded, so any overlay assertion fails by construction | uses `launchPersistentContext` with `--load-extension` (MV3 needs a persistent profile) |
| `#zeroscript-overlay` / `.zs-overlay` / `[data-zs-extension]` **do not exist** in the source | asserts the real ids: `#zs-root`, `#zs-bar` |
| arena.ai requires a **login**; anonymous runs hit a sign-in wall and fail for unrelated reasons | detects the signed-out state and **skips** with instructions |
| Text assertions on third-party marketing copy are brittle | prefers `aria-label` / role handles; text checks kept advisory |

The third test reproduces the actual live regression: it asks the model for a
JSON code block and asserts the provider's turn query sees it — the failure
that produced "Arena Agent did not respond in time".

## Self-test: making the extension testable from anywhere

The providers are DOM reverse-engineering against sites a developer often
cannot reach. Every provider bug this session followed the same slow loop: hit
a failure, paste a screenshot, guess a fix, repeat. Unit tests that
re-implement a provider's logic cannot catch a selector that matches nothing on
the real page.

The extension can now report that itself.

**Capture (on the machine with the site open)**

1. Open the AI chat where it misbehaves.
2. Click the ZeroScript icon → **🧪 Run self-test & copy report**.
3. A readable PASS/FAIL report appears; the full report *plus a replayable DOM
   fixture* is copied to the clipboard.

The report answers the questions that actually matter: is the provider loaded,
is the composer found, how many turns does `allItems()` see, is the composer
being misread as a reply, does the newest reply parse into a command.

**Replay (offline, forever)**

Save the `FIXTURE` section as `fixtures/<name>.json`, then:

```bash
node test-fixture-replay.js                       # all fixtures
node test-fixture-replay.js fixtures/mine.json    # one
```

This rebuilds the captured markup in jsdom, loads the **real** provider file
into it, and asserts it still finds the turns and parses the command.

**Privacy:** the fixture keeps only the last 8 turns, truncates text to ~160
characters, and strips the composer's contents, so it is safe to paste into an
issue. Nothing is transmitted anywhere - it goes to your clipboard.

**Mutation-checked:** reintroducing the real turn-anchoring bug
(`div.px-3` instead of `div.flex.flex-col.gap-2`) makes the replayed fixture
fail 3 assertions, including "a command in the captured reply is parsed" - the
exact symptom behind *"Arena Agent did not respond in time"*.

## Self-update

`updater.py` fast-forwards a git-cloned install and reports what changed.

```bash
python3 updater.py          # check only (never modifies anything)
python3 updater.py apply    # fast-forward
python3 test_updater.py     # 20 assertions against real git repos
```

From the extension: **⬆ Check for updates** in the popup. It checks, applies,
then reloads the extension. The bridge still needs a manual restart — a process
cannot safely replace itself mid-tool-call.

It **never updates on its own**. The bridge reports available updates once at
startup and stops there: this drives your files and your Roblox place, so a
surprise change mid-session is not acceptable.

Refusals, which matter more than the happy path:

| Situation | Behaviour |
| --- | --- |
| Uncommitted changes | refuses, names the files, changes nothing |
| Local commits ahead of origin | refuses (no fast-forward possible) |
| Not a git clone | reports it and carries on running |
| No network / git missing | reports it and carries on running |

## HTTP API — testing the bridge without a browser

The WebSocket API can only be driven by the extension, so the bridge could not
be exercised from a terminal, from CI, or from any machine without Chrome. That
is precisely what turned every provider bug into a guess-and-check loop. The
same calls are now available over plain HTTP.

```bash
curl localhost:17613/healthz        # liveness (open, no token - a PaaS polls it)
curl localhost:17613/status         # target, servers, tool counts
curl localhost:17613/tools          # full tool list with schemas
curl -G --data-urlencode 'name=read_file' \
     --data-urlencode 'args={"path":"note.txt"}' \
     localhost:17613/call           # run a tool
open  http://localhost:17613/       # human-readable status page
```

With `ZS_BRIDGE_TOKEN` set, everything except `/healthz` needs
`?token=...` or `Authorization: Bearer ...`.

### Why `/call` uses a query string, not a POST body

`websockets`' `process_request` hook is **never invoked** for a request that
carries a body — the library cannot parse one, and curl simply sees the
connection close (exit 52). Verified directly against websockets 17. A query
string reaches the handler reliably, so that is the interface.

```bash
python3 test_http_api.py    # 26 assertions against a real running bridge
```

## Capturing a live page over HTTP

The browser can reach the AI site; the bridge and this test suite cannot. The
bridge therefore accepts captures over plain HTTP on the same port as the
WebSocket, and writes them into `fixtures/` where the replay harness picks
them up.

```
GET  /fixtures                  list what has been captured
GET  /fixture?data=<base64url>  store one (the self-test's fixture JSON)
```

**Why a query parameter and not a POST body:** the bridge's HTTP layer is the
websockets handshake hook, and `websockets.http11.Request` has no body field at
all — its fields are `path`, `headers`, `method`, `protocol`. A POST body is
never read, and the request simply hangs (verified). A query parameter is the
only payload that hook can see.

**The whole loop, with nothing typed by hand:**

1. Click **🧪 Run self-test** in the popup on the failing page.
2. The capture is sent to the bridge and saved, e.g.
   `arena-agent-generating-019fd143.json`. Re-capturing the same page
   overwrites it rather than piling up duplicates.
3. `node test-fixture-replay.js` now asserts against that exact page, forever.

Verified end to end: a live-shaped capture went in over HTTP and came back as
5 passing assertions, including the JSON command parsing out of a code widget.

`python3 test_http_fixture.py` — 14 assertions covering the happy path plus
missing data, bad base64, a non-fixture object and a JSON array, confirming
each is rejected with a clear error and that the bridge stays alive.

## Testing Arena over real HTTP

`mock-arena.js` serves replicas of arena.ai/agent — built from real captures —
over a local HTTP server, so the provider can be driven end-to-end offline.

```bash
npm install --no-save jsdom
node test-arena-http.js        # fetch each scenario, run the real provider
node mock-arena.js             # or browse it: http://127.0.0.1:8731/agent
```

Scenarios (`?state=`), each a state that has actually caused a bug:

| state | what it reproduces |
| --- | --- |
| `chat` | an ordinary conversation |
| `widget` | a JSON code-widget reply **while generating**, composer disabled |
| `thinking` | a reply turn inserted before the first token arrives |
| `consecutive` | two user turns in a row (real transcripts don't alternate) |
| `empty` | a fresh chat |

**What it does and doesn't prove.** It exercises every selector and DOM branch
in the provider — where all seven live bugs were — by fetching real HTTP and
running `providers/arena-agent.js` verbatim. It is *not* a browser: no CSS, no
React, no genuine streaming. Timing behaviour still needs the real site.

It earned its place immediately: the `thinking` scenario exposed a bug no
amount of reading had found — Arena inserts the assistant's turn *before* the
first token, and the provider required content, so the opening moments of every
reply were invisible. Fixing that naively then counted the composer as a third
turn, which the same suite caught.

## Capturing a live page over HTTP

The bridge serves plain HTTP on the same port as its WebSocket, so the browser
can hand a live page straight to it. This is what makes a provider testable
against a site the developer cannot reach.

```
GET /healthz          liveness (no auth)
GET /status           target, servers, tools
GET /fixtures         what has been captured
GET /fixture?data=..  store a capture (base64url JSON)
```

Flow:

1. On the page that misbehaves, click **🧪 Run self-test** in the popup.
2. The extension POSTs the capture to the bridge, which writes it into
   `zeroscript-extension/fixtures/`.
3. `node test-fixture-replay.js` replays it against the **real** provider,
   forever.

Verified end to end: a capture uploaded over HTTP appeared in `/fixtures` and
then replayed green, including the JSON-widget reply that originally failed.

Bodies are not used deliberately: the bridge's HTTP layer is the websockets
handshake hook, which parses only the request line and headers — a POST body is
never read and the request would hang. Hence `?data=<base64url>`.

Remote bridges require the token (`&token=…`); `/healthz` never does, so a PaaS
can poll it.

## Switching a ZIP install to a git install

Self-update needs a git clone. To convert without losing anything:

```bash
cd ~ && mv zs-app zs-app.old
git clone -b arena/019f97f5-potential-waddle \
  https://github.com/hipliteidk-glitch/potential-waddle zs-app
cd zs-app/vendor/ZeroScript-Free
cp config.termux.json config.json
python3 merge-config.py ~/zs-app.old/vendor/ZeroScript-Free/config.json   # optional
bash start-termux.sh -b
```

The old install stays at `~/zs-app.old`. `merge-config.py` copies across any
tools you added by hand — matched by name, so shipped tools are never
overwritten and running it twice changes nothing. It backs up `config.json`
first.

## Adding support for a new AI site

Providers are DOM reverse-engineering, and these sites are unreachable from a
dev sandbox. `discover.js` collects everything a provider needs in one pass,
instead of the several rounds of hand-written console snippets that adding
Arena Agent required.

1. Open the site with a conversation of **at least two exchanges** on screen.
2. Open DevTools → Console, paste the whole of `discover.js`, press Enter.
3. The report is copied to your clipboard. **Review it, then share it.**

It reports the composer (textarea vs contenteditable), whether a turn list
exists at all, the repeated container that holds messages, the last few turns
*with their ancestor chains* (the role marker is usually on an ancestor), and
the send/stop buttons.

It also flags the trap that broke Arena Agent: `composerSharesTurnClass` — a
composer sharing a class with turn bodies makes the extension read the user's
own typing as a reply and loop on itself.

Privacy: text is truncated to 60 characters, only the last 6 turns are
inspected, and nothing is transmitted — it goes to your clipboard.
