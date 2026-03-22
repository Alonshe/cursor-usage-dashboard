/* Cursor Spend Dashboard — Extension JS (MV3 CSP-compliant, no inline handlers) */
"use strict";

let TEAM_ID = null;
const COLORS = [
  "#6c5ce7",
  "#54a0ff",
  "#48dbfb",
  "#ff6b81",
  "#ffc048",
  "#2ed573",
  "#a29bfe",
  "#ff9ff3",
  "#f368e0",
  "#ff6348",
];
const shortName = (u) => u.split("@")[0];
const fmt = (n) => "$" + n.toFixed(2);
const fmtK = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(1) + "B"
    : n >= 1e6
    ? (n / 1e6).toFixed(1) + "M"
    : n >= 1e3
    ? (n / 1e3).toFixed(0) + "K"
    : n;
const shortDate = (d) => {
  const p = d.split("-");
  return p[1] + "/" + p[2];
};
let D = null,
  rawRows = null,
  allCharts = [],
  modalCharts = [];
let selectedDevs = new Set(); // empty = all devs
let allDevs = []; // full dev list from unfiltered aggregate
let fullAggregate = null; // unfiltered aggregate for dev filter display
let currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

// ── Timezone helpers ──
function parseDateUTC(dateStr) {
  const s = (dateStr || "").trim();
  if (!s) return null;
  // Handle "YYYY-MM-DD HH:MM:SS" → "YYYY-MM-DDTHH:MM:SSZ"
  // Handle "YYYY-MM-DD" → "YYYY-MM-DDT00:00:00Z"
  const iso = s.includes(" ") ? s.replace(" ", "T") + "Z"
            : s.length === 10 ? s + "T00:00:00Z"
            : s + (s.endsWith("Z") ? "" : "Z");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}
function getDateInTimezone(dateStr, tz) {
  const d = parseDateUTC(dateStr);
  if (!d) return (dateStr || "").slice(0, 10) || "1970-01-01";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function getHourInTimezone(dateStr, tz) {
  const d = parseDateUTC(dateStr);
  if (!d) return NaN;
  return parseInt(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(d)) % 24;
}
function formatTimeInTimezone(dateStr, tz) {
  const d = parseDateUTC(dateStr);
  if (!d) return "--:--";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d);
}
function tzLabel(tz) {
  if (tz === "UTC") return "UTC";
  try {
    const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).format(new Date());
    const match = short.match(/[A-Z]{2,5}[+-]?\d*$/);
    return match ? match[0] : tz.split("/").pop().replace(/_/g, " ");
  } catch { return tz; }
}

// ── CSV ──
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const hdr = csvLine(lines[0]);
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const v = csvLine(line),
        o = {};
      hdr.forEach((h, i) => (o[h.trim()] = (v[i] || "").trim()));
      return o;
    });
}
function csvLine(line) {
  const r = [];
  let c = "",
    q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      r.push(c);
      c = "";
    } else c += ch;
  }
  r.push(c);
  return r;
}

// ── Aggregate ──
function aggregate(rows) {
  const safeFloat = (v) => {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  };
  const safeInt = (v) => {
    const n = parseInt(v);
    return isNaN(n) ? 0 : n;
  };

  const dailyUserSpend = {},
    dailyTotalSpend = {},
    dailyRequestCount = {};
  const userTotalSpend = {},
    userRequestCount = {},
    userTotalTokens = {},
    userOutputTokens = {};
  const modelSpend = {},
    modelRequestCount = {};
  const kindSpend = {},
    kindCount = {};
  const userModelSpend = {},
    userCacheRead = {},
    userCacheWrite = {},
    userInputNoCache = {};
  const hourlySpend = {},
    hourlyUserSpend = {};
  const userKindSpend = {},
    userHourlySpend = {},
    userDailyReqs = {};

  const tz = currentTimezone;
  for (const row of rows) {
    const date = getDateInTimezone(row.Date, tz);
    const user = row.User || "N/A";
    const model = row.Model || "?";
    const kind = row.Kind || "";
    const cost = safeFloat(row.Cost);
    const totalTokens = safeInt(row["Total Tokens"]);
    const outputTokens = safeInt(row["Output Tokens"]);
    const cacheRead = safeInt(row["Cache Read"]);
    const cacheWrite = safeInt(row["Input (w/ Cache Write)"]);
    const inputNoCache = safeInt(row["Input (w/o Cache Write)"]);
    if (user === "N/A") continue;

    // Daily totals
    if (!dailyUserSpend[date]) dailyUserSpend[date] = {};
    dailyUserSpend[date][user] = (dailyUserSpend[date][user] || 0) + cost;
    dailyTotalSpend[date] = (dailyTotalSpend[date] || 0) + cost;
    dailyRequestCount[date] = (dailyRequestCount[date] || 0) + 1;

    // User totals
    userTotalSpend[user] = (userTotalSpend[user] || 0) + cost;
    userRequestCount[user] = (userRequestCount[user] || 0) + 1;
    userTotalTokens[user] = (userTotalTokens[user] || 0) + totalTokens;
    userOutputTokens[user] = (userOutputTokens[user] || 0) + outputTokens;

    // Model & kind totals
    modelSpend[model] = (modelSpend[model] || 0) + cost;
    if (cost > 0)
      modelRequestCount[model] = (modelRequestCount[model] || 0) + 1;
    kindSpend[kind] = (kindSpend[kind] || 0) + cost;
    kindCount[kind] = (kindCount[kind] || 0) + 1;

    // Per-user breakdowns
    if (!userModelSpend[user]) userModelSpend[user] = {};
    userModelSpend[user][model] = (userModelSpend[user][model] || 0) + cost;
    userCacheRead[user] = (userCacheRead[user] || 0) + cacheRead;
    userCacheWrite[user] = (userCacheWrite[user] || 0) + cacheWrite;
    userInputNoCache[user] = (userInputNoCache[user] || 0) + inputNoCache;
    if (!userKindSpend[user]) userKindSpend[user] = {};
    userKindSpend[user][kind] = (userKindSpend[user][kind] || 0) + cost;
    if (!userDailyReqs[user]) userDailyReqs[user] = {};
    userDailyReqs[user][date] = (userDailyReqs[user][date] || 0) + 1;

    // Hourly breakdown
    try {
      const hour = getHourInTimezone(row.Date, tz);
      if (!isNaN(hour)) {
        hourlySpend[hour] = (hourlySpend[hour] || 0) + cost;
        if (!hourlyUserSpend[hour]) hourlyUserSpend[hour] = {};
        hourlyUserSpend[hour][user] = (hourlyUserSpend[hour][user] || 0) + cost;
        if (!userHourlySpend[user]) userHourlySpend[user] = {};
        userHourlySpend[user][hour] = (userHourlySpend[user][hour] || 0) + cost;
      }
    } catch (e) {}
  }

  // Round floating-point values
  const roundObj = (o) => {
    const n = {};
    for (const k in o) n[k] = Math.round(o[k] * 100) / 100;
    return n;
  };
  const roundNested = (o) => {
    const n = {};
    for (const k in o) n[k] = roundObj(o[k]);
    return n;
  };

  // Sort user model spend by value, filter out zero-cost models
  for (const user in userModelSpend) {
    const sorted = {};
    for (const [m, v] of Object.entries(userModelSpend[user]).sort(
      (a, b) => b[1] - a[1]
    )) {
      if (v > 0) sorted[m] = Math.round(v * 100) / 100;
    }
    userModelSpend[user] = sorted;
  }

  const dates = Object.keys(dailyTotalSpend).sort();
  const users = Object.entries(userTotalSpend)
    .sort((a, b) => b[1] - a[1])
    .map(([u]) => u);
  const totalSpend = users.reduce((s, u) => s + userTotalSpend[u], 0);
  const totalRequests = users.reduce((s, u) => s + userRequestCount[u], 0);

  return {
    dates,
    users,
    dailyUser: roundNested(dailyUserSpend),
    dailyTotal: roundObj(dailyTotalSpend),
    dailyRequests: dailyRequestCount,
    userTotal: roundObj(userTotalSpend),
    userRequests: userRequestCount,
    userTokens: userTotalTokens,
    userOutput: userOutputTokens,
    modelSpend: roundObj(modelSpend),
    modelRequests: modelRequestCount,
    kindSpend: roundObj(kindSpend),
    kindCount,
    userModel: userModelSpend,
    userCacheRead,
    userCacheWrite,
    userInputNoCache,
    hourly: roundObj(hourlySpend),
    hourlyUser: roundNested(hourlyUserSpend),
    userKind: roundNested(userKindSpend),
    userHourly: roundNested(userHourlySpend),
    userDailyRequests: userDailyReqs,
    totalSpend: Math.round(totalSpend * 100) / 100,
    totalRequests,
    dateRange: dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "—",
    numDays: dates.length,
  };
}

// ── Theme ──
function isDark() {
  const t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme:dark)").matches;
}
function TC() {
  const dk = isDark();
  return {
    leg: dk ? "#b0b4c8" : "#3a3f5c",
    ax: dk ? "#6b7094" : "#6b7094",
    gr: dk ? "rgba(42,47,68,.5)" : "rgba(0,0,0,.07)",
    ho: dk ? "#2a2f44" : "#e2e4ea",
    card: dk ? "#1e1e2e" : "#ffffff",
  };
}
function toggleTheme() {
  const c = document.documentElement.getAttribute("data-theme"),
    s = window.matchMedia("(prefers-color-scheme:dark)").matches;
  document.documentElement.setAttribute(
    "data-theme",
    !c ? (s ? "light" : "dark") : c === "dark" ? "light" : "dark"
  );
  updBtn();
  if (D) rebuildCharts();
}
function updBtn() {
  const dk = isDark();
  document.getElementById("theme-icon").textContent = dk ? "☀️" : "🌙";
  document.getElementById("theme-label").textContent = dk ? "Light" : "Dark";
}
updBtn();
window
  .matchMedia("(prefers-color-scheme:dark)")
  .addEventListener("change", () => {
    if (!document.documentElement.getAttribute("data-theme")) {
      if (D) rebuildCharts();
      updBtn();
    }
  });
let rzt;
window.addEventListener("resize", () => {
  clearTimeout(rzt);
  rzt = setTimeout(() => {
    if (D) rebuildCharts();
  }, 250);
});

// ── Static element event listeners (replaces all inline onclick) ──
document
  .getElementById("theme-toggle-btn")
  .addEventListener("click", toggleTheme);
document.getElementById("tz-select").addEventListener("change", function () {
  currentTimezone = this.value;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ cursorTimezone: currentTimezone });
  }
  if (rawRows) {
    const filtered = selectedDevs.size === 0 ? rawRows : rawRows.filter((r) => selectedDevs.has(r.User));
    D = aggregate(filtered);
    renderDashboard();
  }
});
document.getElementById("csv-input").addEventListener("change", function () {
  handleFileSelect(this);
});
document
  .getElementById("fetch-btn")
  .addEventListener("click", () => fetchReport());
document
  .getElementById("load-csv-btn")
  .addEventListener("click", () =>
    document.getElementById("csv-input").click()
  );
