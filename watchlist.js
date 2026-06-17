
const tbody = document.querySelector("#watchlist tbody");
const watchlistTable = document.getElementById("watchlist");
const groupedView = document.getElementById("groupedView");
const refreshBtn = document.getElementById("refreshBtn");
const lastUpdated = document.getElementById("lastUpdated");
const headers = document.querySelectorAll("#watchlist th[data-sort]");

let companies = [];
let lastData = [];
let sortKey = null;
let sortDir = "asc";
let scores = {}; // symbol -> "Hold" | "Watch" | "Reevaluate" | "No data"
let viewMode = "table"; // "table" | "grouped"
let privateSymbols = new Set(); // companies with no public market data (e.g. SpaceX)

const EVAL_CLASS = {
  "Hold": "eval-hold",
  "Watch": "eval-watch",
  "Reevaluate": "eval-reevaluate",
  "Private": "eval-private",
};

// Status panels, ordered so the ones needing attention come first.
const STATUS_GROUPS = [
  { key: "Reevaluate", cls: "badge-reevaluate" },
  { key: "Watch", cls: "badge-watch" },
  { key: "Hold", cls: "badge-hold" },
  { key: "No data", cls: "badge-unknown" },
  { key: "Private", cls: "badge-unknown" },
];

const COLS_HEADER = `
  <tr>
    <th>Company</th><th>Ticker</th><th>Price</th><th>Ext. Hours</th>
    <th>Ext. Change</th><th>Change</th><th>% Change</th><th>Session</th><th>Volume</th>
  </tr>`;

function statusOf(symbol) {
  if (privateSymbols.has(symbol)) return "Private";
  return scores[symbol] || "No data";
}

function sortRows(rows) {
  const r = [...rows];
  if (sortKey) {
    r.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }
  return r;
}

function rowHtml(stock) {
  if (stock.private) {
    const evalClass = EVAL_CLASS[statusOf(stock.symbol)] || "";
    const safeName = String(stock.name).replace(/"/g, "&quot;");
    return `
      <tr data-symbol="${stock.symbol}" data-name="${safeName}">
        <td class="company-name ${evalClass}">${stock.name}</td>
        <td>${stock.symbol}</td>
        <td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>
        <td>Private</td><td>—</td>
      </tr>`;
  }

  const changeClass =
    stock.change > 0 ? "positive" :
    stock.change < 0 ? "negative" : "neutral";

  const cur = stock.currency;
  const ahPrice = stock.afterHoursPrice;
  const ahChange = stock.afterHoursChange;

  const ahPriceClass = ahPrice === null ? "" : ahPrice > stock.price ? "positive" : ahPrice < stock.price ? "negative" : "neutral";
  const ahChangeClass = ahChange === null ? "" : ahChange > 0 ? "positive" : ahChange < 0 ? "negative" : "neutral";

  const ahPriceDisplay = ahPrice !== null ? `${ahPrice.toFixed(2)} <span class="currency">${cur}</span>` : "-";
  const ahChangeDisplay = ahChange !== null ? `${ahChange > 0 ? "+" : ""}${ahChange.toFixed(2)}` : "-";

  const evalClass = EVAL_CLASS[statusOf(stock.symbol)] || "";
  const safeName = String(stock.name).replace(/"/g, "&quot;");

  return `
    <tr data-symbol="${stock.symbol}" data-name="${safeName}">
      <td class="company-name ${evalClass}">${stock.name}</td>
      <td>${stock.symbol}</td>
      <td>${stock.price.toFixed(2)} <span class="currency">${cur}</span></td>
      <td class="${ahPriceClass}">${ahPriceDisplay}</td>
      <td class="${ahChangeClass}">${ahChangeDisplay}</td>
      <td class="${changeClass}">${stock.change.toFixed(2)}</td>
      <td class="${changeClass}">${stock.changePct.toFixed(2)}%</td>
      <td>${stock.session}</td>
      <td>${stock.volume.toLocaleString()}</td>
    </tr>`;
}

function renderFlat() {
  tbody.innerHTML = sortRows(lastData).map(rowHtml).join("");
  headers.forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sortKey) {
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

function renderGrouped() {
  const rows = sortRows(lastData);
  groupedView.innerHTML = STATUS_GROUPS.map(g => {
    const items = rows.filter(s => statusOf(s.symbol) === g.key);
    const table = items.length
      ? `<table>${COLS_HEADER}<tbody>${items.map(rowHtml).join("")}</tbody></table>`
      : `<p class="group-empty">None</p>`;
    return `
      <section class="group-panel">
        <div class="group-head">
          <span class="badge ${g.cls}">${g.key}</span>
          <span class="group-count">${items.length}</span>
        </div>
        ${table}
      </section>`;
  }).join("");
}

function render() {
  if (viewMode === "grouped") {
    watchlistTable.classList.add("hidden");
    groupedView.classList.remove("hidden");
    renderGrouped();
  } else {
    groupedView.classList.add("hidden");
    watchlistTable.classList.remove("hidden");
    renderFlat();
  }
}

// Row clicks (delegated, works for both the flat table and grouped panels).
function handleRowClick(e) {
  const tr = e.target.closest("tr[data-symbol]");
  if (tr) openPanel(tr.dataset.symbol, tr.dataset.name);
}
tbody.addEventListener("click", handleRowClick);
groupedView.addEventListener("click", handleRowClick);

headers.forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "asc";
    }
    render();
  });
});

