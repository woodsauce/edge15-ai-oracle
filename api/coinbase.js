const PRODUCTS = new Set(['BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD', 'XRP-USD']);

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Edge15-AI-Oracle/1.0',
      'Accept': 'application/json'
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText} ${text.slice(0, 180)}`);
  }
  return response.json();
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  const product = String(req.query.product || 'BTC-USD').toUpperCase();
  if (!PRODUCTS.has(product)) return json(res, 400, { error: 'Unsupported product', product });

  const now = Math.floor(Date.now() / 1000);
  const end = now;
  const start = now - 60 * 75;
  const base = `https://api.exchange.coinbase.com/products/${encodeURIComponent(product)}`;

  try {
    const [ticker, stats, candles] = await Promise.all([
      fetchJson(`${base}/ticker`),
      fetchJson(`${base}/stats`),
      fetchJson(`${base}/candles?granularity=60&start=${new Date(start * 1000).toISOString()}&end=${new Date(end * 1000).toISOString()}`)
    ]);

    const normalizedCandles = Array.isArray(candles)
      ? candles
          .map((c) => ({
            time: Number(c[0]) * 1000,
            low: Number(c[1]),
            high: Number(c[2]),
            open: Number(c[3]),
            close: Number(c[4]),
            volume: Number(c[5])
          }))
          .filter((c) => Number.isFinite(c.close))
          .sort((a, b) => a.time - b.time)
      : [];

    json(res, 200, {
      product,
      source: 'coinbase-exchange-public',
      fetchedAt: new Date().toISOString(),
      price: Number(ticker.price),
      bid: Number(ticker.bid),
      ask: Number(ticker.ask),
      volume: Number(ticker.volume),
      tradeId: ticker.trade_id,
      stats: {
        open: Number(stats.open),
        high: Number(stats.high),
        low: Number(stats.low),
        last: Number(stats.last),
        volume: Number(stats.volume)
      },
      candles: normalizedCandles
    });
  } catch (error) {
    json(res, 502, { error: 'Coinbase fetch failed', detail: error.message, product });
  }
};