document
  .getElementById("export-toggle-btn")
  .addEventListener("click", toggleExportMenu);
document.getElementById("export-png-btn").addEventListener("click", () => {
  exportElementPNG("dashboard", D.dateRange.replace(/ to /, "-"));
  closeExportMenu();
});
document.getElementById("export-print-btn").addEventListener("click", () => {
  window.print();
  closeExportMenu();
});
document.getElementById("export-snapshot-btn").addEventListener("click", () => {
  exportSnapshot();
  closeExportMenu();
});
document.getElementById("drp-trigger").addEventListener("click", toggleDRP);
document.getElementById("dev-filter-trigger").addEventListener("click", toggleDevFilter);
document.getElementById("drp-cancel-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  cancelDRP();
});
document.getElementById("drp-apply-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  applyDRP();
});
document
  .getElementById("modal-overlay")
  .addEventListener("click", function (e) {
    if (e.target === this) closeModal();
  });

// ── Close modal on Escape ──
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeModal();
});

// ── Global delegation for dynamically created elements ──
document.addEventListener("click", function (e) {
  // Drilldown links in tables
  const drillEl = e.target.closest("[data-drilldown]");
  if (drillEl) {
    showDrilldown(drillEl.dataset.drilldown);
    return;
  }

  // Modal close button
  if (e.target.closest(".modal-close")) {
    closeModal();
    return;
  }

  // Empty state fetch button
  if (e.target.closest("#empty-fetch-btn")) {
    fetchReport();
    return;
  }

  // Empty state load CSV button
  if (e.target.closest("#empty-csv-btn")) {
    document.getElementById("csv-input").click();
    return;
  }

  // Upload hint browse link
  if (e.target.closest("#upload-browse-link")) {
    e.preventDefault();
    document.getElementById("csv-input").click();
    return;
  }

  // Export menu close on outside click
  if (!e.target.closest(".export-wrap")) closeExportMenu();

  // DRP close on outside click
  if (!e.target.closest("#drp")) closeDRP();

  // Dev filter close on outside click
  if (!e.target.closest("#dev-filter")) closeDevFilter();
});

// ── API ──
function getApiUrl() {
  if (!TEAM_ID) {
    toast("Team ID not set. Configure it in the extension popup.");
    return null;
  }
  if (!drpStart || !drpEnd) return null;
  const s = fmtISO(drpStart),
    e = fmtISO(drpEnd);
  return `https://cursor.com/api/dashboard/export-usage-events-csv?teamId=${TEAM_ID}&isEnterprise=false&startDate=${new Date(
    s + "T00:00:00"
  ).getTime()}&endDate=${new Date(
    e + "T23:59:59.999"
  ).getTime()}&strategy=tokens`;
}

async function fetchReport() {
  const url = getApiUrl();
  if (!url) {
    toast("Pick a date range first");
    return;
  }
  const btn = document.getElementById("fetch-btn");
  btn.disabled = true;
  btn.innerHTML = "⏳ Fetching...";
  showLoader();
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(res.status);
    const text = await res.text();
    if (!text.includes(",") || text.includes("<!DOCTYPE"))
      throw new Error("not csv");
    rawRows = parseCSV(text);
    if (!rawRows.length) throw new Error("empty");
    fullAggregate = null; selectedDevs = new Set();
    D = aggregate(rawRows);
    toast(
      `Loaded ${rawRows.length.toLocaleString()} rows · ${
        D.users.length
      } developers`
    );
    hideUploadPrompt();
    buildDevFilter();
    renderDashboard();
  } catch (e) {
    window.open(url, "_blank");
    showEmptyState();
    showUploadPrompt();
  } finally {
    btn.disabled = false;
    btn.innerHTML = "↓ Fetch Report";
  }
}

function showUploadPrompt() {
  const es = document.querySelector(".empty-state");
  if (es && !document.getElementById("upload-hint")) {
    const hint = document.createElement("div");
    hint.id = "upload-hint";
    hint.style.cssText =
      "margin-top:32px;padding-top:28px;border-top:1px solid var(--border);text-align:center;animation:fadeIn .3s ease";
    hint.innerHTML = `<div style="font-size:36px;margin-bottom:10px">📥</div>
      <div style="font-size:15px;font-weight:600;color:var(--text);margin-bottom:6px">CSV downloaded</div>
      <div style="font-size:13px;color:var(--text2)">Drag the file here, or <a href="#" id="upload-browse-link" style="color:var(--accent);font-weight:600;text-decoration:underline">browse</a> to select it.</div>`;
    es.appendChild(hint);
  }
}
function hideUploadPrompt() {
  const h = document.getElementById("upload-hint");
  if (h) h.remove();
}

// ── File ──
function handleFileSelect(input) {
  const f = input.files[0];
  if (f) processFile(f);
  input.value = "";
}
function processFile(file) {
  if (!file.name.endsWith(".csv")) {
    toast("Please use a .csv file");
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      rawRows = parseCSV(e.target.result);
      if (!rawRows.length) {
        toast("CSV appears empty");
        return;
      }
      fullAggregate = null; selectedDevs = new Set();
      D = aggregate(rawRows);
      toast(
        `Loaded ${rawRows.length.toLocaleString()} rows · ${
          D.users.length
        } developers`
      );
      // Also save to chrome.storage so popup "re-open last" works
      if (
        typeof chrome !== "undefined" &&
        chrome.storage &&
        chrome.storage.local
      ) {
        chrome.storage.local.set({
          cursorCsvData: e.target.result,
          cursorCsvTimestamp: Date.now(),
        });
      }
      hideUploadPrompt();
      buildDevFilter();
      renderDashboard();
    } catch (err) {
      toast("Parse error: " + err.message);
      console.error(err);
      showEmptyState();
    }
  };
  showLoader();
  reader.readAsText(file);
}

// ── Drag & Drop ──
let dragCount = 0;
document.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragCount++;
  document.getElementById("drop-overlay").classList.add("show");
});
document.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragCount--;
  if (dragCount <= 0) {
    dragCount = 0;
    document.getElementById("drop-overlay").classList.remove("show");
  }
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragCount = 0;
  document.getElementById("drop-overlay").classList.remove("show");
  if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
});

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}

