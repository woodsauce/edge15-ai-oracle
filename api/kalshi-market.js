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

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  const ticker = String(req.query.ticker || '').trim().toUpperCase();
  if (!ticker) return json(res, 400, { error: 'ticker is required' });

  const url = `https://external-api.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`;
  try {
    const data = await fetchJson(url);
    const market = data.market || data;
    const target = extractTarget(market);
    const expirationValue = parseNumber(market.expiration_value || market.settlement_value || market.settlement_value_dollars);
    json(res, 200, {
      source: 'kalshi-public',
      fetchedAt: new Date().toISOString(),
      market: {
        ticker: market.ticker,
        title: market.title,
        subtitle: market.subtitle,
        status: market.status,
        result: market.result,
        target,
        expirationValue,
        expirationValueRaw: market.expiration_value,
        settlementTs: market.settlement_ts,
        closeTime: market.close_time || market.expiration_time || market.expected_expiration_time || market.latest_expiration_time,
        expirationTime: market.expiration_time,
        expectedExpirationTime: market.expected_expiration_time,
        settlementValueDollars: market.settlement_value_dollars,
        yesSubTitle: market.yes_sub_title,
        noSubTitle: market.no_sub_title
      }
    });
  } catch (error) {
    json(res, 502, { error: 'Kalshi market fetch failed', detail: error.message, ticker });
  }
};
