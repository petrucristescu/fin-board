
const tbody = document.querySelector("#watchlist tbody");
const refreshBtn = document.getElementById("refreshBtn");
const lastUpdated = document.getElementById("lastUpdated");
const headers = document.querySelectorAll("#watchlist th[data-sort]");

let companies = [];
let lastData = [];
let sortKey = null;
let sortDir = "asc";

function renderTable() {
  const rows = [...lastData];

  if (sortKey) {
    rows.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const cmp = typeof av === "string" ? av.localeCompare(bv) : av - bv;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  tbody.innerHTML = "";
  rows.forEach(stock => {
    const changeClass =
      stock.change > 0 ? "positive" :
      stock.change < 0 ? "negative" : "neutral";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${stock.name}</td>
      <td>${stock.symbol}</td>
      <td>${stock.price.toFixed(2)}</td>
      <td class="${changeClass}">${stock.change.toFixed(2)}</td>
      <td class="${changeClass}">${stock.changePct.toFixed(2)}%</td>
      <td>${stock.session}</td>
      <td>${stock.volume.toLocaleString()}</td>
    `;
    tbody.appendChild(row);
  });

  headers.forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sortKey) {
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}

headers.forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;
    if (sortKey === key) {
      sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
      sortKey = key;
      sortDir = "asc";
    }
    renderTable();
  });
});

async function fetchQuotes() {
  try {
    const symbols = companies.map(c => c[1]).join(",");
    const response = await fetch(`/api/quotes?symbols=${symbols}`);
    const data = await response.json();

    lastData = data.quoteResponse.result.map(stock => {
      const name = companies.find(c => c[1] === stock.symbol)?.[0] || stock.longName || stock.shortName || "-";
      const regularPrice = stock.regularMarketPrice ?? 0;
      const prePrice = stock.preMarketPrice;
      const postPrice = stock.postMarketPrice;

      let price = regularPrice;
      let session = "Regular";
      if (prePrice && prePrice > 0) { price = prePrice; session = "Pre-Market"; }
      if (postPrice && postPrice > 0) { price = postPrice; session = "After Hours"; }

      return {
        name,
        symbol: stock.symbol,
        price,
        change: stock.regularMarketChange ?? 0,
        changePct: stock.regularMarketChangePercent ?? 0,
        session,
        volume: stock.regularMarketVolume || 0,
      };
    });

    renderTable();
    lastUpdated.textContent = "Last updated: " + new Date().toLocaleTimeString();

  } catch (error) {
    console.error(error);
    lastUpdated.textContent = "Error loading Yahoo Finance data.";
  }
}

refreshBtn.addEventListener("click", fetchQuotes);

fetch("/companies.json")
  .then(r => r.json())
  .then(data => {
    companies = data;
    fetchQuotes();
    setInterval(fetchQuotes, 60000);
  })
  .catch(() => {
    lastUpdated.textContent = "Error loading companies.json";
  });