// View toggle
const viewTableBtn = document.getElementById("viewTable");
const viewGroupedBtn = document.getElementById("viewGrouped");
function setView(mode) {
  viewMode = mode;
  viewTableBtn.classList.toggle("active", mode === "table");
  viewGroupedBtn.classList.toggle("active", mode === "grouped");
  render();
}
viewTableBtn.addEventListener("click", () => setView("table"));
viewGroupedBtn.addEventListener("click", () => setView("grouped"));

async function fetchQuotes() {
  try {
    const tradable = companies.filter(c => c[2] !== "private");
    const symbols = tradable.map(c => c[1]).join(",");
    const response = await fetch(`/api/quotes?symbols=${symbols}`);
    const data = await response.json();

    lastData = data.quoteResponse.result.map(stock => {
      const name = companies.find(c => c[1] === stock.symbol)?.[0] || stock.longName || stock.shortName || "-";
      const regularPrice = stock.regularMarketPrice ?? 0;
      const prePrice = stock.preMarketPrice;
      const postPrice = stock.postMarketPrice;

      // Use whichever extended-hours session is currently active for the
      // "Ext. Hours" columns, rather than always showing post-market.
      let session = "Regular";
      let extPrice = null, extChange = null;
      if (prePrice && prePrice > 0) {
        session = "Pre-Market";
        extPrice = prePrice;
        extChange = stock.preMarketChange ?? null;
      } else if (postPrice && postPrice > 0) {
        session = "After Hours";
        extPrice = postPrice;
        extChange = stock.postMarketChange ?? null;
      }

      return {
        name,
        symbol: stock.symbol,
        currency: stock.currency || "",
        price: regularPrice,
        afterHoursPrice: extPrice,
        afterHoursChange: (extChange !== null && extChange !== 0) ? extChange : null,
        change: stock.regularMarketChange ?? 0,
        changePct: stock.regularMarketChangePercent ?? 0,
        session,
        volume: stock.regularMarketVolume || 0,
      };
    });

    // Private holdings (no public market data) — show as placeholder rows.
    companies.filter(c => c[2] === "private").forEach(c => {
      lastData.push({
        name: c[0], symbol: c[1], private: true,
        currency: "", price: null, afterHoursPrice: null, afterHoursChange: null,
        change: null, changePct: null, session: "Private", volume: null,
      });
    });

    render();
    lastUpdated.textContent = "Last updated: " + new Date().toLocaleTimeString();

  } catch (error) {
    console.error(error);
    lastUpdated.textContent = "Error loading Yahoo Finance data.";
  }
}

refreshBtn.addEventListener("click", () => {
  fetchQuotes();   // live prices
  loadScores();    // evaluation colors
});

fetch("/companies.json")
  .then(r => r.json())
  .then(data => {
    companies = data;
    privateSymbols = new Set(companies.filter(c => c[2] === "private").map(c => c[1]));
    fetchQuotes();
    loadScores();
    setInterval(fetchQuotes, 60000);
    // Refresh evaluation colors periodically (fundamentals barely move; the
    // server caches them, so this is cheap).
    setInterval(loadScores, 15 * 60 * 1000);
  })
  .catch(() => {
    lastUpdated.textContent = "Error loading companies.json";
  });

