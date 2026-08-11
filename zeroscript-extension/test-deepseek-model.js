// SPDX-License-Identifier: GPL-3.0-or-later
// test-deepseek-model.js - the DeepSeek startup-model choice.
//
// Expert is the default because the agent loop needs exactly-formatted command
// JSON over many turns. Instant is opt-in. These tests pin both, plus the rules
// that must not regress: Vision is never overridden, and a missing Instant tab
// falls back to Expert instead of selecting nothing.
//
// Run:  node test-deepseek-model.js
const fs = require("fs");
const path = require("path");

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { console.log("PASS ", name); pass++; }
  else { console.log("FAIL ", name, extra === undefined ? "" : "\n      " + extra); fail++; }
}

// ── Minimal DOM good enough for the mode logic ────────────────────────────
function makeRadio(type, label, checked) {
  return {
    _type: type, _label: label,
    _attrs: { "data-model-type": type, "aria-checked": checked ? "true" : "false" },
    textContent: label,
    clicked: 0,
    getAttribute(k) { return this._attrs[k] === undefined ? null : this._attrs[k]; },
    click() { this.clicked++; this._attrs["aria-checked"] = "true"; },
    querySelectorAll() { return []; },
    closest() { return null; },
  };
}

function scenario({ tabs, prefer }) {
  const preferredModel = prefer === true ? "instant" : (prefer || "expert");
  const radios = tabs.map((t) => makeRadio(t.type, t.label, !!t.checked));
  // Selecting one radio unchecks the rest, as a real radiogroup does.
  radios.forEach((r) => {
    const origClick = r.click.bind(r);
    r.click = () => { radios.forEach((o) => (o._attrs["aria-checked"] = "false")); origClick(); };
  });

  const RE = {
    expertMode: /expert|专家|专业/i,
    instantMode: /instant|rapide|快速|标准/i,
    visionMode: /vision|视觉|图像|多模态/i,
  };
  const nodeText = (n) => (n && n.textContent) || "";
  const findModeRadio = (type, re) =>
    radios.find((r) => r.getAttribute("data-model-type") === type) ||
    (re && radios.find((r) => re.test(nodeText(r)))) || null;
  const findExpertRadio = () => findModeRadio("expert", RE.expertMode);
  const findInstantRadio = () => findModeRadio("default", RE.instantMode);
  const findVisionRadio = () => findModeRadio("vision", RE.visionMode);
  const radioOn = (r) => !!r && r.getAttribute("aria-checked") === "true";
  const isVisionSelected = () => radioOn(findVisionRadio());

  // The branch under test, mirroring enforceComposer in providers/deepseek.js.
  let target = null;
  if (preferredModel === "vision") {
    target = findVisionRadio() || findExpertRadio();
  } else if (!isVisionSelected()) {
    const wantInstant = preferredModel === "instant" && !!findInstantRadio();
    target = wantInstant ? findInstantRadio() : findExpertRadio();
  }
  if (target && target.getAttribute("aria-checked") !== "true") target.click();
  const selected = radios.find((r) => radioOn(r));
  const state = {
    expertOn: radioOn(findExpertRadio()),
    instantOn: radioOn(findInstantRadio()),
    visionOn: radioOn(findVisionRadio()),
  };
  const ready = state.expertOn || state.visionOn || (preferredModel === "instant" && state.instantOn);
  return { selected: selected ? selected._type : null, ready, radios };
}

const FULL = [
  { type: "default", label: "Instant" },
  { type: "expert", label: "Expert" },
  { type: "vision", label: "Vision" },
];

// ── default: Expert ───────────────────────────────────────────────────────
let r = scenario({ tabs: FULL, prefer: false });
ok("default picks Expert", r.selected === "expert", r.selected);
ok("default is ready", r.ready);

// ── opt-in: Instant ───────────────────────────────────────────────────────
r = scenario({ tabs: FULL, prefer: true });
ok("preferInstant picks Instant", r.selected === "default", r.selected);
ok("Instant counts as ready when preferred", r.ready);

// ── Instant preferred but Expert already active -> switches ───────────────
r = scenario({ tabs: [
  { type: "default", label: "Instant" },
  { type: "expert", label: "Expert", checked: true },
], prefer: true });
ok("switches away from an already-checked Expert", r.selected === "default", r.selected);