// ── Export ──
const EXPORT_BG = {
  dashboard: ["#0c0e14", "#f4f5f7"],
  "modal-content": ["#151823", "#fff"],
};
function exportElementPNG(elementId, filenameSuffix) {
  toast("Generating screenshot...");
  const el = document.getElementById(elementId);
  const [darkBg, lightBg] = EXPORT_BG[elementId] || ["#0c0e14", "#f4f5f7"];
  html2canvas(el, {
    backgroundColor: isDark() ? darkBg : lightBg,
    scale: 2,
    useCORS: true,
  })
    .then((canvas) => {
      const link = document.createElement("a");
      link.download = `cursor-spend-${filenameSuffix}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast("PNG saved!");
    })
    .catch(() => toast("Export failed — try Print/PDF instead"));
}

function toggleExportMenu() {
  document.getElementById("export-menu").classList.toggle("show");
}
function closeExportMenu() {
  document.getElementById("export-menu").classList.remove("show");
}

// ── Developer Drill-Down ──
function showDrilldown(user) {
  const ci = D.users.indexOf(user) % COLORS.length;
  const color = COLORS[ci];
  const um = D.userModel[user] || {};
  const cr = D.userCacheRead[user] || 0,
    cw = D.userCacheWrite[user] || 0,
    nc = D.userInputNoCache[user] || 0;
  const tot = cr + cw + nc,
    hit = tot > 0 ? ((cr / tot) * 100).toFixed(0) : 0;
  const cpr = (D.userTotal[user] / D.userRequests[user]).toFixed(2);
  const pct = ((D.userTotal[user] / D.totalSpend) * 100).toFixed(1);
  const uk = D.userKind[user] || {};
  const odPct =
    D.userTotal[user] > 0
      ? (((uk["On-Demand"] || 0) / D.userTotal[user]) * 100).toFixed(0)
      : "0";
  const modalCalDays = D.dates.length
    ? Math.round(
        (new Date(D.dates[D.dates.length - 1] + "T12:00:00") -
          new Date(D.dates[0] + "T12:00:00")) /
          864e5
      ) + 1
    : 0;
  const dailyAvg = modalCalDays > 0 ? D.userTotal[user] / modalCalDays : 0;

  document.getElementById("modal-content").innerHTML = `
    <button class="modal-close">✕</button>
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;margin-top:8px">
      <div>
        <h2 style="color:${color}">${shortName(user)}</h2>
        <div class="modal-sub" style="margin-bottom:0">${user} · ${pct}% of team spend</div>
      </div>
      <div class="export-wrap" style="margin-right:52px">
        <button class="btn sec" id="modal-export-toggle">Export <span style="font-size:10px;margin-left:2px">▾</span></button>
        <div class="export-menu" id="modal-export-menu">
          <button id="modal-export-png">📷 PNG</button>
          <button id="modal-export-print">📄 PDF</button>
        </div>
      </div>
    </div>
    <div class="modal-stats">
      <div class="modal-stat"><div class="label">Total Spend</div><div class="val">${fmt(
        D.userTotal[user]
      )}</div></div>
      <div class="modal-stat"><div class="label">Requests</div><div class="val">${D.userRequests[
        user
      ].toLocaleString()}</div></div>
      <div class="modal-stat"><div class="label">$/Request</div><div class="val">${fmt(
        parseFloat(cpr)
      )}</div></div>
      <div class="modal-stat"><div class="label">Cache Hit</div><div class="val">${hit}%</div></div>
    </div>
    <div class="modal-stats" style="margin-top:8px">
      <div class="modal-stat"><div class="label">Daily Average</div><div class="val">${fmt(
        dailyAvg
      )}</div></div>
      <div class="modal-stat"><div class="label">Total Tokens</div><div class="val">${fmtK(
        cw + nc + (D.userOutput[user] || 0)
      )}</div></div>
      <div class="modal-stat"><div class="label">Output Tokens</div><div class="val">${fmtK(
        D.userOutput[user]
      )}</div></div>
      <div class="modal-stat"><div class="label">On-Demand</div><div class="val">${odPct}%</div></div>
    </div>
    <div class="modal-charts">
      <div class="modal-card"><h4>Daily Spend</h4><div style="height:200px"><canvas id="mc-daily"></canvas></div></div>
      <div class="modal-card"><h4>Model Mix</h4><div style="height:200px"><canvas id="mc-model"></canvas></div></div>
    </div>
    <div class="modal-charts" style="margin-top:8px">
      <div class="modal-card"><h4>Activity by Hour (${tzLabel(currentTimezone)})</h4><div style="height:200px"><canvas id="mc-hourly"></canvas></div></div>
      <div class="modal-card"><h4>Daily Requests</h4><div style="height:200px"><canvas id="mc-requests"></canvas></div></div>
    </div>
    <div class="feed-section" style="margin-top:16px">
      <h4>Request Activity</h4>
      <div class="feed-filters" id="feed-filters"></div>
      <div class="activity-feed" id="activity-feed"></div>
    </div>`;

  document.getElementById("modal-overlay").classList.add("show");
  document.body.style.overflow = "hidden";
  document
    .getElementById("modal-export-toggle")
    .addEventListener("click", () =>
      document.getElementById("modal-export-menu").classList.toggle("show")
    );
  document.getElementById("modal-export-png").addEventListener("click", () => {
    exportElementPNG(
      "modal-content",
      shortName(user) + "-" + D.dateRange.replace(/ to /, "-")
    );
    document.getElementById("modal-export-menu").classList.remove("show");
  });
  document
    .getElementById("modal-export-print")
    .addEventListener("click", () => {
      window.print();
      document.getElementById("modal-export-menu").classList.remove("show");
    });

  setTimeout(() => {
    modalCharts.forEach((c) => c.destroy());
    modalCharts.length = 0;

    modalCharts.push(
      new Chart(document.getElementById("mc-daily"), {
        type: "bar",
        data: {
          labels: D.dates.map(shortDate),
          datasets: [
            {
              data: D.dates.map((d) => (D.dailyUser[d] || {})[user] || 0),
              backgroundColor: color + "cc",
              borderRadius: 4,
            },
          ],
        },
        options: makeChartOptions({ hideLegend: true, yFormat: FMT_DOLLAR }),
      })
    );

    const me = Object.entries(um).filter(([, v]) => v > 0);
    modalCharts.push(
      new Chart(document.getElementById("mc-model"), {
        type: "doughnut",
        data: {
          labels: me.map(([k]) => k),
          datasets: [
            {
              data: me.map(([, v]) => v),
              backgroundColor: COLORS.slice(0, me.length),
              borderWidth: 2,
              borderColor: TC().card,
            },
          ],
        },
        options: makeChartOptions({
          cutout: "58%",
          legendPos: "bottom",
          legendLabels: {
            font: { family: "DM Sans", size: 10 },
            boxWidth: 10,
            padding: 8,
          },
        }),
      })
    );

    const hrs = Array.from({ length: 24 }, (_, i) => i);
    const uHourly = D.userHourly[user] || {};
    modalCharts.push(
      new Chart(document.getElementById("mc-hourly"), {
        type: "bar",
        data: {
          labels: hrs.map((h) => h.toString().padStart(2, "0") + ":00"),
          datasets: [
            {
              data: hrs.map((h) => uHourly[h] || 0),
              backgroundColor: color + "aa",
              borderRadius: 3,
            },
          ],
        },
        options: makeChartOptions({ hideLegend: true, yFormat: FMT_DOLLAR }),
      })
    );

    const udr = D.userDailyRequests[user] || {};
    modalCharts.push(
      new Chart(document.getElementById("mc-requests"), {
        type: "bar",
        data: {
          labels: D.dates.map(shortDate),
          datasets: [
            {
              data: D.dates.map((d) => udr[d] || 0),
              backgroundColor: color + "88",
              borderRadius: 4,
            },
          ],
        },
        options: makeChartOptions({ hideLegend: true, yFormat: FMT_INT }),
      })
    );

    renderActivityFeed(user);
  }, 50);
}
// ── Activity Feed ──
function renderActivityFeed(user) {
  if (!rawRows) return;
  const userRows = rawRows
    .filter((r) => r.User === user)
    .sort((a, b) => (b.Date || "").localeCompare(a.Date || ""));

  // Collect unique models and types for filter chips
  const models = [...new Set(userRows.map((r) => r.Model || "?"))].sort();
  const types = [...new Set(userRows.map((r) => r.Kind || ""))].filter(Boolean).sort();
  const maxTokens = Math.max(1, ...userRows.map((r) => parseInt(r["Total Tokens"]) || 0));

  // Model color map (reuse COLORS palette)
  const modelColors = {};
  models.forEach((m, i) => (modelColors[m] = COLORS[i % COLORS.length]));

  let activeModels = new Set();
  let activeTypes = new Set();

  function matchesFilters(r) {
    if (activeModels.size && !activeModels.has(r.Model || "?")) return false;
    if (activeTypes.size && !activeTypes.has(r.Kind || "")) return false;
    return true;
  }

  function renderFilters() {
    const el = document.getElementById("feed-filters");
    el.innerHTML = "";
    models.forEach((m) => {
      const chip = document.createElement("button");
      chip.className = "feed-chip" + (activeModels.has(m) ? " active" : "");
      chip.textContent = m;
      chip.style.borderColor = activeModels.has(m) ? modelColors[m] : "";
      chip.style.color = activeModels.has(m) ? modelColors[m] : "";
      chip.style.background = activeModels.has(m) ? modelColors[m] + "18" : "";
      chip.addEventListener("click", () => {
        activeModels.has(m) ? activeModels.delete(m) : activeModels.add(m);
        renderFilters();
        renderFeed();
      });
      el.appendChild(chip);
    });
    types.forEach((t) => {
      const chip = document.createElement("button");
      chip.className = "feed-chip" + (activeTypes.has(t) ? " active" : "");
      chip.textContent = t;
      chip.addEventListener("click", () => {
        activeTypes.has(t) ? activeTypes.delete(t) : activeTypes.add(t);
        renderFilters();
        renderFeed();
      });
      el.appendChild(chip);
    });
  }

  function renderFeed() {
    const container = document.getElementById("activity-feed");
    const filtered = userRows.filter(matchesFilters);
    if (!filtered.length) {
      container.innerHTML = '<div class="feed-empty">No requests match the selected filters</div>';
      return;
    }

    // Group all by date (collapsed by default, so all dates render)
    const groups = {};
    filtered.forEach((r) => {
      const date = getDateInTimezone(r.Date, currentTimezone);
      if (!groups[date]) groups[date] = [];
      groups[date].push(r);
    });

    let html = "";
    for (const date of Object.keys(groups).sort().reverse()) {
      const items = groups[date];
      const dayCost = items.reduce((s, r) => s + (parseFloat(r.Cost) || 0), 0);
      const dayReqs = items.length;
      const dp = date.split("-");
      const dateLabel = dp[1] + "/" + dp[2] + "/" + dp[0];

      html += `<div class="feed-group collapsed" data-feed-date="${date}">`;
      html += `<div class="feed-date-header collapsed" data-feed-toggle="${date}">`;
      html += `<span class="feed-date-label"><span class="feed-chevron">▼</span> ${dateLabel}</span>`;
      html += `<span class="feed-date-meta"><span>${dayReqs} req</span><span>${fmt(dayCost)}</span></span>`;
      html += `</div>`;
      html += `<div class="feed-group-items">`;

      for (const r of items) {
        const time = r.Date ? formatTimeInTimezone(r.Date, currentTimezone) : "--:--";
        const model = r.Model || "?";
        const tokens = parseInt(r["Total Tokens"]) || 0;
        const cost = parseFloat(r.Cost) || 0;
        const kind = r.Kind || "";
        const barPct = Math.max(2, (tokens / maxTokens) * 100);
        const mColor = modelColors[model] || COLORS[0];
        const typeClass = kind === "On-Demand" ? "on-demand" : "included";

        html += `<div class="feed-item">`;
        html += `<span class="feed-time">${time}</span>`;
        html += `<span class="feed-model" title="${model}" style="background:${mColor}20;color:${mColor}">${model}</span>`;
        html += `<span class="feed-tokens">`;
        html += `<span class="feed-token-bar" style="width:${barPct}%;background:${mColor}66"></span>`;
        html += `<span class="feed-token-label">${fmtK(tokens)}</span>`;
        html += `</span>`;
        html += `<span class="feed-type ${typeClass}">${kind}</span>`;
        html += `<span class="feed-cost${cost >= 0.5 ? " high" : ""}">${fmt(cost)}</span>`;
        html += `</div>`;
      }

      html += `</div></div>`;
    }

    container.innerHTML = html;

    // Date group collapse/expand
    container.querySelectorAll("[data-feed-toggle]").forEach((hdr) => {
      hdr.addEventListener("click", () => {
        const group = hdr.closest(".feed-group");
        group.classList.toggle("collapsed");
        hdr.classList.toggle("collapsed");
      });
    });
  }

  renderFilters();
  renderFeed();
}

function closeModal() {
  document.getElementById("modal-overlay").classList.remove("show");
  document.body.style.overflow = "";
  modalCharts.forEach((c) => c.destroy());
  modalCharts.length = 0;
}

// ── Dev Filter ──
function buildDevFilter() {
  const wrap = document.getElementById("dev-filter");
  wrap.style.display = "";
  renderDevFilterDropdown();
}

function renderDevFilterDropdown() {
  const dd = document.getElementById("dev-filter-dropdown");
  if (!fullAggregate) fullAggregate = aggregate(rawRows);
  allDevs = fullAggregate.users;
  const fullD = fullAggregate;

  let html = "";
  allDevs.forEach((u, i) => {
    const ci = i % COLORS.length;
    const sel = selectedDevs.size === 0 || selectedDevs.has(u);
    html += `<div class="dev-filter-item${sel ? " selected" : ""}" data-dev="${u}">
      <span class="dev-filter-check">✓</span>
      <span class="dev-filter-dot" style="background:${COLORS[ci]}"></span>
      <span class="dev-filter-name">${shortName(u)}</span>
      <span class="dev-filter-spend">${fmt(fullD.userTotal[u])}</span>
    </div>`;
  });
  html += `<div class="dev-filter-actions">
    <button id="dev-filter-all">Select All</button>
    <button id="dev-filter-none">Clear</button>
  </div>`;
  dd.innerHTML = html;

  // Update trigger label
  updateDevFilterLabel();

  // Bind clicks
  dd.querySelectorAll(".dev-filter-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const u = item.dataset.dev;
      if (selectedDevs.size === 0) {
        // Currently "all" — switching to single select means select only this one
        selectedDevs = new Set(allDevs);
        selectedDevs.delete(u);
      } else if (selectedDevs.has(u)) {
        selectedDevs.delete(u);
        if (selectedDevs.size === 0) {
          // Don't allow empty — revert to all
          selectedDevs = new Set();
        }
      } else {
        selectedDevs.add(u);
        if (selectedDevs.size === allDevs.length) {
          selectedDevs = new Set(); // all selected = reset to "all"
        }
      }
      applyDevFilter();
    });
  });

  document.getElementById("dev-filter-all").addEventListener("click", (e) => {
    e.stopPropagation();
    selectedDevs = new Set();
    applyDevFilter();
  });
  document.getElementById("dev-filter-none").addEventListener("click", (e) => {
    e.stopPropagation();
    // Select only the top spender to avoid empty
    selectedDevs = new Set([allDevs[0]]);
    applyDevFilter();
  });
}

function updateDevFilterLabel() {
  const trigger = document.getElementById("dev-filter-trigger");
  if (selectedDevs.size === 0) {
    trigger.innerHTML = '👤 All Developers <span style="font-size:10px;margin-left:2px">▾</span>';
  } else if (selectedDevs.size === 1) {
    const u = [...selectedDevs][0];
    trigger.innerHTML = `👤 ${shortName(u)} <span style="font-size:10px;margin-left:2px">▾</span>`;
  } else {
    trigger.innerHTML = `👤 ${selectedDevs.size} Developers <span class="dev-filter-count">${selectedDevs.size}</span> <span style="font-size:10px;margin-left:2px">▾</span>`;
  }
}

function applyDevFilter() {
  const filtered = selectedDevs.size === 0
    ? rawRows
    : rawRows.filter((r) => selectedDevs.has(r.User));
  D = aggregate(filtered);
  renderDevFilterDropdown();
  renderDashboard();
}

function toggleDevFilter() {
  const dd = document.getElementById("dev-filter-dropdown");
  const trigger = document.getElementById("dev-filter-trigger");
  dd.classList.toggle("show");
  trigger.classList.toggle("open");
}
function closeDevFilter() {
  document.getElementById("dev-filter-dropdown").classList.remove("show");
  document.getElementById("dev-filter-trigger").classList.remove("open");
}

// ── Render ──
function renderDashboard() {
  document.getElementById("toolbar").style.display = "";
  const drp = document.getElementById("drp");
  drp.style.display = "";
  document.getElementById("drp-toolbar-slot").appendChild(drp);
  // Show & update dev filter
  document.getElementById("dev-filter").style.display = "";
  updateDevFilterLabel();

  const totalTk = D.users.reduce(
    (s, u) =>
      s +
      (D.userCacheWrite[u] || 0) +
      (D.userInputNoCache[u] || 0) +
      (D.userOutput[u] || 0),
    0
  );
  const calDays = D.dates.length
    ? Math.round(
        (new Date(D.dates[D.dates.length - 1] + "T12:00:00") -
          new Date(D.dates[0] + "T12:00:00")) /
          864e5
      ) + 1
    : 0;
  document.getElementById("header-meta").textContent = `tuvis.com team · ${
    D.dateRange
  } · ${calDays} days · ${D.totalRequests.toLocaleString()} requests · ${fmtK(
    totalTk
  )} tokens`;
  if (D.dates.length) {
    drpStart = new Date(D.dates[0] + "T12:00:00");
    drpEnd = new Date(D.dates[D.dates.length - 1] + "T12:00:00");
    updateDRPText();
  }

  document.getElementById("dashboard").innerHTML = `<div class="grid">
    <div class="kpi-row" id="kpis"></div>
    <div class="card full"><h3>Developer Breakdown</h3><div class="table-wrap"><table id="t-users"></table></div></div>
    <div class="card full"><h3>Model Usage per Developer</h3><div class="table-wrap"><table id="t-models"></table></div></div>
    <div class="chart-row">
      <div class="card"><h3>Daily Spend Trend</h3><div style="height:300px"><canvas id="c-daily"></canvas></div></div>
      <div class="card"><h3>Spend by Model</h3><div style="height:300px"><canvas id="c-model"></canvas></div></div>
    </div>
    <div class="chart-row">
      <div class="card"><h3>Daily Spend by Developer (Stacked)</h3><div style="height:300px"><canvas id="c-stacked"></canvas></div></div>
      <div class="card"><h3>Activity by Hour (${tzLabel(currentTimezone)})</h3><div style="height:300px"><canvas id="c-hourly"></canvas></div></div>
    </div>
    <div class="chart-row triple">
      <div class="card"><h3>Token Volume</h3><div style="height:280px"><canvas id="c-tokens"></canvas></div></div>
      <div class="card"><h3>Cost per Request</h3><div style="height:280px"><canvas id="c-cpr"></canvas></div></div>
      <div class="card"><h3>Included vs On-Demand</h3><div style="height:280px"><canvas id="c-kind"></canvas></div></div>
    </div>
  </div>`;

  const avg = D.totalSpend / calDays,
    top = D.users[0],
    peak = Object.entries(D.dailyTotal).sort((a, b) => b[1] - a[1])[0];
  const odPct =
    D.totalSpend > 0
      ? (((D.kindSpend["On-Demand"] || 0) / D.totalSpend) * 100).toFixed(0)
      : "0";
  document.getElementById("kpis").innerHTML = [
    { l: "Total Spend", v: fmt(D.totalSpend), s: `${calDays} day period`, icon: "💰", color: "#6c5ce7", grad: "linear-gradient(90deg,#6c5ce7,#a29bfe)" },
    { l: "Daily Average", v: fmt(avg), s: `${fmt(avg * 30)}/mo projected`, icon: "📊", color: "#48dbfb", grad: "linear-gradient(90deg,#48dbfb,#0abde3)" },
    {
      l: "Top Spender",
      v: shortName(top),
      s:
        fmt(D.userTotal[top]) +
        ` (${((D.userTotal[top] / D.totalSpend) * 100).toFixed(0)}%)`,
      icon: "👤", color: "#feca57", grad: "linear-gradient(90deg,#feca57,#ff9f43)"
    },
    { l: "Peak Day", v: fmt(peak[1]), s: shortDate(peak[0]), icon: "🔥", color: "#ff6b6b", grad: "linear-gradient(90deg,#ff6b6b,#ee5a24)" },
    {
      l: "Avg Cost/Request",
      v: fmt(D.totalSpend / D.totalRequests),
      s: `${D.totalRequests.toLocaleString()} total`,
      icon: "⚡", color: "#a29bfe", grad: "linear-gradient(90deg,#a29bfe,#6c5ce7)"
    },
    {
      l: "On-Demand",
      v: odPct + "%",
      s: fmt(D.kindSpend["On-Demand"] || 0) + " of total",
      icon: "🔄", color: "#2ed573", grad: "linear-gradient(90deg,#2ed573,#48dbfb)"
    },
  ]
    .map(
      (k) =>
        `<div class="kpi" style="--kpi-color:${k.color};--kpi-grad:${k.grad};--kpi-glow:${k.color}15;--kpi-icon-bg:${k.color}18;--kpi-icon-bg-hover:${k.color}28"><div class="kpi-header"><div class="label">${k.l}</div><div class="kpi-icon">${k.icon}</div></div><div class="value">${k.v}</div><div class="sub">${k.s}</div></div>`
    )
    .join("");

  renderTables();
  rebuildCharts();
}

function renderTables() {
  const mx = Math.max(...D.users.map((u) => D.userTotal[u]));
  // NOTE: uses data-drilldown attribute instead of onclick for CSP compliance
  document.getElementById("t-users").innerHTML = `
  <thead><tr><th>Developer</th><th>Total Spend</th><th style="width:30%">Share</th><th>Requests</th><th>$/Request</th><th>Tokens</th><th>Cache Hit</th></tr></thead>
  <tbody>${D.users
    .map((u, i) => {
      const ci = i % COLORS.length,
        pct = ((D.userTotal[u] / D.totalSpend) * 100).toFixed(1);
      const cpr = (D.userTotal[u] / D.userRequests[u]).toFixed(2);
      const cr = D.userCacheRead[u] || 0,
        cw = D.userCacheWrite[u] || 0,
        nc = D.userInputNoCache[u] || 0;
      const tot = cr + cw + nc,
        hit = tot > 0 ? ((cr / tot) * 100).toFixed(0) : 0;
      return `<tr>
      <td><span class="user-name" style="color:${
        COLORS[ci]
      }" data-drilldown="${u}">${shortName(
        u
      )}</span><br><span class="user-email">${u}</span></td>
      <td class="mono" style="font-weight:600">${fmt(D.userTotal[u])}</td>
      <td><div class="bar-cell"><span class="mono" style="min-width:42px">${pct}%</span><div class="bar-bg"><div class="bar-fill" style="width:${
        (D.userTotal[u] / mx) * 100
      }%;background:${COLORS[ci]}"></div></div></div></td>
      <td class="mono">${D.userRequests[u]}</td>
      <td class="mono">${fmt(parseFloat(cpr))}</td>
      <td class="mono">${fmtK(
        (D.userCacheWrite[u] || 0) +
          (D.userInputNoCache[u] || 0) +
          (D.userOutput[u] || 0)
      )}</td>
      <td class="mono">${hit}%</td>
    </tr>`;
    })
    .join("")}</tbody>`;

  const allM = [
    ...new Set(D.users.flatMap((u) => Object.keys(D.userModel[u] || {}))),
  ];
  const mOrd = Object.entries(D.modelSpend)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)
    .filter((m) => allM.includes(m));
  const sM = (m) =>
    m
      .replace("claude-4.6-", "c46-")
      .replace("claude-4.5-", "c45-")
      .replace("medium-thinking", "med-think")
      .replace("high-thinking", "hi-think")
      .replace("premium ", "");
  document.getElementById("t-models").innerHTML = `
  <thead><tr><th>Developer</th>${mOrd
    .map((m) => `<th style="font-size:10px">${sM(m)}</th>`)
    .join("")}<th>Primary</th></tr></thead>
  <tbody>${D.users
    .map((u, i) => {
      const um = D.userModel[u] || {},
        ci = i % COLORS.length;
      const pr = Object.entries(um).sort((a, b) => b[1] - a[1])[0];
      return `<tr><td><span style="color:${
        COLORS[ci]
      };font-weight:600;cursor:pointer" data-drilldown="${u}">${shortName(
        u
      )}</span></td>
    ${mOrd
      .map((m) => {
        const v = um[m] || 0;
        const bg =
          v > 0
            ? `rgba(${parseInt(COLORS[ci].slice(1, 3), 16)},${parseInt(
                COLORS[ci].slice(3, 5),
                16
              )},${parseInt(COLORS[ci].slice(5, 7), 16)},${
                Math.min(v / 50, 0.5) + 0.05
              })`
            : "transparent";
        return `<td class="mono" style="background:${bg};text-align:center;font-size:11px">${
          v > 0 ? "$" + v.toFixed(0) : "—"
        }</td>`;
      })
      .join("")}
    <td style="font-size:12px;font-weight:500">${pr ? pr[0] : "—"}</td></tr>`;
    })
    .join("")}</tbody>`;
}

// ── Charts ──
const FMT_DOLLAR = (v) => "$" + Math.round(v * 100) / 100;
const FMT_INT = (v) => Math.round(v);

function makeChartOptions({
  hideLegend,
  legendPos,
  legendLabels,
  stacked,
  yFormat,
  xFormat,
  indexAxis,
  cutout,
} = {}) {
  const t = TC();
  const ax = {
    ticks: { color: t.ax, font: { family: "JetBrains Mono", size: 10 } },
    grid: { color: t.gr },
    border: { color: "transparent" },
  };
  const opts = { responsive: true, maintainAspectRatio: false, plugins: {} };

  if (hideLegend) {
    opts.plugins.legend = { display: false };
  } else {
    opts.plugins.legend = {
      position: legendPos || "top",
      labels: {
        color: t.leg,
        font: { family: "DM Sans", size: 11 },
        boxWidth: 12,
        padding: 16,
        ...legendLabels,
      },
    };
  }

  if (cutout) {
    opts.cutout = cutout;
    return opts;
  }

  const tickFmt = (f) => (f ? { ...ax.ticks, callback: f } : ax.ticks);
  const xAx = { ...ax, stacked: !!stacked, ticks: tickFmt(xFormat) };
  const yAx = { ...ax, stacked: !!stacked, ticks: tickFmt(yFormat) };

  if (indexAxis === "y") {
    opts.indexAxis = "y";
    opts.scales = { x: { ...ax, ticks: tickFmt(yFormat) }, y: ax };
  } else opts.scales = { x: xAx, y: yAx };

  return opts;
}

function rebuildCharts() {
  allCharts.forEach((c) => c.destroy());
  allCharts.length = 0;
  if (!D) return;
  const t = TC();

  // Daily spend line
  allCharts.push(
    new Chart(document.getElementById("c-daily"), {
      type: "line",
      data: {
        labels: D.dates.map(shortDate),
        datasets: [
          {
            data: D.dates.map((d) => D.dailyTotal[d]),
            borderColor: "#6c5ce7",
            backgroundColor: "rgba(108,92,231,.1)",
            fill: true,
            tension: 0.3,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: "#6c5ce7",
          },
        ],
      },
      options: makeChartOptions({ hideLegend: true, yFormat: FMT_DOLLAR }),
    })
  );

  // Model doughnut
  const me = Object.entries(D.modelSpend)
    .filter(([, v]) => v > 0)
    .slice(0, 8);
  const mlp = window.innerWidth > 1200 ? "right" : "bottom";
  allCharts.push(
    new Chart(document.getElementById("c-model"), {
      type: "doughnut",
      data: {
        labels: me.map(([k]) => k),
        datasets: [
          {
            data: me.map(([, v]) => v),
            backgroundColor: COLORS.slice(0, me.length),
            borderWidth: 2,
            borderColor: t.card,
            hoverOffset: 8,
          },
        ],
      },
      options: makeChartOptions({
        cutout: "62%",
        legendPos: mlp,
        legendLabels: {
          padding: 10,
          generateLabels: (c) => {
            const meta = c.getDatasetMeta(0);
            return c.data.labels.map((l, i) => ({
              text: `${l}  $${c.data.datasets[0].data[i]}`,
              fillStyle: COLORS[i],
              fontColor: t.leg,
              strokeStyle: "transparent",
              hidden: !!(meta.data[i] && meta.data[i].hidden),
              index: i,
            }));
          },
        },
      }),
    })
  );

  // Stacked daily by developer
  allCharts.push(
    new Chart(document.getElementById("c-stacked"), {
      type: "bar",
      data: {
        labels: D.dates.map(shortDate),
        datasets: D.users.map((u, i) => ({
          label: shortName(u),
          data: D.dates.map((d) => (D.dailyUser[d] || {})[u] || 0),
          backgroundColor: COLORS[i % COLORS.length] + "cc",
          borderRadius: 2,
        })),
      },
      options: makeChartOptions({ stacked: true, yFormat: FMT_DOLLAR }),
    })
  );

  // Hourly stacked
  const hrs = Array.from({ length: 24 }, (_, i) => i);
  allCharts.push(
    new Chart(document.getElementById("c-hourly"), {
      type: "bar",
      data: {
        labels: hrs.map((h) => h.toString().padStart(2, "0") + ":00"),
        datasets: D.users.map((u, i) => ({
          label: shortName(u),
          data: hrs.map((h) => (D.hourlyUser[h] || {})[u] || 0),
          backgroundColor: COLORS[i % COLORS.length] + "cc",
          borderRadius: 2,
        })),
      },
      options: makeChartOptions({ stacked: true, yFormat: FMT_DOLLAR }),
    })
  );

  // Token volume (horizontal)
  allCharts.push(
    new Chart(document.getElementById("c-tokens"), {
      type: "bar",
      data: {
        labels: D.users.map(shortName),
        datasets: [
          {
            data: D.users.map(
              (u) =>
                (D.userCacheWrite[u] || 0) +
                (D.userInputNoCache[u] || 0) +
                (D.userOutput[u] || 0)
            ),
            backgroundColor: D.users.map(
              (_, i) => COLORS[i % COLORS.length] + "aa"
            ),
            borderRadius: 6,
          },
        ],
      },
      options: makeChartOptions({
        hideLegend: true,
        indexAxis: "y",
        yFormat: (v) => fmtK(v),
      }),
    })
  );

  // Cost per request (horizontal)
  allCharts.push(
    new Chart(document.getElementById("c-cpr"), {
      type: "bar",
      data: {
        labels: D.users.map(shortName),
        datasets: [
          {
            data: D.users.map(
              (u) => +(D.userTotal[u] / D.userRequests[u]).toFixed(2)
            ),
            backgroundColor: D.users.map(
              (_, i) => COLORS[i % COLORS.length] + "aa"
            ),
            borderRadius: 6,
          },
        ],
      },
      options: makeChartOptions({
        hideLegend: true,
        indexAxis: "y",
        yFormat: FMT_DOLLAR,
      }),
    })
  );

  // Included vs On-Demand doughnut
  allCharts.push(
    new Chart(document.getElementById("c-kind"), {
      type: "doughnut",
      data: {
        labels: ["Included", "On-Demand"],
        datasets: [
          {
            data: [D.kindSpend["Included"] || 0, D.kindSpend["On-Demand"] || 0],
            backgroundColor: ["#2ed573", "#ff6b6b"],
            borderWidth: 2,
            borderColor: t.card,
          },
        ],
      },
      options: makeChartOptions({ cutout: "62%", legendPos: "bottom" }),
    })
  );
}

// ── Date Range Picker ──
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAYS_SHORT = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const DRP_PRESETS = [
  {
    label: "Today",
    fn: () => {
      const t = new Date();
      return [t, t];
    },
  },
  { label: "7 days", days: 7 },
  { label: "14 days", days: 14 },
  { label: "30 days", days: 30 },
  {
    label: "This month",
    fn: () => {
      const t = new Date();
      return [new Date(t.getFullYear(), t.getMonth(), 1), t];
    },
  },
  {
    label: "Last month",
    fn: () => {
      const t = new Date();
      return [
        new Date(t.getFullYear(), t.getMonth() - 1, 1),
        new Date(t.getFullYear(), t.getMonth(), 0),
      ];
    },
  },
];
let drpStart = null,
  drpEnd = null,
  drpPendStart = null,
  drpPendEnd = null,
  drpSelecting = null,
  drpViewL = new Date(),
  drpHover = null;

function fmtISO(d) {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
function fmtDisplay(d) {
  return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
}
function sameDay(a, b) {
  return (
    a &&
    b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function inRange(d, s, e) {
  if (!s || !e) return false;
  const t = d.getTime(),
    st = Math.min(s.getTime(), e.getTime()),
    en = Math.max(s.getTime(), e.getTime());
  return t >= st && t <= en;
}

function updateDRPText() {
  const el = document.getElementById("drp-text");
  if (drpStart && drpEnd) {
    const days = Math.round((drpEnd - drpStart) / 864e5) + 1;
    el.textContent =
      fmtDisplay(drpStart) + " – " + fmtDisplay(drpEnd) + " (" + days + "d)";
  } else if (drpStart) el.textContent = fmtDisplay(drpStart) + " – ...";
  else el.textContent = "Select dates";
}

function updateFooter() {
  const fr = document.getElementById("drp-footer-range");
  const btn = document.getElementById("drp-apply-btn");
  if (drpPendStart && drpPendEnd) {
    fr.textContent = fmtDisplay(drpPendStart) + " – " + fmtDisplay(drpPendEnd);
    btn.disabled = false;
  } else if (drpPendStart) {
    fr.textContent = fmtDisplay(drpPendStart) + " – select end date";
    btn.disabled = true;
  } else {
    fr.textContent = "Select a date range";
    btn.disabled = true;
  }
}

function toggleDRP() {
  const dd = document.getElementById("drp-dropdown"),
    tr = document.getElementById("drp-trigger");
  const show = !dd.classList.contains("show");
  dd.classList.toggle("show", show);
  tr.classList.toggle("open", show);
  if (show) {
    drpPendStart = drpStart ? new Date(drpStart) : null;
    drpPendEnd = drpEnd ? new Date(drpEnd) : null;
    drpSelecting = null;
    drpHover = null;
    if (drpPendStart)
      drpViewL = new Date(
        drpPendStart.getFullYear(),
        drpPendStart.getMonth(),
        1
      );
    renderDRP();
  }
}
function closeDRP() {
  document.getElementById("drp-dropdown").classList.remove("show");
  document.getElementById("drp-trigger").classList.remove("open");
}
function cancelDRP() {
  closeDRP();
}
function applyDRP() {
  if (!drpPendStart || !drpPendEnd) return;
  drpStart = drpPendStart;
  drpEnd = drpPendEnd;
  updateDRPText();
  closeDRP();
}

function renderDRP() {
  const lMonth = new Date(drpViewL.getFullYear(), drpViewL.getMonth(), 1);
  const rMonth = new Date(lMonth.getFullYear(), lMonth.getMonth() + 1, 1);
  document.getElementById("drp-cal-l").innerHTML = buildCal(lMonth, true);
  document.getElementById("drp-cal-r").innerHTML = buildCal(rMonth, false);
  renderPresets();
  updateFooter();
}

function updateDayClasses() {
  document.querySelectorAll(".drp-day[data-date]").forEach((el) => {
    const date = new Date(el.dataset.date + "T12:00:00");
    const today = new Date();
    const isStart = sameDay(date, drpPendStart);
    const hoverEnd = drpSelecting === "end" ? drpHover : null;
    const effectiveEnd = hoverEnd || drpPendEnd;
    const isEnd =
      sameDay(date, drpPendEnd) || (hoverEnd && sameDay(date, hoverEnd));
    el.classList.toggle("range-start", isStart);
    el.classList.toggle("range-end", (isEnd && !isStart) || (isStart && isEnd));
    el.classList.toggle(
      "in-range",
      !!(
        drpPendStart &&
        effectiveEnd &&
        inRange(date, drpPendStart, effectiveEnd) &&
        !isStart &&
        !isEnd
      )
    );
    el.classList.toggle("today", sameDay(date, today));
  });
}

function buildCal(monthDate, isLeft) {
  const y = monthDate.getFullYear(),
    m = monthDate.getMonth();
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  let html = `<div class="drp-cal-header">
    <button class="drp-nav${isLeft ? "" : " invis"}" data-nav="-1">‹</button>
    <span class="drp-month">${MONTHS[m]} ${y}</span>
    <button class="drp-nav${isLeft ? " invis" : ""}" data-nav="1">›</button>
  </div><div class="drp-weekdays">${DAYS_SHORT.map(
    (d) => "<span>" + d + "</span>"
  ).join("")}</div><div class="drp-days">`;
  for (let i = 0; i < firstDay; i++)
    html += '<div class="drp-day empty"></div>';
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(y, m, d, 12, 0, 0);
    const iso = fmtISO(date);
    const cls = [];
    const isStart = sameDay(date, drpPendStart);
    const hoverEnd = drpSelecting === "end" ? drpHover : null;
    const effectiveEnd = hoverEnd || drpPendEnd;
    const isEnd =
      sameDay(date, drpPendEnd) || (hoverEnd && sameDay(date, hoverEnd));
    if (isStart) cls.push("range-start");
    if (isEnd && !isStart) cls.push("range-end");
    if (isStart && isEnd) cls.push("range-start", "range-end");
    if (
      drpPendStart &&
      effectiveEnd &&
      inRange(date, drpPendStart, effectiveEnd) &&
      !isStart &&
      !isEnd
    )
      cls.push("in-range");
    if (sameDay(date, today)) cls.push("today");
    html += `<div class="drp-day ${cls.join(
      " "
    )}" data-date="${iso}">${d}</div>`;
  }
  html += "</div>";
  return html;
}