// Fetch fundamentals for every company, compute the Hold/Watch/Reevaluate
// verdict with the same rules as the detail panel, then recolor the table.
function loadScores() {
  if (!companies.length) return;
  const symbols = companies.filter(c => c[2] !== "private").map(c => c[1]).join(",");
  fetch(`/api/fundamentals-batch?symbols=${encodeURIComponent(symbols)}`)
    .then(r => r.json())
    .then(map => {
      Object.entries(map).forEach(([sym, f]) => {
        scores[sym] = f ? scoreFundamentals(f).verdict : "No data";
      });
      render();
    })
    .catch(() => {});
}

/* ============================================================
   Detail panel: fundamentals, glossary, news, AI analysis
   ============================================================ */

const panel = document.getElementById("detailPanel");
const overlay = document.getElementById("panelOverlay");
const panelName = document.getElementById("panelName");
const panelTicker = document.getElementById("panelTicker");
const panelBadge = document.getElementById("panelBadge");
const scorecardEl = document.getElementById("scorecard");
const fundamentalsEl = document.getElementById("fundamentals");
const yahooLink = document.getElementById("yahooLink");
const newsListEl = document.getElementById("newsList");
const aiResultEl = document.getElementById("aiResult");
const askAiBtn = document.getElementById("askAiBtn");

let currentSymbol = null;
let currentName = null;
let aiAvailable = false;

// Plain-English meaning for each metric, shown as a tooltip on hover.
const GLOSSARY = {
  marketCap: "Market capitalization — total value of all shares (price × shares outstanding).",
  trailingPE: "Trailing P/E — price divided by the last 12 months of earnings. Lower can mean cheaper.",
  forwardPE: "Forward P/E — price divided by expected next-year earnings.",
  priceToSales: "Price/Sales — market cap divided by revenue. Useful when earnings are thin.",
  priceToBook: "Price/Book — price relative to net asset (book) value.",
  profitMargins: "Net profit margin — percent of revenue left after all costs.",
  grossMargins: "Gross margin — percent of revenue left after cost of goods sold.",
  operatingMargins: "Operating margin — percent of revenue left after operating costs.",
  revenueGrowth: "Revenue growth — year-over-year change in sales. Acceleration supports holding.",
  earningsGrowth: "Earnings growth — year-over-year change in profit.",
  returnOnEquity: "Return on equity — profit generated per dollar of shareholder equity.",
  totalRevenue: "Total revenue — trailing 12-month sales.",
  freeCashflow: "Free cash flow — cash left after capital spending.",
  debtToEquity: "Debt/Equity — leverage; how much debt vs. shareholder equity.",
  fiftyTwoWeekHigh: "Highest price over the past 52 weeks.",
  fiftyTwoWeekLow: "Lowest price over the past 52 weeks.",
  targetMeanPrice: "Average analyst price target.",
  recommendationKey: "Consensus analyst rating (buy / hold / sell).",
  numberOfAnalystOpinions: "Number of analysts contributing to the consensus.",
};

const PCT_KEYS = new Set([
  "profitMargins", "grossMargins", "operatingMargins",
  "revenueGrowth", "earningsGrowth", "returnOnEquity",
]);
const MONEY_KEYS = new Set(["marketCap", "totalRevenue", "freeCashflow"]);

const LABELS = {
  marketCap: "Market Cap", trailingPE: "Trailing P/E", forwardPE: "Forward P/E",
  priceToSales: "Price / Sales", priceToBook: "Price / Book",
  profitMargins: "Profit Margin", grossMargins: "Gross Margin",
  operatingMargins: "Operating Margin", revenueGrowth: "Revenue Growth",
  earningsGrowth: "Earnings Growth", returnOnEquity: "Return on Equity",
  totalRevenue: "Revenue (TTM)", freeCashflow: "Free Cash Flow",
  debtToEquity: "Debt / Equity", fiftyTwoWeekHigh: "52-Week High",
  fiftyTwoWeekLow: "52-Week Low", targetMeanPrice: "Analyst Target",
  recommendationKey: "Analyst Rating", numberOfAnalystOpinions: "# Analysts",
};

const METRIC_ORDER = [
  "marketCap", "trailingPE", "forwardPE", "priceToSales", "priceToBook",
  "revenueGrowth", "earningsGrowth", "profitMargins", "grossMargins",
  "operatingMargins", "returnOnEquity", "debtToEquity", "totalRevenue",
  "freeCashflow", "fiftyTwoWeekLow", "fiftyTwoWeekHigh", "targetMeanPrice",
  "recommendationKey", "numberOfAnalystOpinions",
];

function fmtMoney(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
  return n.toLocaleString();
}

