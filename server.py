from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
import urllib.parse
import urllib.request
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Short in-memory cache for fundamentals (they barely move intraday). Keeps the
# batch endpoint and repeated panel opens from hammering yfinance.
_FUND_CACHE = {}
_FUND_TTL = 600  # seconds

# Model used for the optional "Ask AI" analysis. Override with ANTHROPIC_MODEL.
ANALYSIS_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-8")

# Optional: Finnhub provides real-time US quotes including extended/overnight
# trading, which yfinance's free feed does not surface. Used only to fill the
# extended-hours columns when a key is set; everything else stays on yfinance.
FINNHUB_KEY = os.environ.get("FINNHUB_API_KEY")


def finnhub_quote(symbol):
    """Real-time quote from Finnhub. Free tier covers US tickers; symbols with
    an exchange suffix (e.g. .DE, .PA, .L) are skipped. Returns the parsed dict
    {c,d,dp,pc,t,...} or None."""
    if not FINNHUB_KEY or "." in symbol:
        return None
    try:
        url = ("https://finnhub.io/api/v1/quote?symbol="
               + urllib.parse.quote(symbol) + "&token=" + FINNHUB_KEY)
        with urllib.request.urlopen(url, timeout=10) as r:
            d = json.load(r)
        if d and d.get("c"):
            return d
    except Exception:
        return None
    return None


def fetch_quote(symbol):
    try:
        ticker = yf.Ticker(symbol)
        fi = ticker.fast_info
        info = ticker.info

        # Prefer Yahoo's own regular-session fields so the displayed change
        # matches finance.yahoo.com. Computing last - previous_close from
        # fast_info is unreliable during extended hours, because last_price
        # can return the pre/post-market price (off by the after-hours move).
        last = info.get('regularMarketPrice')
        if last is None:
            last = fi.last_price
        prev = info.get('regularMarketPreviousClose') or info.get('previousClose')
        if prev is None:
            prev = fi.previous_close

        change = info.get('regularMarketChange')
        if change is None:
            change = (last - prev) if (last and prev) else 0
        pct = info.get('regularMarketChangePercent')
        if pct is None:
            pct = (change / prev * 100) if prev else 0

        state = info.get('marketState')

        # When the regular session is closed, prefer Finnhub's real-time price
        # for the extended-hours columns — it carries the overnight/pre/post
        # trade that yfinance's free feed misses. During REGULAR hours we leave
        # the (Yahoo-matching) yfinance figures alone.
        ext_price = None
        ext_change = None
        if state and state != 'REGULAR' and last:
            fh = finnhub_quote(symbol)
            if fh and fh.get('c') and abs(fh['c'] - last) > 0.005:
                ext_price = fh['c']
                ext_change = fh['c'] - last

        return {
            'symbol': symbol,
            'shortName': info.get('shortName') or symbol,
            'longName': info.get('longName'),
            'currency': info.get('currency') or fi.currency,
            'regularMarketPrice': last or 0,
            'regularMarketChange': change or 0,
            'regularMarketChangePercent': pct or 0,
            'regularMarketVolume': info.get('regularMarketVolume') or fi.last_volume or 0,
            'marketState': state,
            'preMarketPrice': info.get('preMarketPrice'),
            'preMarketChange': info.get('preMarketChange'),
            'postMarketPrice': info.get('postMarketPrice'),
            'postMarketChange': info.get('postMarketChange'),
            'extPrice': ext_price,
            'extChange': ext_change,
        }
    except Exception:
        return None