// ── Vision chosen by the user is never overridden ─────────────────────────
r = scenario({ tabs: [
  { type: "default", label: "Instant" },
  { type: "expert", label: "Expert" },
  { type: "vision", label: "Vision", checked: true },
], prefer: false });
ok("Vision is respected over Expert", r.selected === "vision", r.selected);
r = scenario({ tabs: [
  { type: "default", label: "Instant" },
  { type: "expert", label: "Expert" },
  { type: "vision", label: "Vision", checked: true },
], prefer: true });
ok("Vision is respected over Instant too", r.selected === "vision", r.selected);

// ── no Instant tab (older UI) -> fall back to Expert, never nothing ───────
r = scenario({ tabs: [{ type: "expert", label: "Expert" }], prefer: true });
ok("missing Instant tab falls back to Expert", r.selected === "expert", r.selected);
ok("fallback is still ready", r.ready);

// ── label fallback when data-model-type is absent ─────────────────────────
r = scenario({ tabs: [
  { type: "", label: "Instant" },
  { type: "", label: "Expert" },
], prefer: true });
ok("finds Instant by label when the attribute is missing", r.selected === "" && r.radios[0].clicked === 1,
   `clicked: instant=${r.radios[0].clicked} expert=${r.radios[1].clicked}`);

// ── Expert preferred is NOT ready if only Instant is on ───────────────────
const onlyInstantOn = (() => {
  const preferInstant = false;
  const state = { expertOn: false, instantOn: true, visionOn: false };
  return state.expertOn || state.visionOn || (preferInstant && state.instantOn);
})();
ok("Instant alone is NOT ready when Expert is preferred", onlyInstantOn === false);

// ── the real file still parses and contains the wiring ────────────────────
const src = fs.readFileSync(path.join(__dirname, "providers", "deepseek.js"), "utf8");
ok("provider reads the saved preference", src.includes("zsDeepseekModel"));
ok("provider supports a three-way model choice", src.includes('"vision"') && src.includes("preferredModel"));
ok("provider no longer uses the old boolean", !src.includes("preferInstant"));
ok("provider has an Instant finder", src.includes("findInstantRadio"));
ok("provider still defaults to Expert", src.includes("findExpertRadio()"));


// ── Vision as a stored preference ──────────────────────────────────────────
r = scenario({ tabs: FULL, prefer: "vision" });
ok("preferring Vision selects the Vision tab", r.selected === "vision", r.selected);
ok("Vision preference is ready", r.ready);

r = scenario({ tabs: [
  { type: "default", label: "Instant" },
  { type: "expert", label: "Expert", checked: true },
], prefer: "vision" });
ok("missing Vision tab falls back to Expert", r.selected === "expert", r.selected);
ok("Vision fallback is still ready", r.ready);

r = scenario({ tabs: FULL, prefer: "expert" });
ok("expert preference still wins by default", r.selected === "expert", r.selected);

// ── Vision-tool gating ─────────────────────────────────────────────────────
// A tool that only returns an image must be hidden when the selected model
// cannot see images, so the AI never calls it and then misreports the refusal
// as a failure (observed live: it blamed Roblox Studio being closed).
{
  const VISION_TOOLS = new Set(["screen_capture", "screenshot", "take_screenshot"]);
  const isVisionToolName = (bare) =>
    VISION_TOOLS.has(bare) || /(^|_)(screenshot|screen_capture)$/.test(bare || "");
  const blocked = (bare, supportsVision) => isVisionToolName(bare) && !supportsVision;

  ok("screenshot blocked on a non-vision model", blocked("screenshot", false));
  ok("screen_capture blocked on a non-vision model", blocked("screen_capture", false));
  ok("screenshot allowed on Vision", !blocked("screenshot", true));
  ok("screen_capture allowed on Vision", !blocked("screen_capture", true));
  ok("a prefixed phone_screenshot is still caught", blocked("phone_screenshot", false));
  ok("take_screenshot is caught", blocked("take_screenshot", false));
  ok("an ordinary tool is never blocked", !blocked("read_file", false));
  ok("a name merely containing 'screen' is not blocked", !blocked("screen_brightness", false));

  const src = require("fs").readFileSync(
    require("path").join(__dirname, "core", "main.js"), "utf8");
  ok("main.js uses the widened matcher", src.includes("isVisionToolName"));
  ok("refusal explains it is a model limit, not a failure",
     src.includes("not a broken command"));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
