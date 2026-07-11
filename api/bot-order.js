const crypto = require('crypto');

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function envConfig(mode) {
  const live = mode === 'live';
  const baseUrl = live
    ? 'https://external-api.kalshi.com/trade-api/v2'
    : 'https://external-api.demo.kalshi.co/trade-api/v2';
  const keyId = live ? process.env.KALSHI_LIVE_KEY_ID : process.env.KALSHI_DEMO_KEY_ID;
  const rawKey = live ? process.env.KALSHI_LIVE_PRIVATE_KEY : process.env.KALSHI_DEMO_PRIVATE_KEY;
  const privateKey = rawKey ? rawKey.replace(/\\n/g, '\n') : '';
  return { baseUrl, keyId, privateKey, live };
}

function signRequest(privateKey, timestamp, method, path) {
  const msg = Buffer.from(`${timestamp}${method}${path.split('?')[0]}`, 'utf8');
  return crypto.sign('sha256', msg, {
    key: privateKey,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }).toString('base64');
}

function clamp(n, min, max) {
  n = Number(n);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function buildOrder({ ticker, pick, maxTradeSize, priceCap, cancelAfterSec, clientOrderId }) {
  const cap = Number(priceCap) > 0 ? clamp(Number(priceCap), 0.01, 0.99) : 0.99;
  const isOver = String(pick).toUpperCase() === 'OVER';
  const side = isOver ? 'bid' : 'ask';
  const price = isOver ? cap : clamp(1 - cap, 0.01, 0.99);
  const unitCost = isOver ? price : 1 - price;
  const budget = Math.max(0.01, Number(maxTradeSize) || 1);
  const count = Math.max(0.01, budget / Math.max(unitCost, 0.01));
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(Number(cancelAfterSec) || 10));
  return {
    ticker: String(ticker || '').toUpperCase(),
    client_order_id: String(clientOrderId || crypto.randomUUID()).slice(0, 64),
    side,
    count: count.toFixed(2),
    price: price.toFixed(4),
    time_in_force: 'good_till_canceled',
    expiration_time: exp,
    self_trade_prevention_type: 'taker_at_cross',
    post_only: false,
    cancel_order_on_pause: true,
    reduce_only: false,
    subaccount: 0,
    exchange_index: -1
  };
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'POST') return json(res, 405, { error: 'POST required' });

  let body;
  try { body = await readBody(req); }
  catch (err) { return json(res, 400, { error: 'Invalid JSON body', detail: err.message }); }

  const mode = String(body.mode || 'demo').toLowerCase();
  if (!['demo', 'live'].includes(mode)) return json(res, 400, { error: 'mode must be demo or live' });
  if (!body.ticker) return json(res, 400, { error: 'ticker is required' });
  if (!['OVER', 'UNDER'].includes(String(body.pick).toUpperCase())) return json(res, 400, { error: 'pick must be OVER or UNDER' });

  const cfg = envConfig(mode);
  if (!cfg.keyId || !cfg.privateKey) {
    return json(res, 400, {
      error: `${mode.toUpperCase()} Kalshi API keys are not configured on the server`,
      detail: mode === 'live'
        ? 'Set KALSHI_LIVE_KEY_ID and KALSHI_LIVE_PRIVATE_KEY in environment variables.'
        : 'Set KALSHI_DEMO_KEY_ID and KALSHI_DEMO_PRIVATE_KEY in environment variables.',
      configured: false
    });
  }

  const path = '/trade-api/v2/portfolio/events/orders';
  const method = 'POST';
  const order = buildOrder(body);
  const timestamp = String(Date.now());
  let signature;
  try { signature = signRequest(cfg.privateKey, timestamp, method, path); }
  catch (err) { return json(res, 500, { error: 'Kalshi signing failed', detail: err.message }); }

  try {
    const response = await fetch(cfg.baseUrl + '/portfolio/events/orders', {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'KALSHI-ACCESS-KEY': cfg.keyId,
        'KALSHI-ACCESS-TIMESTAMP': timestamp,
        'KALSHI-ACCESS-SIGNATURE': signature
      },
      body: JSON.stringify(order)
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { raw: text }; }
    if (!response.ok) {
      return json(res, response.status, {
        error: 'Kalshi order rejected',
        status: response.status,
        detail: payload,
        requestSummary: {
          mode,
          ticker: order.ticker,
          pick: body.pick,
          side: order.side,
          price: order.price,
          count: order.count,
          expiration_time: order.expiration_time
        }
      });
    }
    return json(res, 200, {
      ok: true,
      mode,
      order: payload,
      requestSummary: {
        ticker: order.ticker,
        pick: body.pick,
        side: order.side,
        price: order.price,
        count: order.count,
        expiration_time: order.expiration_time
      }
    });
  } catch (err) {
    return json(res, 502, { error: 'Kalshi order request failed', detail: err.message });
  }
};