function fmtValue(key, v) {
  if (v == null) return "—";
  if (PCT_KEYS.has(key)) return (v * 100).toFixed(1) + "%";
  if (MONEY_KEYS.has(key)) return fmtMoney(v);
  if (typeof v === "number") return v.toFixed(2);
  return String(v);
}

// Rule-based Hold / Watch / Reevaluate from the improve.png framework.
function scoreFundamentals(f) {
  const signals = [];
  let score = 0;

  const add = (cls, text, delta) => { signals.push({ cls, text }); score += delta; };

  if (f.revenueGrowth != null) {
    if (f.revenueGrowth >= 0.15) add("good", `Revenue +${(f.revenueGrowth * 100).toFixed(0)}%`, 1);
    else if (f.revenueGrowth < 0) add("bad", `Revenue ${(f.revenueGrowth * 100).toFixed(0)}%`, -1);
    else add("warn", `Revenue +${(f.revenueGrowth * 100).toFixed(0)}%`, 0);
  }
  if (f.earningsGrowth != null) {
    if (f.earningsGrowth > 0) add("good", `Earnings +${(f.earningsGrowth * 100).toFixed(0)}%`, 1);
    else add("bad", `Earnings ${(f.earningsGrowth * 100).toFixed(0)}%`, -1);
  }
  if (f.profitMargins != null) {
    if (f.profitMargins >= 0.15) add("good", `Margin ${(f.profitMargins * 100).toFixed(0)}%`, 1);
    else if (f.profitMargins < 0) add("bad", "Unprofitable", -1);
    else add("warn", `Margin ${(f.profitMargins * 100).toFixed(0)}%`, 0);
  }
  if (f.recommendationKey) {
    const k = f.recommendationKey.toLowerCase();
    if (k.includes("buy")) add("good", `Rated ${f.recommendationKey}`, 1);
    else if (k.includes("sell") || k.includes("underperform")) add("bad", `Rated ${f.recommendationKey}`, -1);
    else add("warn", `Rated ${f.recommendationKey}`, 0);
  }
  if (f.targetMeanPrice != null && f.currentPrice != null && f.currentPrice > 0) {
    const upside = (f.targetMeanPrice - f.currentPrice) / f.currentPrice;
    if (upside >= 0.1) add("good", `${(upside * 100).toFixed(0)}% to target`, 1);
    else if (upside < -0.05) add("bad", `${(upside * 100).toFixed(0)}% to target`, -1);
    else add("warn", `${(upside * 100).toFixed(0)}% to target`, 0);
  }

  let verdict, cls;
  if (signals.length === 0) { verdict = "No data"; cls = "badge-unknown"; }
  else if (score >= 2) { verdict = "Hold"; cls = "badge-hold"; }
  else if (score <= -1) { verdict = "Reevaluate"; cls = "badge-reevaluate"; }
  else { verdict = "Watch"; cls = "badge-watch"; }

  return { signals, verdict, cls };
}

function renderScorecard(f) {
  const { signals, verdict, cls } = scoreFundamentals(f);
  panelBadge.textContent = verdict;
  panelBadge.className = "badge " + cls;
  scorecardEl.innerHTML = signals
    .map(s => `<span class="signal ${s.cls}">${s.text}</span>`)
    .join("");
}

function renderFundamentals(f) {
  const cells = METRIC_ORDER
    .filter(k => f[k] != null)
    .map(k => `
      <div class="metric">
        <span class="label" title="${(GLOSSARY[k] || "").replace(/"/g, "&quot;")}">${LABELS[k]}</span>
        <span class="value">${fmtValue(k, f[k])}</span>
      </div>`).join("");

  const meta = [f.sector, f.industry].filter(Boolean).join(" · ");
  const summary = f.summary
    ? `<div class="summary">${f.summary.slice(0, 320)}${f.summary.length > 320 ? "…" : ""}</div>`
    : "";

  fundamentalsEl.innerHTML =
    (meta ? `<div class="summary">${meta}</div>` : "") + cells + summary;
}

function renderNews(items) {
  if (!items || items.length === 0) {
    newsListEl.innerHTML = "<p class='ai-note'>No recent news found.</p>";
    return;
  }
  newsListEl.innerHTML = items.map(n => {
    const when = n.published
      ? new Date(typeof n.published === "number" ? n.published * 1000 : n.published).toLocaleDateString()
      : "";
    const meta = [n.publisher, when].filter(Boolean).join(" · ");
    return `<a class="news-item" href="${n.link}" target="_blank" rel="noopener">
      <div class="news-title">${n.title}</div>
      <div class="news-meta">${meta}</div>
    </a>`;
  }).join("");
}

