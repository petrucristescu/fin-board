from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse
import json
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf

os.chdir(os.path.dirname(os.path.abspath(__file__)))

def fetch_quote(symbol):
    try:
        fi = yf.Ticker(symbol).fast_info
        prev = fi.previous_close
        last = fi.last_price
        change = (last - prev) if (last and prev) else 0
        pct = (change / prev * 100) if prev else 0
        return {
            'symbol': symbol,
            'shortName': symbol,
            'longName': None,
            'regularMarketPrice': last or 0,
            'regularMarketChange': change,
            'regularMarketChangePercent': pct,
            'regularMarketVolume': fi.last_volume or 0,
            'preMarketPrice': None,
            'postMarketPrice': None,
        }
    except Exception:
        return None

class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/api/quotes'):
            parsed = urllib.parse.urlparse(self.path)
            params = urllib.parse.parse_qs(parsed.query)
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

            payload = json.dumps({'quoteResponse': {'result': results}}).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(payload)
        else:
            super().do_GET()

    def log_message(self, fmt, *args):
        pass

if __name__ == '__main__':
    server = HTTPServer(('localhost', 8000), Handler)
    print('Serving at http://localhost:8000')
    server.serve_forever()