def fetch_fundamentals(symbol):
    """Pull the subset of yfinance .info that drives the detail panel."""
    hit = _FUND_CACHE.get(symbol)
    if hit and (time.time() - hit[0]) < _FUND_TTL:
        return hit[1]

    ticker = yf.Ticker(symbol)
    info = ticker.info or {}

    def g(*keys):
        for k in keys:
            v = info.get(k)
            if v is not None:
                return v
        return None

    data = {
        'symbol': symbol,
        'longName': g('longName', 'shortName'),
        'sector': g('sector'),
        'industry': g('industry'),
        'currency': g('currency'),
        'website': g('website'),
        'summary': g('longBusinessSummary'),
        'marketCap': g('marketCap'),
        'trailingPE': g('trailingPE'),
        'forwardPE': g('forwardPE'),
        'priceToSales': g('priceToSalesTrailing12Months'),
        'priceToBook': g('priceToBook'),
        'profitMargins': g('profitMargins'),
        'grossMargins': g('grossMargins'),
        'operatingMargins': g('operatingMargins'),
        'revenueGrowth': g('revenueGrowth'),
        'earningsGrowth': g('earningsGrowth', 'earningsQuarterlyGrowth'),
        'returnOnEquity': g('returnOnEquity'),
        'totalRevenue': g('totalRevenue'),
        'freeCashflow': g('freeCashflow'),
        'debtToEquity': g('debtToEquity'),
        'fiftyTwoWeekHigh': g('fiftyTwoWeekHigh'),
        'fiftyTwoWeekLow': g('fiftyTwoWeekLow'),
        'currentPrice': g('currentPrice', 'regularMarketPrice'),
        'targetMeanPrice': g('targetMeanPrice'),
        'targetHighPrice': g('targetHighPrice'),
        'targetLowPrice': g('targetLowPrice'),
        'recommendationKey': g('recommendationKey'),
        'numberOfAnalystOpinions': g('numberOfAnalystOpinions'),
    }
    _FUND_CACHE[symbol] = (time.time(), data)
    return data


def _normalize_news_item(item):
    """yfinance has used two news shapes over time; normalize both."""
    # Newer shape: {'id': ..., 'content': {...}}
    content = item.get('content') if isinstance(item, dict) else None
    if content:
        provider = content.get('provider') or {}
        url = ''
        ctu = content.get('canonicalUrl') or content.get('clickThroughUrl') or {}
        if isinstance(ctu, dict):
            url = ctu.get('url', '')
        return {
            'title': content.get('title'),
            'publisher': provider.get('displayName'),
            'link': url,
            'published': content.get('pubDate') or content.get('displayTime'),
            'summary': content.get('summary'),
        }
    # Legacy flat shape
    return {
        'title': item.get('title'),
        'publisher': item.get('publisher'),
        'link': item.get('link'),
        'published': item.get('providerPublishTime'),
        'summary': item.get('summary'),
    }


def fetch_news(symbol, limit=12):
    ticker = yf.Ticker(symbol)
    raw = ticker.news or []
    items = [_normalize_news_item(n) for n in raw]
    items = [n for n in items if n.get('title')]
    return items[:limit]