// Minimal markdown → HTML for the AI response (headings, bold, bullets).
function renderMarkdown(md) {
  const esc = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = esc.split("\n");
  let html = "", inList = false;
  for (let line of lines) {
    line = line.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${bullet[1]}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) html += `<h3>${h[2]}</h3>`;
    else if (line.trim()) html += `<p>${line}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

function setTab(name) {
  document.querySelectorAll(".tab-btn").forEach(b =>
    b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-pane").forEach(p =>
    p.classList.toggle("active", p.id === "tab-" + name));
}

function closePanel() {
  panel.classList.add("hidden");
  overlay.classList.add("hidden");
  panel.setAttribute("aria-hidden", "true");
  currentSymbol = null;
}

async function openPanel(symbol, name) {
  currentSymbol = symbol;
  currentName = name;
  panel.classList.remove("hidden");
  overlay.classList.remove("hidden");
  panel.setAttribute("aria-hidden", "false");
  panel.scrollTop = 0;
  setTab("overview");

  panelName.textContent = name;
  panelTicker.textContent = symbol;
  panelBadge.textContent = "";
  panelBadge.className = "badge";
  scorecardEl.innerHTML = "";
  fundamentalsEl.textContent = "Loading…";
  newsListEl.textContent = "Loading…";
  aiResultEl.innerHTML = "";
  yahooLink.style.display = "";
  yahooLink.href = `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/financials`;

  // Private holding — no public market data to fetch.
  if (privateSymbols.has(symbol)) {
    panelBadge.textContent = "Private";
    panelBadge.className = "badge badge-unknown";
    fundamentalsEl.innerHTML =
      `<p class="summary">${name} is privately held — there is no public market ` +
      `data, fundamentals, or news feed available. Tracked here for reference only.</p>`;
    newsListEl.innerHTML = `<p class="ai-note">No public news feed for private companies.</p>`;
    yahooLink.style.display = "none";
    return;
  }

  // Fundamentals + scorecard
  fetch(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`)
    .then(r => r.json())
    .then(f => {
      if (f.error) { fundamentalsEl.textContent = "Could not load fundamentals."; return; }
      if (symbol !== currentSymbol) return; // panel changed while loading
      renderScorecard(f);
      renderFundamentals(f);
    })
    .catch(() => { fundamentalsEl.textContent = "Could not load fundamentals."; });

  // News
  fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`)
    .then(r => r.json())
    .then(d => { if (symbol === currentSymbol) renderNews(d.news); })
    .catch(() => { newsListEl.textContent = "Could not load news."; });
}

async function askAi() {
  if (!currentSymbol) return;
  askAiBtn.disabled = true;
  askAiBtn.textContent = "Analyzing…";
  aiResultEl.innerHTML = "";
  try {
    const resp = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: currentSymbol, name: currentName }),
    });
    const data = await resp.json();
    if (data.analysis) {
      aiResultEl.innerHTML = renderMarkdown(data.analysis) +
        (data.model ? `<p class="ai-note">Model: ${data.model}</p>` : "");
    } else {
      aiResultEl.innerHTML = `<p class="ai-note">${data.message || data.error || "Analysis failed."}</p>`;
    }
  } catch (e) {
    aiResultEl.innerHTML = `<p class="ai-note">Request failed: ${e}</p>`;
  } finally {
    askAiBtn.disabled = false;
    askAiBtn.textContent = "Analyze with AI";
  }
}

document.querySelectorAll(".tab-btn").forEach(b =>
  b.addEventListener("click", () => setTab(b.dataset.tab)));
document.getElementById("panelClose").addEventListener("click", closePanel);
overlay.addEventListener("click", closePanel);
document.addEventListener("keydown", e => { if (e.key === "Escape") closePanel(); });
askAiBtn.addEventListener("click", askAi);

// Hide the Ask AI tab if the server has no API key / SDK.
fetch("/api/ai-status")
  .then(r => r.json())
  .then(s => {
    aiAvailable = s.available;
    if (!aiAvailable) {
      const tab = document.querySelector('.tab-btn[data-tab="ai"]');
      if (tab) {
        tab.title = s.hasKey ? "anthropic package not installed" : "Set ANTHROPIC_API_KEY to enable";
        tab.style.opacity = "0.5";
      }
      askAiBtn.disabled = true;
      askAiBtn.textContent = "AI not configured";
    }
  })
  .catch(() => {});
