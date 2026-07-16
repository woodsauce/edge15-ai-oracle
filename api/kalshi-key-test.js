const { rootForMode, headersFor, loadPrivateKey } = require('./kalshi-auth');

function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') return json(res, 200, { ok: true });
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'GET or POST required' });
  const body = req.method === 'POST' ? await readBody(req) : {};
  const mode = String(req.query.mode || body.mode || 'demo').toLowerCase() === 'live' ? 'live' : 'demo';

  const loaded = loadPrivateKey(mode);
  const result = {
    ok: false,
    mode,
    checks: {
      keyIdFound: Boolean(loaded.keyId),
      privateKeyFound: Boolean(loaded.diagnostics.privateKeyFound),
      privateKeyParsed: Boolean(loaded.keyObject),
      signatureCreated: false,
      authRequestSucceeded: false
    },
    diagnostics: loaded.diagnostics,
    attempts: loaded.attempts,
    notes: []
  };

  if (!loaded.keyId) result.notes.push('Missing API Key ID environment variable.');
  if (!loaded.diagnostics.privateKeyFound) result.notes.push('Missing private key environment variable.');
  if (loaded.diagnostics.selectedHeader && !/PRIVATE KEY/.test(loaded.diagnostics.selectedHeader)) {
    result.notes.push(`Detected header "${loaded.diagnostics.selectedHeader}". Kalshi needs an unencrypted private key.`);
  }

  const path = '/trade-api/v2/portfolio/balance';
  try {
    const auth = headersFor(mode, 'GET', path);
    result.checks.signatureCreated = true;
    result.diagnostics = auth.diagnostics;
    const response = await fetch(rootForMode(mode) + path, {
      method: 'GET',
      headers: { 'Accept': 'application/json', ...auth.headers }
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch { payload = { raw: text.slice(0, 500) }; }
    result.status = response.status;
    result.checks.authRequestSucceeded = response.ok;
    result.ok = response.ok;
    result.response = response.ok ? { balanceSeen: Object.prototype.hasOwnProperty.call(payload, 'balance') } : payload;
    if (!response.ok) result.notes.push('Private key parsed and signed, but Kalshi rejected the authenticated request. Check key ID/private-key pair and Demo vs Live environment.');
    return json(res, response.ok ? 200 : 502, result);
  } catch (err) {
    result.error = err.message;
    result.code = err.code || 'KEY_TEST_FAILED';
    if (err.diagnostics) result.diagnostics = err.diagnostics;
    if (err.attempts) result.attempts = err.attempts;
    return json(res, 500, result);
  }
};
