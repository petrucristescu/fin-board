# Watchlist Dashboard

A local stock watchlist dashboard that displays real-time prices, daily change, and volume for a configurable list of tickers. Data is fetched via [yfinance](https://github.com/ranaroussi/yfinance).

## Features

- Live prices, daily change ($ and %), and volume for all configured tickers
- Extended hours prices shown when available (pre-market / after hours)
- Auto-refreshes every 60 seconds
- Sortable columns — click any header to sort, click again to reverse

## Requirements

- Python 3.x
- yfinance: `pip install yfinance`

## Running

```bash
python server.py
```

Then open **http://localhost:8000** in your browser.

The server serves the static files and proxies all Yahoo Finance requests locally, avoiding CORS restrictions.

## Adding or removing tickers

Edit **`companies.json`** — each entry is `["Display Name", "TICKER"]`:

```json
[
  ["Nvidia", "NVDA"],
  ["AMD", "AMD"],
  ["Aixtron", "AIXA.DE"]
]
```

Yahoo Finance ticker format applies: append `.DE` for XETRA, `.PA` for Euronext Paris, `.L` for London, etc. Changes take effect on the next page load.
