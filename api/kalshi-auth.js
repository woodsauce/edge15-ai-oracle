const crypto = require('crypto');

function rootForMode(mode) {
  return mode === 'live'
    ? 'https://external-api.kalshi.com'
    : 'https://external-api.demo.kalshi.co';
}

function envNames(mode) {
  const live = mode === 'live';
  return {
    keyId: live ? 'KALSHI_LIVE_KEY_ID' : 'KALSHI_DEMO_KEY_ID',
    privateKey: live ? 'KALSHI_LIVE_PRIVATE_KEY' : 'KALSHI_DEMO_PRIVATE_KEY',
    privateKeyB64: live ? 'KALSHI_LIVE_PRIVATE_KEY_B64' : 'KALSHI_DEMO_PRIVATE_KEY_B64'
  };
}

function stripWrappingQuotes(value) {
  const s = String(value || '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function decodeBase64Maybe(value) {
  const s = stripWrappingQuotes(value);
  if (!s) return '';
  return Buffer.from(s, 'base64').toString('utf8').trim();
}

function normalizePem(value) {
  let s = stripWrappingQuotes(value)
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  // Sometimes Vercel copy/paste leaves a PEM as one long line with spaces.
  // Rebuild the common unencrypted PEM types into clean 64-char wrapped body lines.
  const oneLine = s.replace(/\s+/g, ' ');
  const match = oneLine.match(/-----BEGIN ([A-Z ]*PRIVATE KEY)-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END \1-----/);
  if (match) {
    const label = match[1];
    const body = match[2].replace(/\s+/g, '');
    const wrapped = body.match(/.{1,64}/g)?.join('\n') || body;
    s = `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----`;
  }
  return s;
}

function keyHeader(pem) {
  const first = String(pem || '').split('\n').find(Boolean) || '';
  const m = first.match(/-----BEGIN ([^-]+)-----/);
  return m ? `BEGIN ${m[1]}` : first.slice(0, 64);
}

function loadPrivateKey(mode) {
  const names = envNames(mode);
  const keyId = String(process.env[names.keyId] || '').trim();
  const b64Value = process.env[names.privateKeyB64];
  const rawValue = process.env[names.privateKey];
  const attempts = [];

  const candidates = [];
  if (b64Value) {
    candidates.push({ source: names.privateKeyB64, pem: normalizePem(decodeBase64Maybe(b64Value)) });
  }
  if (rawValue) {
    const raw = stripWrappingQuotes(rawValue);
    candidates.push({ source: names.privateKey, pem: normalizePem(raw) });
    // If the raw variable is actually a base64-encoded PEM, try it too.
    if (!raw.includes('-----BEGIN') && /^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.length > 200) {
      candidates.push({ source: `${names.privateKey} as base64`, pem: normalizePem(decodeBase64Maybe(raw)) });
    }
  }

  for (const candidate of candidates) {
    const pem = candidate.pem || '';
    const attempt = {
      source: candidate.source,
      length: pem.length,
      header: keyHeader(pem),
      hasBegin: pem.includes('-----BEGIN'),
      hasEnd: pem.includes('-----END')
    };
    try {
      const keyObject = crypto.createPrivateKey({ key: pem });
      attempt.parse = 'pass';
      attempts.push(attempt);
      return {
        keyId,
        keyObject,
        pem,
        source: candidate.source,
        attempts,
        diagnostics: {
          mode,
          keyIdName: names.keyId,
          keyIdFound: Boolean(keyId),
          keyIdSuffix: keyId ? keyId.slice(-6) : '',
          privateKeyFound: Boolean(rawValue || b64Value),
          selectedSource: candidate.source,
          selectedHeader: attempt.header,
          selectedLength: attempt.length
        }
      };
    } catch (err) {
      attempt.parse = 'fail';
      attempt.error = err.message;
      attempts.push(attempt);
    }
  }

  return {
    keyId,
    keyObject: null,
    pem: '',
    source: '',
    attempts,
    diagnostics: {
      mode,
      keyIdName: names.keyId,
      keyIdFound: Boolean(keyId),
      keyIdSuffix: keyId ? keyId.slice(-6) : '',
      privateKeyFound: Boolean(rawValue || b64Value),
      selectedSource: '',
      selectedHeader: '',
      selectedLength: 0
    }
  };
}

function signRequest(keyObject, timestamp, method, path) {
  const pathOnly = String(path || '').split('?')[0];
  const msg = Buffer.from(`${timestamp}${String(method).toUpperCase()}${pathOnly}`, 'utf8');
  return crypto.sign('sha256', msg, {
    key: keyObject,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST
  }).toString('base64');
}

function headersFor(mode, method, path) {
  const loaded = loadPrivateKey(mode);
  if (!loaded.keyId) {
    const err = new Error(`${mode.toUpperCase()} Kalshi API key ID is not configured`);
    err.code = 'MISSING_KEY_ID';
    err.diagnostics = loaded.diagnostics;
    err.attempts = loaded.attempts;
    throw err;
  }
  if (!loaded.keyObject) {
    const err = new Error(`${mode.toUpperCase()} Kalshi private key could not be decoded`);
    err.code = 'PRIVATE_KEY_DECODE_FAILED';
    err.diagnostics = loaded.diagnostics;
    err.attempts = loaded.attempts;
    throw err;
  }
  const timestamp = String(Date.now());
  const signature = signRequest(loaded.keyObject, timestamp, method, path);
  return {
    headers: {
      'KALSHI-ACCESS-KEY': loaded.keyId,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'KALSHI-ACCESS-SIGNATURE': signature
    },
    diagnostics: loaded.diagnostics,
    attempts: loaded.attempts
  };
}

module.exports = {
  rootForMode,
  envNames,
  loadPrivateKey,
  signRequest,
  headersFor
};
