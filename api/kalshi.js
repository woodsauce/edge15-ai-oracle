const SERIES = {
  BTC: 'KXBTC15M',
  ETH: 'KXETH15M',
  SOL: 'KXSOL15M',
  BNB: 'KXBNB15M',
  XRP: 'KXXRP15M'
};

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

function parseNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const s = String(value).replace(/,/g, '');
  const match = s.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function extractTarget(market) {
  const candidates = [
    market.functional_strike,
    market.floor_strike,
    market.cap_strike,
    market.custom_strike && JSON.stringify(market.custom_strike),
    market.subtitle,
    market.title,
    market.yes_sub_title,
    market.no_sub_title,
    market.rules_primary
  ];
  for (const item of candidates) {
    const num = parseNumber(item);
    if (Number.isFinite(num) && Math.abs(num) > 1) return num;
  }
  return null;
}

function centsOrDollars(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 1) return Math.round(n * 100);
  return Math.round(n);
}

function pickCurrentMarket(markets) {
  const now = Date.now();
  const active = markets
    .filter((m) => {
      const close = Date.parse(m.close_time || m.expiration_time || m.expected_expiration_time || m.latest_expiration_time || 0);
      const open = Date.parse(m.open_time || m.created_time || 0);
      return (!open || open <= now + 60_000) && (!close || close >= now - 60_000);
    })
    .sort((a, b) => {
      const ac = Date.parse(a.close_time || a.expiration_time || a.expected_expiration_time || a.latest_expiration_time || 0);
      const bc = Date.parse(b.close_time || b.expiration_time || b.expected_expiration_time || b.latest_expiration_time || 0);
      return ac - bc;
    });
  return active[0] || markets[0] || null;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

  const symbol = String(req.query.symbol || 'BTC').toUpperCase();
  const seriesTicker = SERIES[symbol] || req.query.series_ticker;
  if (!seriesTicker) return json(res, 400, { error: 'Unsupported symbol', symbol });

  const url = `https://external-api.kalshi.com/trade-api/v2/markets?series_ticker=${encodeURIComponent(seriesTicker)}&status=open&limit=100`;

  try {
    const data = await fetchJson(url);
    const markets = Array.isArray(data.markets) ? data.markets : [];
    const market = pickCurrentMarket(markets);
    if (!market) {
      return json(res, 200, {
        symbol,
        seriesTicker,
        source: 'kalshi-public',
        fetchedAt: new Date().toISOString(),
        market: null,
        note: 'No open market returned for this series.'
      });
    }

    json(res, 200, {
      symbol,
      seriesTicker,
      source: 'kalshi-public',
      fetchedAt: new Date().toISOString(),
      market: {
        ticker: market.ticker,
        eventTicker: market.event_ticker,
        title: market.title,
        subtitle: market.subtitle,
        yesSubTitle: market.yes_sub_title,
        noSubTitle: market.no_sub_title,
        target: extractTarget(market),
        openTime: market.open_time,
        closeTime: market.close_time || market.expiration_time || market.expected_expiration_time || market.latest_expiration_time,
        expectedExpirationTime: market.expected_expiration_time,
        expirationTime: market.expiration_time,
        yesBid: centsOrDollars(market.yes_bid_dollars ?? market.yes_bid),
        yesAsk: centsOrDollars(market.yes_ask_dollars ?? market.yes_ask),
        noBid: centsOrDollars(market.no_bid_dollars ?? market.no_bid),
        noAsk: centsOrDollars(market.no_ask_dollars ?? market.no_ask),
        lastPrice: centsOrDollars(market.last_price_dollars ?? market.last_price),
        liquidity: Number(market.liquidity_dollars || market.liquidity || 0),
        volume: Number(market.volume_fp || market.volume || 0),
        rulesPrimary: market.rules_primary,
        rawTargetFields: {
          functionalStrike: market.functional_strike,
          floorStrike: market.floor_strike,
          capStrike: market.cap_strike
        }
      }
    });
  } catch (error) {
    json(res, 502, { error: 'Kalshi fetch failed', detail: error.message, symbol, seriesTicker });
  }
};