// DRP event delegation
document.getElementById("drp-dropdown").addEventListener("click", (e) => {
  e.stopPropagation();
  const day = e.target.closest(".drp-day[data-date]");
  if (day) {
    drpClick(day.dataset.date);
    return;
  }
  const nav = e.target.closest(".drp-nav[data-nav]");
  if (nav) {
    drpNav(parseInt(nav.dataset.nav));
    return;
  }
  const preset = e.target.closest(".drp-preset[data-preset]");
  if (preset) {
    applyPreset(parseInt(preset.dataset.preset));
    return;
  }
});
document.getElementById("drp-dropdown").addEventListener("mouseover", (e) => {
  const day = e.target.closest(".drp-day[data-date]");
  if (day && drpSelecting === "end") {
    drpHover = new Date(day.dataset.date + "T12:00:00");
    updateDayClasses();
    updateFooter();
  }
});

function drpNav(dir) {
  drpViewL.setMonth(drpViewL.getMonth() + dir);
  renderDRP();
}

function drpClick(iso) {
  const d = new Date(iso + "T12:00:00");
  if (!drpPendStart || drpSelecting !== "end") {
    drpPendStart = d;
    drpPendEnd = null;
    drpSelecting = "end";
    drpHover = null;
  } else {
    if (d < drpPendStart) {
      drpPendEnd = drpPendStart;
      drpPendStart = d;
    } else drpPendEnd = d;
    drpSelecting = null;
    drpHover = null;
  }
  renderDRP();
}

