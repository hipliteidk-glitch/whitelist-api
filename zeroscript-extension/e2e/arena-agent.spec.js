// SPDX-License-Identifier: GPL-3.0-or-later
// e2e/arena-agent.spec.js - live browser check of the Arena Agent provider.
//
//   npm install --no-save @playwright/test && npx playwright install chromium
//   npx playwright test e2e/arena-agent.spec.js
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS SHAPED THE WAY IT IS
//
// The obvious version of this test does not work, for four reasons:
//
//  1. THE DEFAULT `page` FIXTURE HAS NO EXTENSION. Playwright's normal browser
//     has no extensions loaded, so asserting on ZeroScript's overlay there can
//     only ever fail. An MV3 extension needs a PERSISTENT context launched with
//     --disable-extensions-except / --load-extension, which is what the
//     `withExtension` fixture below does.
//
//  2. THE SELECTORS MUST MATCH THE REAL CODE. ZeroScript injects `#zs-root`
//     containing `#zs-bar`. There is no #zeroscript-overlay, no .zs-overlay and
//     no [data-zs-extension] anywhere in the source - a test using those passes
//     only because it asserts nothing.
//
//  3. arena.ai REQUIRES A LOGIN. An anonymous run lands on a sign-in page, so
//     copy like "New Chat" / "Add files" is absent and the assertions fail for
//     a reason that has nothing to do with ZeroScript. These tests therefore
//     detect the signed-out state and SKIP with a clear message rather than
//     reporting a false failure. Sign in once with
//     `npx playwright open --save-storage=e2e/.auth.json https://arena.ai`
//     and the tests will reuse that session.
//
//  4. TEXT ASSERTIONS ON A THIRD-PARTY UI ARE BRITTLE. Marketing copy changes
//     without notice, and `text=Add files` also matches an aria-label on an
//     unrelated control. Where a stable handle exists (aria-label, role) it is
//     used instead; the loose text checks are advisory, not hard failures.
// ─────────────────────────────────────────────────────────────────────────────
const path = require("path");
const { test: base, chromium, expect } = require("@playwright/test");

const EXT_DIR = path.resolve(__dirname, "..");
const AUTH = path.join(__dirname, ".auth.json");

const test = base.extend({
  // A persistent context with the unpacked extension loaded. MV3 service
  // workers only run in a persistent profile, so this cannot be a plain launch.
  withExtension: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false, // extensions do not load in old headless
      args: [
        `--disable-extensions-except=${EXT_DIR}`,
        `--load-extension=${EXT_DIR}`,
      ],
      ...(require("fs").existsSync(AUTH) ? { storageState: AUTH } : {}),
    });
    await use(ctx);
    await ctx.close();
  },
});

// arena.ai shows a sign-in wall to anonymous visitors; every content assertion
// below is meaningless until past it.
async function signedIn(page) {
  const composer = page.locator('[contenteditable="true"]');
  try {
    await composer.first().waitFor({ state: "visible", timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

test("Arena Agent page exposes the DOM the provider depends on", async ({ withExtension }) => {
  const page = await withExtension.newPage();
  await page.goto("https://arena.ai/agent", { waitUntil: "domcontentloaded" });

  if (!(await signedIn(page))) {
    test.skip(true, "Not signed in to arena.ai - run: npx playwright open " +
                    "--save-storage=e2e/.auth.json https://arena.ai");
  }

  // The composer the provider drives: a TipTap/ProseMirror contenteditable.
  const editor = page.locator('[contenteditable="true"].tiptap, [contenteditable="true"].ProseMirror');
  await expect(editor.first()).toBeVisible();

  // A stable handle, unlike the visible label text.
  await expect(page.locator('button[aria-label="Send message"]')).toHaveCount(1);

  // The provider asserts /agent has NO message list; if that ever changes,
  // allItems() should be revisited, so pin it.
  const lists = await page.locator('ol, ul, [role="log"], [role="feed"]').count();
  expect(lists, "provider assumes /agent has no message list").toBe(0);
});

test("the extension injects its bar on /agent", async ({ withExtension }) => {
  const page = await withExtension.newPage();
  await page.goto("https://arena.ai/agent", { waitUntil: "domcontentloaded" });

  if (!(await signedIn(page))) {
    test.skip(true, "Not signed in to arena.ai");
  }

  // The REAL ids ZeroScript creates (core/main.js): #zs-root wrapping #zs-bar.
  await expect(page.locator("#zs-root")).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator("#zs-bar")).toBeVisible();

  // And it must NOT claim an unsupported mode on the route it now supports.
  const barText = (await page.locator("#zs-bar").innerText()).toLowerCase();
  expect(barText).not.toContain("only works in direct mode");
});

test("a widget-only reply is detected as a turn", async ({ withExtension }) => {
  // This is the regression that broke live: the model answered with a JSON
  // widget and the provider saw no turn, so the loop timed out.
  const page = await withExtension.newPage();
  await page.goto("https://arena.ai/agent", { waitUntil: "domcontentloaded" });

  if (!(await signedIn(page))) {
    test.skip(true, "Not signed in to arena.ai");
  }

  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.type('Reply with exactly this and nothing else, in a JSON code block: {"command":"list_commands"}');
  await page.locator('button[aria-label="Send message"]').click();

  // Wait for a code widget to render, then read the turn the provider would.
  await page.locator("pre code, .not-prose code").first()
    .waitFor({ state: "visible", timeout: 120000 });

  const seen = await page.evaluate(() => {
    const inners = [...document.querySelectorAll("div.flex.flex-col.gap-2")]
      .filter((el) => !el.querySelector('[contenteditable="true"]'))
      .filter((el) => (el.textContent || "").trim() ||
                      el.querySelector("pre, code, .not-prose"));
    const last = inners[inners.length - 1];
    return { turns: inners.length, text: last ? last.textContent.trim().slice(0, 200) : "" };
  });

  expect(seen.turns, "provider must see at least the user turn and the reply")
    .toBeGreaterThanOrEqual(2);
  expect(seen.text).toContain("list_commands");
});
