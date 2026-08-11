// SPDX-License-Identifier: GPL-3.0-or-later
const KOFI_URL = "https://ko-fi.com/sebattfg";
const SUPPORTED_HOSTS = [
  "chat.deepseek.com", "deepseek.com", "gemini.google.com", "www.kimi.com", "kimi.com",
  "chat.z.ai", "chat.qwen.ai", "arena.ai", "www.meta.ai", "meta.ai",
];
const DEFAULT_AI_URL = "https://chat.deepseek.com/";

document.getElementById("ver").textContent = `v${chrome.runtime.getManifest().version}`;

function render(s) {
  const dot = document.getElementById("dot");
  const state = document.getElementById("state");
  const tools = document.getElementById("tools");
  const servers = document.getElementById("servers");
  const list = s.servers || [];
  const up = list.filter((x) => x.alive).length;
  const mcpOk = s.connected && (s.mcpAlive || up > 0 || s.tools > 0);
  const studioOff = mcpOk && s.studio === false; // MCP up but no Studio attached
  const ok = mcpOk && !studioOff;
  dot.className = "dot " + (s.connected ? (ok ? "on" : "warn") : "");
  state.textContent = s.connected
    ? (ok ? "Connected · Roblox Studio ready"
        : studioOff ? "Studio not connected · enable the MCP server in Studio"
        : "Bridge OK · open Roblox Studio")
    : "Bridge offline";
  tools.textContent = s.connected ? `${s.tools || 0} tools available` : "Run bridge.py";
  servers.textContent = s.connected
    ? list.map((x) => `${x.alive ? "●" : "○"} ${x.id} (${x.alive ? x.tools + " tools" : "down"})`).join("\n")
    : "";
}

function refresh() {
  chrome.runtime.sendMessage({ type: "status" }, (s) => s && render(s));
}

document.getElementById("reconnect").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "reconnect" }, () => setTimeout(refresh, 600));
});
document.getElementById("restart").addEventListener("click", (e) => {
  e.target.textContent = "Restarting…";
  chrome.runtime.sendMessage({ type: "restart_mcp" }, () => {
    e.target.textContent = "⟳ Restart Roblox server";
    setTimeout(refresh, 600);
  });
});
document.getElementById("kofi").addEventListener("click", () => {
  chrome.tabs.create({ url: KOFI_URL });
});
document.getElementById("settings").addEventListener("click", () => {
  // Same mechanism as the Ko-fi button (chrome.tabs), but tries the in-page
  // panel on an already-open supported AI tab first, so opening it doesn't
  // require a conversation to already be started there.
  chrome.tabs.query({}, (tabs) => {
    const active = tabs.find((t) => t.active && t.url && SUPPORTED_HOSTS.some((h) => t.url.includes(h)));
    const anySupported = active || tabs.find((t) => t.url && SUPPORTED_HOSTS.some((h) => t.url.includes(h)));
    if (anySupported) {
      chrome.tabs.sendMessage(anySupported.id, { type: "zs-open-menu" });
      chrome.tabs.update(anySupported.id, { active: true });
    } else {
      chrome.tabs.create({ url: DEFAULT_AI_URL });
    }
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "zs-status") render(msg);
});
refresh();
setInterval(refresh, 2000);

// ── Bridge endpoint panel ──────────────────────────────────────────────────
// The bridge is normally local, but it can run elsewhere (a container or a
// Railway deploy), which requires a token. Editing it here avoids asking
// anyone to hand-edit background.js.
const epPanel = document.getElementById("endpoint-panel");
const epUrl = document.getElementById("ep-url");
const epToken = document.getElementById("ep-token");
const epWarn = document.getElementById("ep-warn");

function showWarn(text) {
  epWarn.textContent = text || "";
  epWarn.style.display = text ? "" : "none";
}

document.getElementById("endpoint-toggle").addEventListener("click", () => {
  const open = epPanel.style.display !== "none";
  epPanel.style.display = open ? "none" : "";
  if (!open) {
    chrome.runtime.sendMessage({ type: "get-endpoint" }, (r) => {
      if (!r || !r.ok) return;
      epUrl.value = r.url || "";
      // Never render the saved secret back into the DOM; just say it is set.
      epToken.value = "";
      epToken.placeholder = r.hasToken ? "token saved - type to replace" : "token (remote bridges only)";
      showWarn(r.warning);
    });
  }
});

document.getElementById("ep-save").addEventListener("click", () => {
  const payload = { type: "set-endpoint", url: epUrl.value };
  // Empty box = keep the existing token, so saving a URL doesn't wipe it.
  if (epToken.value.trim()) payload.token = epToken.value.trim();
  chrome.runtime.sendMessage(payload, (r) => {
    if (!r || !r.ok) { showWarn((r && r.error) || "could not save"); return; }
    epToken.value = "";
    showWarn(r.warning);
    refresh();
  });
});

document.getElementById("ep-reset").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    { type: "set-endpoint", url: "ws://127.0.0.1:17613", token: "" }, (r) => {
      if (r && r.ok) { epUrl.value = r.url; epToken.value = ""; showWarn(""); refresh(); }
    });
});