function renderPresets() {
  const today = new Date();
  document.getElementById("drp-presets").innerHTML = DRP_PRESETS.map((p, i) => {
    let active = false;
    if (p.days && drpPendStart && drpPendEnd) {
      const ago = new Date(today);
      ago.setDate(today.getDate() - p.days + 1);
      active = sameDay(drpPendStart, ago) && sameDay(drpPendEnd, today);
    }
    return `<button class="drp-preset ${
      active ? "active" : ""
    }" data-preset="${i}">${p.label}</button>`;
  }).join("");
}

function applyPreset(i) {
  const p = DRP_PRESETS[i],
    today = new Date();
  const noon = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  if (p.fn) {
    const [s, e] = p.fn();
    drpPendStart = noon(s);
    drpPendEnd = noon(e);
  } else {
    const ago = new Date(today);
    ago.setDate(today.getDate() - p.days + 1);
    drpPendStart = noon(ago);
    drpPendEnd = noon(today);
  }
  drpSelecting = null;
  drpHover = null;
  drpViewL = new Date(drpPendStart.getFullYear(), drpPendStart.getMonth(), 1);
  renderDRP();
}

// Init picker dates
(function () {
  const now = new Date();
  drpStart = new Date(now.getFullYear(), now.getMonth(), 1, 12);
  drpEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  drpViewL = new Date(drpStart.getFullYear(), drpStart.getMonth(), 1);
  updateDRPText();
})();

