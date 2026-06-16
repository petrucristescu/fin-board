# Watchlist Dashboard

A local stock watchlist dashboard that displays real-time prices plus an on-demand
deep-dive on each company: fundamentals (with plain-English explanations), recent
news, a rule-based Hold / Watch / Reevaluate score, and an optional AI analysis.
Market data is fetched via [yfinance](https://github.com/ranaroussi/yfinance).

## Features

- Live prices, daily change ($ and %), and volume for all configured tickers
- Extended hours prices shown when available (pre-market / after hours)
- Auto-refreshes every 60 seconds; sortable columns
- **Click any company** to open a detail panel with:
  - **Fundamentals** — P/E, margins, growth, market cap, 52-week range, analyst
    target, etc. Hover any metric label for a plain-English explanation, and follow
    the link to the full Yahoo Finance financials page.
  - **Rule-based badge** — Hold / Watch / Reevaluate, computed from the fundamentals
    using a simple investing framework (revenue accelerating, margins healthy,
    estimates rising → Hold; deteriorating → Reevaluate).
  - **News** — recent headlines for the company (free, via yfinance).
  - **Ask AI** *(optional)* — sends the fundamentals and headlines to Claude for a
    narrative thesis and recommendation. Not financial advice.

## Requirements

- Python 3.x
- `pip install yfinance`
- *(optional, for Ask AI)* `pip install anthropic`

## Running

```bash
python server.py
```

Then open **http://localhost:8000** in your browser.

The server serves the static files and proxies all Yahoo Finance requests locally,
avoiding CORS restrictions.

## Enabling the "Ask AI" analysis

The Ask AI tab is hidden/disabled unless the server can reach the Anthropic API.
To enable it:

1. Install the SDK: `pip install anthropic`
2. Set your API key before starting the server:

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...      # bash / git-bash
   # or on Windows PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."
   python server.py
   ```

3. *(optional)* Override the model with `ANTHROPIC_MODEL` (default `claude-opus-4-8`).

If the key or package is missing, the rest of the dashboard works normally and the
Ask AI button simply shows "AI not configured".

## API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/quotes?symbols=A,B,C` | GET | Batch live quotes (used by the table) |
| `/api/fundamentals?symbol=X` | GET | Fundamental metrics for the detail panel |
| `/api/news?symbol=X` | GET | Recent news headlines |
| `/api/ai-status` | GET | Whether Ask AI is available (key + SDK present) |
| `/api/analyze` | POST | `{ "symbol": "X", "name": "..." }` → AI analysis |

## Adding or removing tickers

Edit **`companies.json`** — each entry is `["Display Name", "TICKER"]`:

```json
[
  ["Nvidia", "NVDA"],
  ["AMD", "AMD"],
  ["Aixtron", "AIXA.DE"]
]
```

Yahoo Finance ticker format applies: append `.DE` for XETRA, `.PA` for Euronext
Paris, `.L` for London, `.ST` for Stockholm, `.T` for Tokyo, etc. Changes take
effect on the next page load.

### Private holdings

Privately held companies (e.g. SpaceX) have no Yahoo Finance quote, fundamentals,
or news. Add a third `"private"` element to mark them — they appear as a
placeholder row in a dedicated **Private** group, are excluded from all API calls,
and show a reference-only note in the detail panel:

```json
["SpaceX", "SPACEX", "private"]
```