def analyze_company(name, symbol, fundamentals, news):
    """Optional AI analysis via the Anthropic API. Returns (ok, payload)."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        return False, {'error': 'no_api_key',
                       'message': 'ANTHROPIC_API_KEY is not set on the server.'}
    try:
        import anthropic
    except ImportError:
        return False, {'error': 'no_sdk',
                       'message': 'The anthropic package is not installed (pip install anthropic).'}

    headlines = "\n".join(
        f"- {n['title']} ({n.get('publisher') or 'unknown'})" for n in news[:10]
    ) or "(no recent headlines available)"

    fund_lines = "\n".join(f"- {k}: {v}" for k, v in fundamentals.items() if v is not None)

    system = (
        "You are an equity analyst assistant for a personal stock watchlist. "
        "Apply this decision framework when judging a position:\n"
        "MAINTAIN the position if: revenue is accelerating, margins are improving, "
        "estimates are rising, and the investment thesis is intact.\n"
        "REEVALUATE the position if: fundamentals are deteriorating, demand is slowing, "
        "margins are compressing, or the investment thesis has changed.\n"
        "Price is what you pay; value is what you get. Be concise, specific, and balanced. "
        "You are not a licensed financial advisor and this is not financial advice."
    )

    user = (
        f"Company: {name} ({symbol})\n\n"
        f"Fundamentals:\n{fund_lines}\n\n"
        f"Recent news headlines:\n{headlines}\n\n"
        "Provide, in markdown:\n"
        "1. **Thesis** — a 2-3 sentence summary of the bull/bear case.\n"
        "2. **Supports holding** — bullet points of what favors maintaining the position.\n"
        "3. **Would trigger reevaluation** — bullet points of red flags / what to watch.\n"
        "4. **Recommendation** — one of Hold / Watch / Reevaluate, with a one-line rationale.\n"
        "Keep the whole response under ~350 words."
    )

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=ANALYSIS_MODEL,
        max_tokens=6000,
        thinking={"type": "adaptive"},
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    text = "".join(b.text for b in resp.content if b.type == "text")
    return True, {'analysis': text, 'model': resp.model}


class Handler(SimpleHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path == '/api/quotes':
            symbols = params.get('symbols', [''])[0].split(',')
            results = []
            with ThreadPoolExecutor(max_workers=10) as ex:
                futures = {ex.submit(fetch_quote, s): s for s in symbols if s}
                for f in as_completed(futures):
                    q = f.result()
                    if q:
                        results.append(q)
            order = {s: i for i, s in enumerate(symbols)}
            results.sort(key=lambda r: order.get(r['symbol'], 999))
            self._send_json({'quoteResponse': {'result': results}})
            return

        if parsed.path == '/api/fundamentals':
            symbol = params.get('symbol', [''])[0]
            if not symbol:
                self._send_json({'error': 'missing symbol'}, 400)
                return
            try:
                self._send_json(fetch_fundamentals(symbol))
            except Exception as e:
                self._send_json({'error': str(e)}, 502)
            return

        if parsed.path == '/api/fundamentals-batch':
            symbols = params.get('symbols', [''])[0].split(',')
            results = {}
            with ThreadPoolExecutor(max_workers=12) as ex:
                futures = {ex.submit(fetch_fundamentals, s): s for s in symbols if s}
                for f in as_completed(futures):
                    s = futures[f]
                    try:
                        results[s] = f.result()
                    except Exception:
                        results[s] = None
            self._send_json(results)
            return

        if parsed.path == '/api/news':
            symbol = params.get('symbol', [''])[0]
            if not symbol:
                self._send_json({'error': 'missing symbol'}, 400)
                return
            try:
                self._send_json({'symbol': symbol, 'news': fetch_news(symbol)})
            except Exception as e:
                self._send_json({'error': str(e)}, 502)
            return

        # AI availability probe — lets the frontend show/hide the "Ask AI" button.
        if parsed.path == '/api/ai-status':
            available = bool(os.environ.get('ANTHROPIC_API_KEY'))
            try:
                import anthropic  # noqa: F401
                has_sdk = True
            except ImportError:
                has_sdk = False
            self._send_json({'available': available and has_sdk,
                             'hasKey': available, 'hasSdk': has_sdk,
                             'model': ANALYSIS_MODEL})
            return

        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == '/api/analyze':
            length = int(self.headers.get('Content-Length', 0))
            try:
                body = json.loads(self.rfile.read(length) or b'{}')
            except json.JSONDecodeError:
                self._send_json({'error': 'invalid json'}, 400)
                return
            symbol = body.get('symbol')
            name = body.get('name') or symbol
            if not symbol:
                self._send_json({'error': 'missing symbol'}, 400)
                return
            try:
                fundamentals = fetch_fundamentals(symbol)
                news = fetch_news(symbol)
                ok, payload = analyze_company(name, symbol, fundamentals, news)
                self._send_json(payload, 200 if ok else 503)
            except Exception as e:
                self._send_json({'error': str(e)}, 502)
            return
        self._send_json({'error': 'not found'}, 404)

    def log_message(self, fmt, *args):
        pass


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


if __name__ == '__main__':
    server = ThreadingHTTPServer(('localhost', 8000), Handler)
    print('Serving at http://localhost:8000')
    server.serve_forever()