// ── Empty state ──
function showLoader() {
  document.getElementById("toolbar").style.display = "none";
  const drp = document.getElementById("drp");
  if (drp) {
    drp.style.display = "none";
    document.body.appendChild(drp);
  }
  document.getElementById("dashboard").innerHTML = `
  <div class="empty-state">
    <div class="loader-spinner"></div>
    <p style="margin-top:18px;color:var(--text2);font-size:15px">Loading report…</p>
  </div>`;
}

function showEmptyState() {
  document.getElementById("toolbar").style.display = "none";
  document.getElementById("dashboard").innerHTML = `
  <div class="empty-state">
    <div class="empty-icon">📊</div>
    <h2>No data loaded</h2>
    <p>Select a date range and click <strong>Fetch Report</strong>, or drag a Cursor CSV onto this page.</p>
    <div id="drp-empty-slot" style="margin-bottom:20px"></div>
    <div class="empty-actions">
      <button class="btn" id="empty-fetch-btn">↓ Fetch Report</button>
      <button class="btn sec" id="empty-csv-btn">📂 Load CSV</button>
    </div>
  </div>`;
  const drp = document.getElementById("drp");
  drp.style.display = "";
  document.getElementById("drp-empty-slot").appendChild(drp);
}

// ── Timezone init helper ──
function initTimezoneSelect(savedTz) {
  const sel = document.getElementById("tz-select");
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Ensure the browser's timezone is in the list
  if (browserTz && !sel.querySelector(`option[value="${browserTz}"]`)) {
    const opt = document.createElement("option");
    opt.value = browserTz;
    opt.textContent = "🌐 " + browserTz.split("/").pop().replace(/_/g, " ") + " (Local)";
    sel.insertBefore(opt, sel.firstChild);
  }
  // Apply saved or browser-default timezone
  const tz = savedTz || browserTz || "UTC";
  if (!sel.querySelector(`option[value="${tz}"]`)) {
    const opt = document.createElement("option");
    opt.value = tz;
    opt.textContent = "🌐 " + tz.split("/").pop().replace(/_/g, " ");
    sel.insertBefore(opt, sel.firstChild);
  }
  sel.value = tz;
  currentTimezone = tz;
}

