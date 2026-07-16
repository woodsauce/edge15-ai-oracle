function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  json(res, 200, {
    ok: true,
    demoConfigured: Boolean(process.env.KALSHI_DEMO_KEY_ID && process.env.KALSHI_DEMO_PRIVATE_KEY),
    liveConfigured: Boolean(process.env.KALSHI_LIVE_KEY_ID && process.env.KALSHI_LIVE_PRIVATE_KEY),
    note: 'Private keys are checked only by presence. They are never returned to the browser.'
  });
};