// ── Self-test ──────────────────────────────────────────────────────────────
// Runs the REAL provider against the REAL page and copies a report + a
// replayable DOM fixture. This is what makes a provider verifiable for a
// developer who cannot reach the site: paste the result into an issue and the
// fixture can be replayed offline as a regression test.
document.getElementById("selftest").addEventListener("click", () => {
  const out = document.getElementById("selftest-out");
  out.style.display = "";
  out.textContent = "Running…";
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) { out.textContent = "No active tab."; return; }
    chrome.tabs.sendMessage(tab.id, { type: "zs-selftest" }, (r) => {
      if (chrome.runtime.lastError || !r) {
        out.textContent = "ZeroScript is not running on this tab.\n" +
          "Open a supported AI chat first, then try again.";
        return;
      }
      if (!r.ok) { out.textContent = "Self-test error: " + r.error; return; }
      const full = r.text + "\n\n--- FIXTURE (attach this to an issue) ---\n" +
        JSON.stringify(r.report.fixture, null, 2);
      // Also hand the capture to the bridge, which writes it into fixtures/
      // so `node test-fixture-replay.js` can assert against this exact page
      // forever. Sent as a base64url query parameter: the bridge's HTTP layer
      // is the websockets handshake hook, which never reads request bodies.
      try {
        chrome.runtime.sendMessage({ type: "save_fixture", fixture: r.report.fixture },
          (sr) => {
            if (sr && sr.ok && sr.saved) {
              out.textContent += "\n\nSaved to the bridge as " + sr.saved +
                                 " - replay with: node test-fixture-replay.js";
            }
          });
      } catch {}
      out.textContent = r.text + "\n\n(full report + fixture copied to clipboard)";
      navigator.clipboard.writeText(full).catch(() => {
        out.textContent = r.text + "\n\n(could not copy - select and copy manually)";
      });
    });
  });
});

// ── Auto-update ────────────────────────────────────────────────────────────
// The bridge is a git checkout, so it can fast-forward itself and report what
// changed. It NEVER updates on its own and never touches a dirty tree - see
// updater.py. This button is the whole flow: check, apply, reload.
const upBtn = document.getElementById("update");
const upOut = document.getElementById("update-out");

function showUpdate(msg) { upOut.style.display = ""; upOut.textContent = msg; }

upBtn.addEventListener("click", () => {
  showUpdate("Checking…");
  chrome.runtime.sendMessage({ type: "check_update" }, (r) => {
    const i = r && r.info;
    if (!r || !r.ok || !i) {
      // Distinguish "no bridge" from "a bridge too old to answer this". The
      // popup said "Bridge offline" while the SAME popup showed a connected
      // bridge with 15 tools - a flat contradiction for the user. The real
      // cause is a bridge process started before check_update existed, which
      // needs a pull + restart, not starting.
      chrome.runtime.sendMessage({ type: "status" }, (s) => {
        if (s && s.connected) {
          showUpdate("This bridge is running an older version that cannot " +
                     "self-update yet.\n\nIn Termux:\n" +
                     "  cd ~/zs-app && git pull\n" +
                     "  bash start-termux.sh --stop && bash start-termux.sh -b\n\n" +
                     "After that restart, this button works.");
        } else {
          showUpdate("Bridge offline - start it first.");
        }
      });
      return;
    }
    if (!i.ok) { showUpdate((i.reason || "check failed") + "\n" + (i.detail || "")); return; }
    if (!i.updates) { showUpdate("Up to date (" + (i.sha || "") + ")."); return; }
    const list = (i.changes || []).slice(0, 5).map((c) => "  " + c).join("\n");
    showUpdate(i.updates + " update(s) available:\n" + list +
               "\n\nApplying…");
    chrome.runtime.sendMessage({ type: "apply_update" }, (r2) => {
      const j2 = r2 && r2.info;
      if (!j2) { showUpdate("Update failed - bridge did not respond."); return; }
      if (!j2.ok || !j2.applied) {
        showUpdate("NOT updated: " + (j2.reason || "") + "\n" + (j2.detail || ""));
        return;
      }
      showUpdate("Updated " + j2.from + " -> " + j2.to +
                 "\n\nRestart the bridge in Termux, then this extension reloads.");
      // Reload the extension so the new content scripts take effect. The bridge
      // still needs a manual restart - a process cannot replace itself safely
      // from here, and doing so mid-tool-call could corrupt a run.
      setTimeout(() => chrome.runtime.sendMessage({ type: "reload_extension" }), 4000);
    });
  });
});