// ── Share Snapshot (self-contained HTML export) ──
async function exportSnapshot() {
  if (!D) { toast("No data to export"); return; }

  // 1. Fetch Chart.js source
  let chartJsSrc;
  try {
    const url = (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
      ? chrome.runtime.getURL("chart.umd.min.js")
      : "chart.umd.min.js";
    chartJsSrc = await fetch(url).then(r => r.text());
  } catch (e) {
    toast("Could not load Chart.js for snapshot");
    console.error(e);
    return;
  }

  // 2. Extract CSS
  const cssText = document.querySelector("style").textContent;

  // 3. Serialize data
  const snapshotData = JSON.stringify(D);
  const currentTheme = isDark() ? "dark" : "light";
  const tzLbl = tzLabel(currentTimezone);
  const genDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

  // 4. Escape Chart.js for embedding in <script>
  const safeChartJs = chartJsSrc.replace(/<\/script>/gi, "<\\/script>");

  // 5. Build self-contained HTML
  const html = `<!DOCTYPE html>
<html lang="en" data-theme="${currentTheme}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Cursor Spend Snapshot — ${D.dateRange}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${cssText}
.snapshot-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--text3);background:var(--surface2);padding:4px 12px;border-radius:6px;border:1px solid var(--border);margin-left:12px;font-family:'JetBrains Mono',monospace}
</style>
<script>${safeChartJs}<\/script>
</head>
<body>
<div class="header">
  <div>
    <h1>Cursor Spend Dashboard</h1>
    <div class="meta" id="header-meta"></div>
  </div>
  <div style="display:flex;align-items:center;gap:12px">
    <span class="snapshot-badge">Shared snapshot · ${genDate}</span>
    <button class="theme-toggle" id="theme-toggle-btn"><span id="theme-icon"></span> <span id="theme-label"></span></button>
  </div>
</div>
<div id="dashboard"></div>
<div class="modal-overlay" id="modal-overlay">
  <div class="modal" id="modal-content"></div>
</div>
<div class="toast" id="toast"></div>
<script>
"use strict";
var D = ${snapshotData};
var SNAPSHOT_TZ = ${JSON.stringify(tzLbl)};
var allCharts = [];
var modalCharts = [];

var COLORS = ${JSON.stringify(COLORS)};
var shortName = function(u) { return u.split("@")[0]; };
var fmt = function(n) { return "$" + n.toFixed(2); };
var fmtK = function(n) {
  return n >= 1e9 ? (n / 1e9).toFixed(1) + "B"
       : n >= 1e6 ? (n / 1e6).toFixed(1) + "M"
       : n >= 1e3 ? (n / 1e3).toFixed(0) + "K"
       : n;
};
var shortDate = function(d) { var p = d.split("-"); return p[1] + "/" + p[2]; };

function isDark() {
  var t = document.documentElement.getAttribute("data-theme");
  if (t) return t === "dark";
  return window.matchMedia("(prefers-color-scheme:dark)").matches;
}
function TC() {
  var dk = isDark();
  return {
    leg: dk ? "#b0b4c8" : "#3a3f5c",
    ax: dk ? "#6b7094" : "#6b7094",
    gr: dk ? "rgba(42,47,68,.5)" : "rgba(0,0,0,.07)",
    ho: dk ? "#2a2f44" : "#e2e4ea",
    card: dk ? "#1e1e2e" : "#ffffff"
  };
}
function toggleTheme() {
  var c = document.documentElement.getAttribute("data-theme"),
      s = window.matchMedia("(prefers-color-scheme:dark)").matches;
  document.documentElement.setAttribute("data-theme",
    !c ? (s ? "light" : "dark") : c === "dark" ? "light" : "dark");
  updBtn();
  rebuildCharts();
  modalCharts.forEach(function(c) { c.destroy(); });
  modalCharts.length = 0;
}
function updBtn() {
  var dk = isDark();
  document.getElementById("theme-icon").textContent = dk ? "☀️" : "🌙";
  document.getElementById("theme-label").textContent = dk ? "Light" : "Dark";
}

var FMT_DOLLAR = function(v) { return "$" + Math.round(v * 100) / 100; };
var FMT_INT = function(v) { return Math.round(v); };

function makeChartOptions(cfg) {
  cfg = cfg || {};
  var t = TC();
  var ax = {
    ticks: { color: t.ax, font: { family: "JetBrains Mono", size: 10 } },
    grid: { color: t.gr },
    border: { color: "transparent" }
  };
  var opts = { responsive: true, maintainAspectRatio: false, plugins: {} };
  if (cfg.hideLegend) {
    opts.plugins.legend = { display: false };
  } else {
    opts.plugins.legend = {
      position: cfg.legendPos || "top",
      labels: Object.assign({ color: t.leg, font: { family: "DM Sans", size: 11 }, boxWidth: 12, padding: 16 }, cfg.legendLabels || {})
    };
  }
  if (cfg.cutout) { opts.cutout = cfg.cutout; return opts; }
  var tickFmt = function(f) { return f ? Object.assign({}, ax.ticks, { callback: f }) : ax.ticks; };
  var xAx = Object.assign({}, ax, { stacked: !!cfg.stacked, ticks: tickFmt(cfg.xFormat) });
  var yAx = Object.assign({}, ax, { stacked: !!cfg.stacked, ticks: tickFmt(cfg.yFormat) });
  if (cfg.indexAxis === "y") {
    opts.indexAxis = "y";
    opts.scales = { x: Object.assign({}, ax, { ticks: tickFmt(cfg.yFormat) }), y: ax };
  } else {
    opts.scales = { x: xAx, y: yAx };
  }
  return opts;
}

function renderSnapshot() {
  var totalTk = D.users.reduce(function(s, u) {
    return s + (D.userCacheWrite[u] || 0) + (D.userInputNoCache[u] || 0) + (D.userOutput[u] || 0);
  }, 0);
  var calDays = D.dates.length
    ? Math.round((new Date(D.dates[D.dates.length - 1] + "T12:00:00") - new Date(D.dates[0] + "T12:00:00")) / 864e5) + 1
    : 0;

  document.getElementById("header-meta").textContent =
    "tuvis.com team · " + D.dateRange + " · " + calDays + " days · " + D.totalRequests.toLocaleString() + " requests · " + fmtK(totalTk) + " tokens";

  document.getElementById("dashboard").innerHTML =
    '<div class="grid">' +
    '<div class="kpi-row" id="kpis"></div>' +
    '<div class="card full"><h3>Developer Breakdown</h3><div class="table-wrap"><table id="t-users"></table></div></div>' +
    '<div class="card full"><h3>Model Usage per Developer</h3><div class="table-wrap"><table id="t-models"></table></div></div>' +
    '<div class="chart-row">' +
      '<div class="card"><h3>Daily Spend Trend</h3><div style="height:300px"><canvas id="c-daily"></canvas></div></div>' +
      '<div class="card"><h3>Spend by Model</h3><div style="height:300px"><canvas id="c-model"></canvas></div></div>' +
    '</div>' +
    '<div class="chart-row">' +
      '<div class="card"><h3>Daily Spend by Developer (Stacked)</h3><div style="height:300px"><canvas id="c-stacked"></canvas></div></div>' +
      '<div class="card"><h3>Activity by Hour (' + SNAPSHOT_TZ + ')</h3><div style="height:300px"><canvas id="c-hourly"></canvas></div></div>' +
    '</div>' +
    '<div class="chart-row triple">' +
      '<div class="card"><h3>Token Volume</h3><div style="height:280px"><canvas id="c-tokens"></canvas></div></div>' +
      '<div class="card"><h3>Cost per Request</h3><div style="height:280px"><canvas id="c-cpr"></canvas></div></div>' +
      '<div class="card"><h3>Included vs On-Demand</h3><div style="height:280px"><canvas id="c-kind"></canvas></div></div>' +
    '</div>' +
    '</div>';

  // KPIs
  var avg = D.totalSpend / calDays;
  var top = D.users[0];
  var peakEntries = Object.entries(D.dailyTotal).sort(function(a, b) { return b[1] - a[1]; });
  var peak = peakEntries[0];
  var odPct = D.totalSpend > 0 ? (((D.kindSpend["On-Demand"] || 0) / D.totalSpend) * 100).toFixed(0) : "0";
  var kpis = [
    { l: "Total Spend", v: fmt(D.totalSpend), s: calDays + " day period", icon: "💰", color: "#6c5ce7", grad: "linear-gradient(90deg,#6c5ce7,#a29bfe)" },
    { l: "Daily Average", v: fmt(avg), s: fmt(avg * 30) + "/mo projected", icon: "📊", color: "#48dbfb", grad: "linear-gradient(90deg,#48dbfb,#0abde3)" },
    { l: "Top Spender", v: shortName(top), s: fmt(D.userTotal[top]) + " (" + ((D.userTotal[top] / D.totalSpend) * 100).toFixed(0) + "%)", icon: "👤", color: "#feca57", grad: "linear-gradient(90deg,#feca57,#ff9f43)" },
    { l: "Peak Day", v: fmt(peak[1]), s: shortDate(peak[0]), icon: "🔥", color: "#ff6b6b", grad: "linear-gradient(90deg,#ff6b6b,#ee5a24)" },
    { l: "Avg Cost/Request", v: fmt(D.totalSpend / D.totalRequests), s: D.totalRequests.toLocaleString() + " total", icon: "⚡", color: "#a29bfe", grad: "linear-gradient(90deg,#a29bfe,#6c5ce7)" },
    { l: "On-Demand", v: odPct + "%", s: fmt(D.kindSpend["On-Demand"] || 0) + " of total", icon: "🔄", color: "#2ed573", grad: "linear-gradient(90deg,#2ed573,#48dbfb)" }
  ];
  document.getElementById("kpis").innerHTML = kpis.map(function(k) {
    return '<div class="kpi" style="--kpi-color:' + k.color + ';--kpi-grad:' + k.grad + ';--kpi-glow:' + k.color + '15;--kpi-icon-bg:' + k.color + '18;--kpi-icon-bg-hover:' + k.color + '28"><div class="kpi-header"><div class="label">' + k.l + '</div><div class="kpi-icon">' + k.icon + '</div></div><div class="value">' + k.v + '</div><div class="sub">' + k.s + '</div></div>';
  }).join("");

  // Tables
  renderSnapshotTables();

  // Charts
  rebuildCharts();
}

function renderSnapshotTables() {
  var mx = Math.max.apply(null, D.users.map(function(u) { return D.userTotal[u]; }));
  document.getElementById("t-users").innerHTML =
    '<thead><tr><th>Developer</th><th>Total Spend</th><th style="width:30%">Share</th><th>Requests</th><th>$/Request</th><th>Tokens</th><th>Cache Hit</th></tr></thead>' +
    '<tbody>' + D.users.map(function(u, i) {
      var ci = i % COLORS.length;
      var pct = ((D.userTotal[u] / D.totalSpend) * 100).toFixed(1);
      var cpr = (D.userTotal[u] / D.userRequests[u]).toFixed(2);
      var cr = D.userCacheRead[u] || 0, cw = D.userCacheWrite[u] || 0, nc = D.userInputNoCache[u] || 0;
      var tot = cr + cw + nc, hit = tot > 0 ? ((cr / tot) * 100).toFixed(0) : 0;
      return '<tr>' +
        '<td><span class="user-name" style="color:' + COLORS[ci] + '" data-drilldown="' + u + '">' + shortName(u) + '</span><br><span class="user-email">' + u + '</span></td>' +
        '<td class="mono" style="font-weight:600">' + fmt(D.userTotal[u]) + '</td>' +
        '<td><div class="bar-cell"><span class="mono" style="min-width:42px">' + pct + '%</span><div class="bar-bg"><div class="bar-fill" style="width:' + (D.userTotal[u] / mx * 100) + '%;background:' + COLORS[ci] + '"></div></div></div></td>' +
        '<td class="mono">' + D.userRequests[u] + '</td>' +
        '<td class="mono">' + fmt(parseFloat(cpr)) + '</td>' +
        '<td class="mono">' + fmtK((D.userCacheWrite[u] || 0) + (D.userInputNoCache[u] || 0) + (D.userOutput[u] || 0)) + '</td>' +
        '<td class="mono">' + hit + '%</td></tr>';
    }).join("") + '</tbody>';

  var allM = [];
  D.users.forEach(function(u) { Object.keys(D.userModel[u] || {}).forEach(function(m) { if (allM.indexOf(m) === -1) allM.push(m); }); });
  var mOrd = Object.entries(D.modelSpend).sort(function(a, b) { return b[1] - a[1]; }).map(function(e) { return e[0]; }).filter(function(m) { return allM.indexOf(m) !== -1; });
  var sM = function(m) { return m.replace("claude-4.6-", "c46-").replace("claude-4.5-", "c45-").replace("medium-thinking", "med-think").replace("high-thinking", "hi-think").replace("premium ", ""); };
  document.getElementById("t-models").innerHTML =
    '<thead><tr><th>Developer</th>' + mOrd.map(function(m) { return '<th style="font-size:10px">' + sM(m) + '</th>'; }).join("") + '<th>Primary</th></tr></thead>' +
    '<tbody>' + D.users.map(function(u, i) {
      var um = D.userModel[u] || {}, ci = i % COLORS.length;
      var pr = Object.entries(um).sort(function(a, b) { return b[1] - a[1]; })[0];
      return '<tr><td><span style="color:' + COLORS[ci] + ';font-weight:600;cursor:pointer" data-drilldown="' + u + '">' + shortName(u) + '</span></td>' +
        mOrd.map(function(m) {
          var v = um[m] || 0;
          var bg = v > 0
            ? 'rgba(' + parseInt(COLORS[ci].slice(1,3),16) + ',' + parseInt(COLORS[ci].slice(3,5),16) + ',' + parseInt(COLORS[ci].slice(5,7),16) + ',' + (Math.min(v/50, 0.5) + 0.05) + ')'
            : 'transparent';
          return '<td class="mono" style="background:' + bg + ';text-align:center;font-size:11px">' + (v > 0 ? '$' + v.toFixed(0) : '—') + '</td>';
        }).join("") +
        '<td style="font-size:12px;font-weight:500">' + (pr ? pr[0] : '—') + '</td></tr>';
    }).join("") + '</tbody>';
}

function rebuildCharts() {
  allCharts.forEach(function(c) { c.destroy(); });
  allCharts.length = 0;
  var t = TC();

  allCharts.push(new Chart(document.getElementById("c-daily"), {
    type: "line",
    data: { labels: D.dates.map(shortDate), datasets: [{ data: D.dates.map(function(d) { return D.dailyTotal[d]; }), borderColor: "#6c5ce7", backgroundColor: "rgba(108,92,231,.1)", fill: true, tension: 0.3, borderWidth: 2.5, pointRadius: 4, pointBackgroundColor: "#6c5ce7" }] },
    options: makeChartOptions({ hideLegend: true, yFormat: FMT_DOLLAR })
  }));

  var me = Object.entries(D.modelSpend).filter(function(e) { return e[1] > 0; }).slice(0, 8);
  var mlp = window.innerWidth > 1200 ? "right" : "bottom";
  allCharts.push(new Chart(document.getElementById("c-model"), {
    type: "doughnut",
    data: { labels: me.map(function(e) { return e[0]; }), datasets: [{ data: me.map(function(e) { return e[1]; }), backgroundColor: COLORS.slice(0, me.length), borderWidth: 2, borderColor: t.card, hoverOffset: 8 }] },
    options: makeChartOptions({ cutout: "62%", legendPos: mlp, legendLabels: { padding: 10, generateLabels: function(c) {
      var meta = c.getDatasetMeta(0);
      return c.data.labels.map(function(l, i) { return { text: l + "  $" + c.data.datasets[0].data[i], fillStyle: COLORS[i], fontColor: t.leg, strokeStyle: "transparent", hidden: !!(meta.data[i] && meta.data[i].hidden), index: i }; });
    }}})
  }));

  allCharts.push(new Chart(document.getElementById("c-stacked"), {
    type: "bar",
    data: { labels: D.dates.map(shortDate), datasets: D.users.map(function(u, i) { return { label: shortName(u), data: D.dates.map(function(d) { return (D.dailyUser[d] || {})[u] || 0; }), backgroundColor: COLORS[i % COLORS.length] + "cc", borderRadius: 2 }; }) },
    options: makeChartOptions({ stacked: true, yFormat: FMT_DOLLAR })
  }));

  var hrs = Array.from({ length: 24 }, function(_, i) { return i; });
  allCharts.push(new Chart(document.getElementById("c-hourly"), {
    type: "bar",
    data: { labels: hrs.map(function(h) { return h.toString().padStart(2, "0") + ":00"; }), datasets: D.users.map(function(u, i) { return { label: shortName(u), data: hrs.map(function(h) { return (D.hourlyUser[h] || {})[u] || 0; }), backgroundColor: COLORS[i % COLORS.length] + "cc", borderRadius: 2 }; }) },
    options: makeChartOptions({ stacked: true, yFormat: FMT_DOLLAR })
  }));

  allCharts.push(new Chart(document.getElementById("c-tokens"), {
    type: "bar",
    data: { labels: D.users.map(shortName), datasets: [{ data: D.users.map(function(u) { return (D.userCacheWrite[u] || 0) + (D.userInputNoCache[u] || 0) + (D.userOutput[u] || 0); }), backgroundColor: D.users.map(function(_, i) { return COLORS[i % COLORS.length] + "aa"; }), borderRadius: 6 }] },
    options: makeChartOptions({ hideLegend: true, indexAxis: "y", yFormat: function(v) { return fmtK(v); } })
  }));

  allCharts.push(new Chart(document.getElementById("c-cpr"), {
    type: "bar",
    data: { labels: D.users.map(shortName), datasets: [{ data: D.users.map(function(u) { return +(D.userTotal[u] / D.userRequests[u]).toFixed(2); }), backgroundColor: D.users.map(function(_, i) { return COLORS[i % COLORS.length] + "aa"; }), borderRadius: 6 }] },
    options: makeChartOptions({ hideLegend: true, indexAxis: "y", yFormat: FMT_DOLLAR })
  }));

  allCharts.push(new Chart(document.getElementById("c-kind"), {
    type: "doughnut",
    data: { labels: ["Included", "On-Demand"], datasets: [{ data: [D.kindSpend["Included"] || 0, D.kindSpend["On-Demand"] || 0], backgroundColor: ["#2ed573", "#ff6b6b"], borderWidth: 2, borderColor: t.card }] },
    options: makeChartOptions({ cutout: "62%", legendPos: "bottom" })
  }));
}

function showDrilldown(user) {
  var ci = D.users.indexOf(user) % COLORS.length;
  var color = COLORS[ci];
  var um = D.userModel[user] || {};
  var cr = D.userCacheRead[user] || 0, cw = D.userCacheWrite[user] || 0, nc = D.userInputNoCache[user] || 0;
  var tot = cr + cw + nc, hit = tot > 0 ? ((cr / tot) * 100).toFixed(0) : 0;
  var cpr = (D.userTotal[user] / D.userRequests[user]).toFixed(2);
  var pct = ((D.userTotal[user] / D.totalSpend) * 100).toFixed(1);
  var uk = D.userKind[user] || {};
  var odPct = D.userTotal[user] > 0 ? (((uk["On-Demand"] || 0) / D.userTotal[user]) * 100).toFixed(0) : "0";
  var modalCalDays = D.dates.length ? Math.round((new Date(D.dates[D.dates.length-1]+"T12:00:00") - new Date(D.dates[0]+"T12:00:00"))/864e5)+1 : 0;
  var dailyAvg = modalCalDays > 0 ? D.userTotal[user] / modalCalDays : 0;

  document.getElementById("modal-content").innerHTML =
    '<button class="modal-close">✕</button>' +
    '<div style="display:flex;align-items:center;margin-bottom:24px;margin-top:8px"><div>' +
    '<h2 style="color:' + color + '">' + shortName(user) + '</h2>' +
    '<div class="modal-sub" style="margin-bottom:0">' + user + ' · ' + pct + '% of team spend</div></div></div>' +
    '<div class="modal-stats">' +
      '<div class="modal-stat"><div class="label">Total Spend</div><div class="val">' + fmt(D.userTotal[user]) + '</div></div>' +
      '<div class="modal-stat"><div class="label">Requests</div><div class="val">' + D.userRequests[user].toLocaleString() + '</div></div>' +
      '<div class="modal-stat"><div class="label">$/Request</div><div class="val">' + fmt(parseFloat(cpr)) + '</div></div>' +
      '<div class="modal-stat"><div class="label">Cache Hit</div><div class="val">' + hit + '%</div></div>' +
    '</div>' +
    '<div class="modal-stats" style="margin-top:8px">' +
      '<div class="modal-stat"><div class="label">Daily Average</div><div class="val">' + fmt(dailyAvg) + '</div></div>' +
      '<div class="modal-stat"><div class="label">Total Tokens</div><div class="val">' + fmtK(cw + nc + (D.userOutput[user] || 0)) + '</div></div>' +
      '<div class="modal-stat"><div class="label">Output Tokens</div><div class="val">' + fmtK(D.userOutput[user]) + '</div></div>' +
      '<div class="modal-stat"><div class="label">On-Demand</div><div class="val">' + odPct + '%</div></div>' +
    '</div>' +
    '<div class="modal-charts">' +
      '<div class="modal-card"><h4>Daily Spend</h4><div style="height:200px"><canvas id="mc-daily"></canvas></div></div>' +
      '<div class="modal-card"><h4>Model Mix</h4><div style="height:200px"><canvas id="mc-model"></canvas></div></div>' +
    '</div>' +
    '<div class="modal-charts" style="margin-top:8px">' +
      '<div class="modal-card"><h4>Activity by Hour (' + SNAPSHOT_TZ + ')</h4><div style="height:200px"><canvas id="mc-hourly"></canvas></div></div>' +
      '<div class="modal-card"><h4>Daily Requests</h4><div style="height:200px"><canvas id="mc-requests"></canvas></div></div>' +
    '</div>';

  document.getElementById("modal-overlay").classList.add("show");
  document.body.style.overflow = "hidden";

  setTimeout(function() {
    modalCharts.forEach(function(c) { c.destroy(); });
    modalCharts.length = 0;

    modalCharts.push(new Chart(document.getElementById("mc-daily"), {
      type: "bar",
      data: { labels: D.dates.map(shortDate), datasets: [{ data: D.dates.map(function(d) { return (D.dailyUser[d] || {})[user] || 0; }), backgroundColor: color + "cc", borderRadius: 4 }] },
      options: makeChartOptions({ hideLegend: true, yFormat: FMT_DOLLAR })
    }));

    var me = Object.entries(um).filter(function(e) { return e[1] > 0; });
    modalCharts.push(new Chart(document.getElementById("mc-model"), {
      type: "doughnut",
      data: { labels: me.map(function(e) { return e[0]; }), datasets: [{ data: me.map(function(e) { return e[1]; }), backgroundColor: COLORS.slice(0, me.length), borderWidth: 2, borderColor: TC().card }] },
      options: makeChartOptions({ cutout: "58%", legendPos: "bottom", legendLabels: { font: { family: "DM Sans", size: 10 }, boxWidth: 10, padding: 8 } })
    }));

    var hrs = Array.from({ length: 24 }, function(_, i) { return i; });
    var uHourly = D.userHourly[user] || {};
    modalCharts.push(new Chart(document.getElementById("mc-hourly"), {
      type: "bar",
      data: { labels: hrs.map(function(h) { return h.toString().padStart(2, "0") + ":00"; }), datasets: [{ data: hrs.map(function(h) { return uHourly[h] || 0; }), backgroundColor: color + "aa", borderRadius: 3 }] },
      options: makeChartOptions({ hideLegend: true, yFormat: FMT_DOLLAR })
    }));

    var udr = D.userDailyRequests[user] || {};
    modalCharts.push(new Chart(document.getElementById("mc-requests"), {
      type: "bar",
      data: { labels: D.dates.map(shortDate), datasets: [{ data: D.dates.map(function(d) { return udr[d] || 0; }), backgroundColor: color + "88", borderRadius: 4 }] },
      options: makeChartOptions({ hideLegend: true, yFormat: FMT_INT })
    }));
  }, 50);
}

// Event delegation
document.addEventListener("click", function(e) {
  var drillEl = e.target.closest("[data-drilldown]");
  if (drillEl) { showDrilldown(drillEl.dataset.drilldown); return; }
  if (e.target.closest(".modal-close")) {
    document.getElementById("modal-overlay").classList.remove("show");
    document.body.style.overflow = "";
    modalCharts.forEach(function(c) { c.destroy(); });
    modalCharts.length = 0;
  }
});
document.addEventListener("keydown", function(e) {
  if (e.key === "Escape") {
    document.getElementById("modal-overlay").classList.remove("show");
    document.body.style.overflow = "";
    modalCharts.forEach(function(c) { c.destroy(); });
    modalCharts.length = 0;
  }
});
document.getElementById("theme-toggle-btn").addEventListener("click", toggleTheme);

// Resize handler
var rzt;
window.addEventListener("resize", function() {
  clearTimeout(rzt);
  rzt = setTimeout(function() { rebuildCharts(); }, 250);
});

// Boot
updBtn();
renderSnapshot();
<\/script>
</body>
</html>`;

  // 6. Trigger download
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "cursor-spend-snapshot-" + D.dateRange.replace(/ to /g, "-").replace(/\s/g, "") + ".html";
  a.click();
  URL.revokeObjectURL(url);
  toast("Snapshot exported!");
}

// ── Boot — check chrome.storage for CSV data from content script ──
(async function boot() {
  showLoader();
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    try {
      const data = await chrome.storage.local.get([
        "cursorCsvData",
        "cursorCsvUrl",
        "cursorCsvTimestamp",
        "cursorTimezone",
        "cursorTeamId",
      ]);
      TEAM_ID = data.cursorTeamId || null;
      initTimezoneSelect(data.cursorTimezone);
      if (data.cursorCsvData) {
        rawRows = parseCSV(data.cursorCsvData);
        if (rawRows.length) {
          fullAggregate = null; selectedDevs = new Set();
          D = aggregate(rawRows);
          toast(
            `Loaded ${rawRows.length.toLocaleString()} rows · ${
              D.users.length
            } developers`
          );
          hideUploadPrompt();
          buildDevFilter();
          renderDashboard();
          return;
        }
      }
      if (data.cursorCsvUrl) {
        try {
          const res = await fetch(data.cursorCsvUrl, {
            credentials: "include",
          });
          if (res.ok) {
            const text = await res.text();
            if (text.includes(",") && !text.includes("<!DOCTYPE")) {
              rawRows = parseCSV(text);
              if (rawRows.length) {
                fullAggregate = null; selectedDevs = new Set();
                D = aggregate(rawRows);
                toast(
                  `Fetched ${rawRows.length.toLocaleString()} rows · ${
                    D.users.length
                  } developers`
                );
                hideUploadPrompt();
                buildDevFilter();
                renderDashboard();
                return;
              }
            }
          }
        } catch (e) {
          /* fall through */
        }
      }
    } catch (e) {
      console.warn("[CSD] Could not read chrome.storage:", e);
    }
  } else {
    initTimezoneSelect(null);
  }
  showEmptyState();
})();
