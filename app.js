const SYMBOLS = {
  BTC: { product: 'BTC-USD', label: 'Bitcoin', ideal: 85, warning: 35, decimals: 0, idealPct: 0.00135 },
  ETH: { product: 'ETH-USD', label: 'Ethereum', ideal: 7.5, warning: 3.2, decimals: 2, idealPct: 0.00175 },
  SOL: { product: 'SOL-USD', label: 'Solana', ideal: 0.62, warning: 0.24, decimals: 3, idealPct: 0.0021 },
  BNB: { product: 'BNB-USD', label: 'BNB', ideal: 2.4, warning: 0.95, decimals: 2, idealPct: 0.0017 },
  XRP: { product: 'XRP-USD', label: 'XRP', ideal: 0.0032, warning: 0.00125, decimals: 4, idealPct: 0.0025 }
};

const MODE_RULES = {
  balanced: { label: 'Balanced Hunter', t7: 80, t6: 70, t4: 63, fallback: 58 },
  sniper: { label: 'Ultra Sniper', t7: 90, t6: 82, t4: 76, fallback: 70 },
  action: { label: 'Action Mode', t7: 72, t6: 62, t4: 55, fallback: 50 },
  perfect: { label: '100% Defense Mode', t7: 90, t6: 82, t4: 86, fallback: 82 }
};

const STORE_KEY = 'edge15-ai-oracle-record-v1';
const LOCK_KEY = 'edge15-ai-oracle-locks-v1';
const MEMORY_KEY = 'edge15-ai-oracle-memory-v1';

const state = {
  mode: 'balanced',
  markets: [],
  activeLocks: load(LOCK_KEY, []),
  record: load(STORE_KEY, { wins: 0, losses: 0, skips: 0, history: [] }),
  memory: load(MEMORY_KEY, {}),
  loading: false,
  lastRoundKey: '',
  abort: null
};

const els = {
  qrImage: document.getElementById('qrImage'),
  refreshNow: document.getElementById('refreshNow'),
  resetRecord: document.getElementById('resetRecord'),
  exportRecord: document.getElementById('exportRecord'),
  modeSelect: document.getElementById('modeSelect'),
  coinSelect: document.getElementById('coinSelect'),
  modePill: document.getElementById('modePill'),
  roundTimer: document.getElementById('roundTimer'),
  bestPick: document.getElementById('bestPick'),
  bestReason: document.getElementById('bestReason'),
  bestScore: document.getElementById('bestScore'),
  bestRisk: document.getElementById('bestRisk'),
  bestWindow: document.getElementById('bestWindow'),
  lockBox: document.getElementById('lockBox'),
  marketGrid: document.getElementById('marketGrid'),
  wins: document.getElementById('wins'),
  losses: document.getElementById('losses'),
  skips: document.getElementById('skips'),
  accuracy: document.getElementById('accuracy'),
  last10: document.getElementById('last10'),
  dataStatus: document.getElementById('dataStatus'),
  updatedAt: document.getElementById('updatedAt'),
  councilList: document.getElementById('councilList'),
  memorySummary: document.getElementById('memorySummary'),
  pendingList: document.getElementById('pendingList')
};

init();

function init() {
  els.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=184x184&data=${encodeURIComponent(location.href)}`;
  els.modeSelect.value = state.mode;
  els.modeSelect.addEventListener('change', () => {
    state.mode = els.modeSelect.value;
    render();
    scan();
  });
  els.refreshNow.addEventListener('click', scan);
  els.exportRecord?.addEventListener('click', exportRecord);
  els.resetRecord.addEventListener('click', () => {
    if (!confirm('Reset all local record and learning memory?')) return;
    state.record = { wins: 0, losses: 0, skips: 0, history: [] };
    state.activeLocks = [];
    state.memory = {};
    save(STORE_KEY, state.record);
    save(LOCK_KEY, state.activeLocks);
    save(MEMORY_KEY, state.memory);
    render();
  });
  setInterval(updateTimerOnly, 1000);
  setInterval(scan, 10000);
  scan();
}


function exportRecord() {
  const payload = {
    app: 'Edge15 AI Oracle',
    version: 'v1-6min-lock-normalized-selector',
    exportedAt: new Date().toISOString(),
    officialRecord: state.record,
    activeLocks: state.activeLocks,
    learningMemory: state.memory,
    selectedMode: state.mode,
    selectedMarkets: selectedSymbols(),
    latestMarkets: state.markets.map(m => ({
      symbol: m.symbol,
      direction: m.direction,
      edgeScore: m.edgeScore,
      selectorScore: m.selectorScore,
      normalizedCushion: m.normalizedCushion,
      pctDistance: m.pctDistance,
      volatilityDistance: m.volatilityDistance,
      defenseBlock: m.defenseBlock || '',
      target: m.target,
      price: m.price,
      closeMs: m.closeMs,
      risk: m.risk,
      status: m.status,
      reasons: m.reasons
    }))
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `edge15-ai-oracle-v1-6min-export-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function selectedSymbols() {
  return Array.from(els.coinSelect.selectedOptions).map((o) => o.value);
}

async function scan() {
  if (state.loading) return;
  state.loading = true;
  state.abort?.abort?.();
  state.abort = new AbortController();
  els.dataStatus.textContent = 'Reading Coinbase + Kalshi...';

  const symbols = selectedSymbols();
  try {
    const rows = await Promise.all(symbols.map(loadMarket));
    state.markets = rows.filter(Boolean).sort((a, b) => b.selectorScore - a.selectorScore || b.edgeScore - a.edgeScore);
    resolvePendingLocks();
    maybeLockBest();
    render();
    els.dataStatus.textContent = 'Live scan complete';
    els.updatedAt.textContent = new Date().toLocaleTimeString();
  } catch (err) {
    console.error(err);
    els.dataStatus.textContent = 'Scan error';
    els.updatedAt.textContent = err.message || 'Unable to read feeds';
  } finally {
    state.loading = false;
  }
}

async function loadMarket(symbol) {
  const meta = SYMBOLS[symbol];
  if (!meta) return null;
  const [coinbase, kalshi] = await Promise.allSettled([
    fetchJson(`/api/coinbase?product=${encodeURIComponent(meta.product)}`),
    fetchJson(`/api/kalshi?symbol=${encodeURIComponent(symbol)}`)
  ]);

  const cb = coinbase.status === 'fulfilled' ? coinbase.value : null;
  const ks = kalshi.status === 'fulfilled' ? kalshi.value?.market : null;
  const price = number(cb?.price ?? cb?.stats?.last);
  const candles = Array.isArray(cb?.candles) ? cb.candles : [];
  const target = number(ks?.target);
  const closeMs = Date.parse(ks?.closeTime || ks?.expirationTime || '') || nextQuarterHour(Date.now());
  const timeRemaining = Math.max(0, closeMs - Date.now());
  const features = analyzeFeatures(symbol, price, target, candles, ks, timeRemaining);
  return { symbol, meta, coinbase: cb, kalshi: ks, price, target, closeMs, timeRemaining, ...features };
}

function analyzeFeatures(symbol, price, target, candles, market, timeRemaining) {
  const meta = SYMBOLS[symbol];
  const closes = candles.map(c => number(c.close)).filter(Number.isFinite);
  const last = closes.at(-1) ?? price;
  const c1 = candles.at(-1) || {};
  const c2 = candles.at(-2) || {};
  const c3 = candles.at(-3) || {};
  const c5 = candles.at(-6) || candles[0] || {};
  const delta1 = pct(last - number(c2.close ?? last), last);
  const delta3 = pct(last - number(c3.close ?? last), last);
  const delta5 = pct(last - number(c5.close ?? last), last);
  const momentum = (delta1 * 0.45) + (delta3 * 0.35) + (delta5 * 0.2);
  const highs = candles.slice(-8).map(c => c.high).filter(Number.isFinite);
  const lows = candles.slice(-8).map(c => c.low).filter(Number.isFinite);
  const localHigh = highs.length ? Math.max(...highs) : price;
  const localLow = lows.length ? Math.min(...lows) : price;
  const range = Math.max(0.000001, localHigh - localLow);
  const rangePos = (price - localLow) / range;
  const body = Math.abs(number(c1.close) - number(c1.open));
  const candleRange = Math.max(0.000001, number(c1.high) - number(c1.low));
  const bodyRatio = body / candleRange;
  const upperWick = Math.max(0, number(c1.high) - Math.max(number(c1.open), number(c1.close))) / candleRange;
  const lowerWick = Math.max(0, Math.min(number(c1.open), number(c1.close)) - number(c1.low)) / candleRange;
  const targetDistance = Number.isFinite(price) && Number.isFinite(target) ? price - target : null;
  const absDistance = Math.abs(targetDistance ?? 0);
  const targetSide = !Number.isFinite(targetDistance) ? 'SKIP' : targetDistance >= 0 ? 'OVER' : 'UNDER';
  const recentMoves = candles.slice(-14).map((c, i, arr) => {
    if (i === 0) return NaN;
    const prev = number(arr[i - 1]?.close);
    const cur = number(c?.close);
    return Number.isFinite(prev) && Number.isFinite(cur) ? Math.abs(cur - prev) : NaN;
  }).filter(Number.isFinite);
  const avgAbsMove = recentMoves.length ? recentMoves.reduce((a, b) => a + b, 0) / recentMoves.length : meta.warning;
  const pctDistance = Number.isFinite(target) && Math.abs(target) > 0 ? absDistance / Math.abs(target) : 0;
  const pctUnits = meta.idealPct ? pctDistance / meta.idealPct : absDistance / meta.ideal;
  const volatilityDistance = absDistance / Math.max(avgAbsMove * 2.2, meta.warning * 0.55, 0.000001);
  const normalizedCushion = clamp((pctUnits * 0.55) + (volatilityDistance * 0.45), 0, 2.1);
  const momentumSide = momentum > 0.008 ? 'OVER' : momentum < -0.008 ? 'UNDER' : 'WAIT';
  const trendSide = rangePos > 0.66 ? 'OVER' : rangePos < 0.34 ? 'UNDER' : 'WAIT';
  const wickSide = upperWick > 0.42 && number(c1.close) < number(c1.open) ? 'UNDER' : lowerWick > 0.42 && number(c1.close) > number(c1.open) ? 'OVER' : 'WAIT';
  const oddsSide = oddsLean(market);
  const direction = chooseDirection(targetSide, momentumSide, trendSide, wickSide, oddsSide);

  const timeMin = timeRemaining / 60000;
  const rawCushionScore = clamp((absDistance / meta.ideal) * 27, 0, 27);
  const normalizedCushionScore = clamp(normalizedCushion * 14, 0, 27);
  const cushionScore = (rawCushionScore * 0.35) + (normalizedCushionScore * 0.65);
  const momentumScore = clamp(Math.abs(momentum) * 620, 0, 18);
  const bodyScore = clamp(bodyRatio * 13, 0, 13);
  const structureScore = direction === trendSide ? 8 : trendSide === 'WAIT' ? 4 : 1;
  const oddsScore = oddsSide === direction ? 5 : oddsSide === 'WAIT' ? 2.5 : 0;
  const memory = memoryBoost(symbol, direction, absDistance, timeMin);
  const settlementPenalty = settlementDanger(absDistance, meta, timeMin);
  const chopPenalty = (momentumSide === 'WAIT' ? 7 : 0) + (targetSide !== 'SKIP' && targetSide !== direction ? 8 : 0) + (bodyRatio < 0.24 ? 5 : 0);
  const wickPenalty = ((direction === 'OVER' && upperWick > 0.45) || (direction === 'UNDER' && lowerWick > 0.45)) ? 8 : 0;
  const apiPenalty = (!Number.isFinite(target) ? 20 : 0) + (!Number.isFinite(price) ? 40 : 0);

  let edgeScore = Math.round(clamp(35 + cushionScore + momentumScore + bodyScore + structureScore + oddsScore + memory - settlementPenalty - chopPenalty - wickPenalty - apiPenalty, 0, 99));
  if (direction === 'WAIT' || direction === 'SKIP') edgeScore = Math.min(edgeScore, 59);
  const selectorScore = Math.round(clamp(
    edgeScore
    + clamp((normalizedCushion - 1) * 8, -7, 7)
    + (direction === momentumSide ? 3 : momentumSide === 'WAIT' ? -2 : -6)
    + (direction === trendSide ? 2 : trendSide === 'WAIT' ? 0 : -4)
    - (settlementPenalty > 10 ? 4 : 0),
    0,
    99
  ));

  const risk = edgeScore >= 82 && settlementPenalty < 8 ? 'Low' : edgeScore >= 68 ? 'Medium' : 'High';
  const distanceBand = distanceBandFor(symbol, absDistance);
  const defenseBlock = perfectDefenseBlock({ symbol, direction, edgeScore, risk, distanceBand, timeMin, momentumSide, trendSide, wickSide, settlementPenalty, bodyRatio });
  const status = lockStatus(edgeScore, timeMin, defenseBlock);
  const reasons = buildReasons({ symbol, direction, targetSide, momentumSide, trendSide, wickSide, oddsSide, absDistance, meta, momentum, bodyRatio, settlementPenalty, edgeScore, selectorScore, normalizedCushion, pctDistance, volatilityDistance, target, price, defenseBlock });
  const council = [
    { name: 'Genesis Balanced', vote: targetSide, note: Number.isFinite(target) ? `${formatSigned(targetDistance, meta.decimals)} from target` : 'No target yet' },
    { name: 'Momentum Hunter', vote: momentumSide, note: `${(momentum * 100).toFixed(3)}% weighted move` },
    { name: 'Reversal Detector', vote: wickSide, note: wickSide === 'WAIT' ? 'No major wick reversal' : 'Wick rejection detected' },
    { name: 'Settlement Guard', vote: settlementPenalty > 12 ? 'SKIP' : direction, note: `Settlement risk ${Math.round(settlementPenalty)}/20` },
    { name: 'Kalshi Odds Reader', vote: oddsSide, note: market ? oddsText(market) : 'No odds data' },
    { name: 'Historical Match', vote: memory > 0 ? direction : 'WAIT', note: `${memory >= 0 ? '+' : ''}${memory.toFixed(1)} memory boost` },
    { name: 'Normalized Selector', vote: selectorScore >= edgeScore ? direction : 'WAIT', note: `${selectorScore}/100 selector • ${(pctDistance * 100).toFixed(3)}% cushion • ${volatilityDistance.toFixed(2)}x recent move` }
  ];

  return { edgeScore, selectorScore, normalizedCushion, pctDistance, volatilityDistance, rawCushionScore, normalizedCushionScore, direction, risk, status, reasons, council, momentum, momentumSide, trendSide, wickSide, rangePos, bodyRatio, upperWick, lowerWick, targetDistance, absDistance, distanceBand, settlementPenalty, defenseBlock }; 
}

function chooseDirection(...votes) {
  let over = 0;
  let under = 0;
  votes.forEach((vote, idx) => {
    const weight = idx === 0 ? 2.2 : idx === 1 ? 1.45 : idx === 2 ? 1.0 : idx === 3 ? 1.15 : .65;
    if (vote === 'OVER') over += weight;
    if (vote === 'UNDER') under += weight;
  });
  if (over - under > 0.8) return 'OVER';
  if (under - over > 0.8) return 'UNDER';
  return 'WAIT';
}

function oddsLean(market) {
  if (!market) return 'WAIT';
  const yes = number(market.yesAsk ?? market.lastPrice);
  const no = number(market.noAsk);
  if (Number.isFinite(yes) && Number.isFinite(no)) {
    if (yes <= 42 && no >= 58) return 'OVER';
    if (no <= 42 && yes >= 58) return 'UNDER';
  }
  if (Number.isFinite(yes)) {
    if (yes >= 62) return 'OVER';
    if (yes <= 38) return 'UNDER';
  }
  return 'WAIT';
}

function oddsText(market) {
  const parts = [];
  if (Number.isFinite(number(market.yesBid)) || Number.isFinite(number(market.yesAsk))) parts.push(`Yes ${market.yesBid ?? '--'}/${market.yesAsk ?? '--'}`);
  if (Number.isFinite(number(market.noBid)) || Number.isFinite(number(market.noAsk))) parts.push(`No ${market.noBid ?? '--'}/${market.noAsk ?? '--'}`);
  return parts.join(' • ') || 'Odds unavailable';
}

function distanceBandFor(symbol, absDistance) {
  const meta = SYMBOLS[symbol];
  if (!meta || !Number.isFinite(absDistance)) return 'unknown';
  if (absDistance > meta.ideal) return 'far';
  if (absDistance > meta.warning) return 'mid';
  return 'close';
}

function perfectDefenseBlock(input) {
  if (state.mode !== 'perfect') return '';
  const { symbol, direction, edgeScore, risk, distanceBand, timeMin, momentumSide, trendSide, wickSide, settlementPenalty, bodyRatio } = input;
  if (!['OVER', 'UNDER'].includes(direction)) return 'no clear OVER/UNDER direction';
  if (risk !== 'Low') return 'risk is not Low';
  if (distanceBand !== 'far') return 'distance is not far enough';
  if (momentumSide !== direction) return 'momentum is not confirming';
  if (trendSide !== direction) return 'local range position is not confirming';
  if (wickSide !== 'WAIT' && wickSide !== direction) return 'wick/reversal risk detected';
  if (settlementPenalty > 6) return 'settlement risk is too high';
  if (bodyRatio < 0.30) return 'candle bodies suggest chop';
  if (timeMin <= 4 && edgeScore < 86) return 'late 4:00 lock needs 86+ score';
  if (symbol === 'BTC' && edgeScore < 84) return 'BTC needs extra cushion in Defense Mode';
  return '';
}

function settlementDanger(absDistance, meta, timeMin) {
  if (!Number.isFinite(absDistance)) return 20;
  const closeness = clamp(1 - absDistance / meta.warning, 0, 1);
  const timePressure = timeMin < 5 ? (5 - timeMin) / 5 : 0;
  return clamp(closeness * 15 + timePressure * 8, 0, 22);
}

function lockStatus(score, timeMin, defenseBlock = '') {
  const rules = MODE_RULES[state.mode];
  if (state.mode === 'perfect' && defenseBlock) return '100% Defense blocked';
  if (timeMin > 7) return score >= rules.t7 + 8 ? 'Elite early watch' : 'Observe';
  if (timeMin <= 7 && timeMin > 6) return score >= rules.t7 ? '7:00 elite lock eligible' : 'Wait';
  if (timeMin <= 6 && timeMin > 4) return score >= rules.t6 ? '6:00 main lock eligible' : 'Wait';
  if (timeMin <= 4 && timeMin > 2.8) return score >= rules.t4 ? '4:00 confirmation eligible' : 'Late watch';
  if (timeMin <= 2.8) return score >= rules.t7 ? 'Emergency only' : 'Too late';
  return 'Wait';
}

function buildReasons(input) {
  const { direction, targetSide, momentumSide, trendSide, wickSide, oddsSide, absDistance, meta, momentum, bodyRatio, settlementPenalty, edgeScore, selectorScore, normalizedCushion, pctDistance, volatilityDistance, target, price, defenseBlock } = input;
  const reasons = [];
  if (!Number.isFinite(price)) reasons.push('Coinbase price feed unavailable.');
  if (!Number.isFinite(target)) reasons.push('Kalshi target not detected yet; app will keep scanning.');
  if (Number.isFinite(target)) reasons.push(`${direction} lean: price is ${format(absDistance, meta.decimals)} away from Kalshi target.`);
  if (Number.isFinite(normalizedCushion)) reasons.push(`Normalized selector: ${(pctDistance * 100).toFixed(3)}% cushion, ${volatilityDistance.toFixed(2)}x recent move, selector score ${selectorScore}.`);
  if (momentumSide === direction) reasons.push('Momentum agrees with the target-side read.');
  else if (momentumSide === 'WAIT') reasons.push('Momentum is not strong yet.');
  else reasons.push('Momentum is fighting the target-side read.');
  if (trendSide === direction) reasons.push('Local range position supports the pick.');
  if (wickSide !== 'WAIT') reasons.push(`${wickSide} wick/rejection signal detected.`);
  if (oddsSide === direction) reasons.push('Kalshi pricing agrees with the chart lean.');
  if (settlementPenalty > 10) reasons.push('Settlement/flip risk is elevated because price is close to target or time is late.');
  if (bodyRatio < 0.24) reasons.push('Small candle bodies suggest chop; confidence reduced.');
  if (edgeScore >= 80) reasons.push('Strong enough for an early Balanced Hunter lock window if timing allows.');
  if (state.mode === 'perfect' && defenseBlock) reasons.push(`100% Defense blocked: ${defenseBlock}.`);
  if (state.mode === 'perfect' && !defenseBlock && ['OVER', 'UNDER'].includes(direction)) reasons.push('100% Defense Mode has not found a block on this setup.');
  return reasons.slice(0, 6);
}

function maybeLockBest() {
  if (!state.markets.length) return;
  const best = state.markets[0];
  const roundKey = getRoundKey(best.closeMs);
  state.lastRoundKey = roundKey;
  const already = state.activeLocks.find(l => l.roundKey === roundKey && l.status === 'pending');
  if (already) return;

  const skipAlready = state.record.history.find(h => h.roundKey === roundKey && h.result === 'S');
  if (skipAlready) return;

  const timeMin = best.timeRemaining / 60000;
  const rules = MODE_RULES[state.mode];
  let threshold = Infinity;
  let window = '';
  if (timeMin <= 7 && timeMin > 6) { threshold = rules.t7; window = '7:00'; }
  else if (timeMin <= 6 && timeMin > 4) { threshold = rules.t6; window = '6:00'; }
  else if (timeMin <= 4 && timeMin > 2.8) { threshold = rules.t4; window = '4:00'; }

  const defenseBlocked = state.mode === 'perfect' && Boolean(best.defenseBlock);

  if (!defenseBlocked && best.edgeScore >= threshold && ['OVER', 'UNDER'].includes(best.direction)) {
    const lock = {
      id: `${roundKey}-${best.symbol}-${Date.now()}`,
      roundKey,
      marketTicker: best.kalshi?.ticker,
      symbol: best.symbol,
      pick: best.direction,
      score: best.edgeScore,
      selectorScore: best.selectorScore,
      risk: best.risk,
      window,
      target: best.target,
      priceAtLock: best.price,
      closeMs: best.closeMs,
      lockedAt: Date.now(),
      reason: best.reasons.join(' '),
      setupKey: setupKey(best.symbol, best.direction, best.absDistance, timeMin),
      defenseMode: state.mode === 'perfect',
      defenseBlock: best.defenseBlock || '',
      status: 'pending'
    };
    state.activeLocks.unshift(lock);
    save(LOCK_KEY, state.activeLocks.slice(0, 50));
  } else if (timeMin <= 2.8 && !skipAlready) {
    state.record.skips += 1;
    state.record.history.unshift({ roundKey, result: 'S', symbol: 'ALL', pick: 'SKIP', ts: Date.now(), note: 'No market passed lock threshold.' });
    state.record.history = state.record.history.slice(0, 250);
    save(STORE_KEY, state.record);
  }
}

async function resolvePendingLocks() {
  const pending = state.activeLocks.filter(l => l.status === 'pending' && l.marketTicker && Date.now() > l.closeMs + 35000);
  for (const lock of pending.slice(0, 5)) {
    try {
      const data = await fetchJson(`/api/kalshi-market?ticker=${encodeURIComponent(lock.marketTicker)}`);
      const m = data?.market || {};
      let outcome = null;
      if (m.result === 'yes') outcome = 'OVER';
      if (m.result === 'no') outcome = 'UNDER';
      if (!outcome && Number.isFinite(number(m.expirationValue)) && Number.isFinite(number(lock.target))) {
        outcome = number(m.expirationValue) >= number(lock.target) ? 'OVER' : 'UNDER';
      }
      if (outcome) markLock(lock.id, outcome === lock.pick ? 'W' : 'L', outcome, m.expirationValue ?? m.expirationValueRaw);
    } catch (err) {
      console.warn('Pending resolve failed', err);
    }
  }
}

function markLock(id, result, actual, finalValue) {
  const lock = state.activeLocks.find(l => l.id === id);
  if (!lock || lock.status !== 'pending') return;
  lock.status = result === 'W' ? 'win' : result === 'L' ? 'loss' : 'skip';
  lock.actual = actual;
  lock.finalValue = finalValue;
  lock.resolvedAt = Date.now();
  if (result === 'W') state.record.wins += 1;
  else if (result === 'L') state.record.losses += 1;
  else state.record.skips += 1;
  state.record.history.unshift({
    roundKey: lock.roundKey,
    result,
    symbol: lock.symbol,
    pick: lock.pick,
    actual,
    score: lock.score,
    window: lock.window,
    ts: Date.now(),
    setupKey: lock.setupKey
  });
  state.record.history = state.record.history.slice(0, 250);
  updateMemory(lock.setupKey, result === 'W');
  save(STORE_KEY, state.record);
  save(LOCK_KEY, state.activeLocks.slice(0, 50));
  save(MEMORY_KEY, state.memory);
  render();
}

function updateMemory(key, win) {
  if (!key) return;
  const item = state.memory[key] || { wins: 0, losses: 0 };
  if (win) item.wins += 1;
  else item.losses += 1;
  state.memory[key] = item;
}

function memoryBoost(symbol, direction, absDistance, timeMin) {
  const key = setupKey(symbol, direction, absDistance, timeMin);
  const item = state.memory[key];
  if (!item) return 0;
  const total = item.wins + item.losses;
  if (total < 3) return 0;
  const rate = item.wins / total;
  return clamp((rate - 0.55) * 18, -8, 8);
}

function setupKey(symbol, direction, absDistance, timeMin) {
  const d = distanceBandFor(symbol, absDistance);
  const t = timeMin > 6 ? 't7' : timeMin > 4 ? 't6' : 't4';
  return `${symbol}:${direction}:${d}:${t}`;
}

function render() {
  const rules = MODE_RULES[state.mode];
  els.modePill.textContent = rules.label;
  renderRecord();
  renderMarkets();
  renderBest();
  renderCouncil();
  renderMemory();
  renderPending();
  updateTimerOnly();
}

function renderBest() {
  const best = state.markets[0];
  const pending = state.activeLocks.find(l => l.roundKey === state.lastRoundKey && l.status === 'pending');
  els.lockBox.classList.toggle('locked', Boolean(pending));
  els.lockBox.classList.toggle('waiting', !pending);

  if (pending) {
    els.bestPick.textContent = `LOCKED ${pending.symbol} ${pending.pick}`;
    els.bestReason.textContent = pending.reason || `Official ${pending.window} lock. Waiting for result.`;
    els.bestScore.textContent = pending.score;
    els.bestRisk.textContent = pending.risk;
    els.bestWindow.textContent = pending.window;
    return;
  }
  if (!best) {
    els.bestPick.textContent = 'Scanning...';
    els.bestReason.textContent = 'Waiting for live feeds.';
    els.bestScore.textContent = '--';
    els.bestRisk.textContent = '--';
    els.bestWindow.textContent = '--';
    return;
  }
  const word = best.direction === 'WAIT' ? 'WAIT' : best.direction === 'SKIP' ? 'SKIP' : best.direction;
  els.bestPick.textContent = `${best.symbol} ${word}`;
  els.bestReason.textContent = best.reasons.join(' ');
  els.bestScore.textContent = best.edgeScore;
  els.bestRisk.textContent = best.risk;
  els.bestWindow.textContent = best.status;
}

function renderMarkets() {
  els.marketGrid.innerHTML = '';
  state.markets.forEach((m, idx) => {
    const card = document.createElement('article');
    card.className = `market-card ${idx === 0 ? 'best' : ''}`;
    card.innerHTML = `
      <div class="market-top">
        <div>
          <h4>${m.symbol}</h4>
          <span class="muted">${m.meta.label}</span>
        </div>
        <span class="rank">#${idx + 1}</span>
      </div>
      <div class="pick-line">
        <span class="pick ${m.direction.toLowerCase()}">${m.direction}</span>
        <span class="pill">${m.selectorScore}/100 selector • ${m.edgeScore}/100 edge</span>
      </div>
      <div class="edge-meter"><span style="width:${m.selectorScore}%"></span></div>
      <div class="metrics">
        <div class="metric"><b>${formatMoney(m.price, m.meta.decimals)}</b><small>Coinbase spot</small></div>
        <div class="metric"><b>${formatMoney(m.target, m.meta.decimals)}</b><small>Kalshi target</small></div>
        <div class="metric"><b>${formatSigned(m.targetDistance, m.meta.decimals)}</b><small>Distance</small></div>
        <div class="metric"><b>${(m.pctDistance * 100).toFixed(3)}%</b><small>Normalized cushion</small></div>
        <div class="metric"><b>${m.status}</b><small>Status</small></div>
        <div class="metric"><b>${m.kalshi?.yesBid ?? '--'}/${m.kalshi?.yesAsk ?? '--'}</b><small>Yes bid/ask</small></div>
        <div class="metric"><b>${m.kalshi?.noBid ?? '--'}/${m.kalshi?.noAsk ?? '--'}</b><small>No bid/ask</small></div>
      </div>
      <canvas class="spark" width="420" height="92" data-symbol="${m.symbol}"></canvas>
      <ul class="market-reasons">${m.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    `;
    els.marketGrid.appendChild(card);
    drawSpark(card.querySelector('canvas'), m.coinbase?.candles || [], m.target);
  });
}

function renderCouncil() {
  const best = state.markets[0];
  const list = best?.council || [];
  els.councilList.innerHTML = list.map(row => `
    <div class="council-row">
      <div><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.note)}</span></div>
      <strong class="${row.vote.toLowerCase()}">${row.vote}</strong>
    </div>
  `).join('') || '<p class="small-note">No council data yet.</p>';
}

function renderMemory() {
  const items = Object.entries(state.memory)
    .map(([key, v]) => ({ key, ...v, total: v.wins + v.losses, rate: v.wins / Math.max(1, v.wins + v.losses) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
  if (!items.length) {
    els.memorySummary.innerHTML = '<p class="small-note">No learned setup history yet. It will adapt after completed locks.</p>';
    return;
  }
  els.memorySummary.innerHTML = items.map(item => `
    <div class="memory-item"><span>${escapeHtml(item.key)}</span><strong>${Math.round(item.rate * 100)}% (${item.wins}-${item.losses})</strong></div>
  `).join('');
}

function renderPending() {
  const pending = state.activeLocks.filter(l => l.status === 'pending').slice(0, 8);
  if (!pending.length) {
    els.pendingList.innerHTML = '<p class="small-note">No pending official locks.</p>';
    return;
  }
  els.pendingList.innerHTML = pending.map(lock => `
    <div class="pending-item">
      <div><strong>${lock.symbol} ${lock.pick}</strong><span>${lock.window} • ${lock.score}/100 • closes ${new Date(lock.closeMs).toLocaleTimeString()}</span></div>
      <div class="pending-actions">
        <button data-result="W" data-id="${lock.id}">Win</button>
        <button data-result="L" data-id="${lock.id}">Loss</button>
        <button data-result="S" data-id="${lock.id}">Skip</button>
      </div>
    </div>
  `).join('');
  els.pendingList.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => markLock(btn.dataset.id, btn.dataset.result, 'manual', null)));
}

function renderRecord() {
  const { wins, losses, skips, history } = state.record;
  els.wins.textContent = wins;
  els.losses.textContent = losses;
  els.skips.textContent = skips;
  const total = wins + losses;
  els.accuracy.textContent = total ? `${Math.round((wins / total) * 1000) / 10}%` : '--';
  const last = history.slice(0, 10);
  els.last10.innerHTML = last.map(h => `<span title="${h.symbol} ${h.pick || ''}" class="dot ${h.result === 'W' ? 'win' : h.result === 'L' ? 'loss' : 'skip'}">${h.result}</span>`).join('');
}

function updateTimerOnly() {
  const closeMs = state.markets[0]?.closeMs || nextQuarterHour(Date.now());
  els.roundTimer.textContent = formatTime(Math.max(0, closeMs - Date.now()));
}

function drawSpark(canvas, candles, target) {
  if (!canvas || !candles.length) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const values = candles.slice(-40).map(c => c.close).filter(Number.isFinite);
  if (!values.length) return;
  const min = Math.min(...values, Number.isFinite(target) ? target : Infinity);
  const max = Math.max(...values, Number.isFinite(target) ? target : -Infinity);
  const pad = Math.max((max - min) * .12, 0.000001);
  const y = (v) => h - ((v - (min - pad)) / ((max + pad) - (min - pad))) * h;
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#66a6ff';
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * w;
    if (i === 0) ctx.moveTo(x, y(v));
    else ctx.lineTo(x, y(v));
  });
  ctx.stroke();
  if (Number.isFinite(target)) {
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, y(target));
    ctx.lineTo(w, y(target));
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: 'no-store', signal: state.abort?.signal });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function number(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }
function clamp(v, min, max) { return Math.max(min, Math.min(max, Number.isFinite(v) ? v : min)); }
function pct(delta, base) { return Number.isFinite(delta) && Number.isFinite(base) && base ? delta / base : 0; }
function nextQuarterHour(ms) { const d = new Date(ms); d.setSeconds(0, 0); const m = d.getMinutes(); d.setMinutes(Math.floor(m / 15) * 15 + 15); return d.getTime(); }
function getRoundKey(closeMs) { return new Date(closeMs).toISOString().slice(0, 16); }
function formatTime(ms) { const s = Math.ceil(ms / 1000); const m = Math.floor(s / 60); const r = String(s % 60).padStart(2, '0'); return `${m}:${r}`; }
function format(v, decimals = 2) { return Number.isFinite(number(v)) ? number(v).toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals > 0 ? Math.min(decimals, 2) : 0 }) : '--'; }
function formatMoney(v, decimals = 2) { return Number.isFinite(number(v)) ? `$${format(v, decimals)}` : '--'; }
function formatSigned(v, decimals = 2) { if (!Number.isFinite(number(v))) return '--'; const n = number(v); return `${n >= 0 ? '+' : ''}${format(n, decimals)}`; }
function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
