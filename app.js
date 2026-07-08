const SYMBOLS = {
  BTC: { product: 'BTC-USD', label: 'Bitcoin', ideal: 85, warning: 35, decimals: 0 },
  ETH: { product: 'ETH-USD', label: 'Ethereum', ideal: 7.5, warning: 3.2, decimals: 2 },
  SOL: { product: 'SOL-USD', label: 'Solana', ideal: 0.62, warning: 0.24, decimals: 3 },
  BNB: { product: 'BNB-USD', label: 'BNB', ideal: 2.4, warning: 0.95, decimals: 2 },
  XRP: { product: 'XRP-USD', label: 'XRP', ideal: 0.011, warning: 0.0045, decimals: 5 }
};

const MODE_RULES = {
  balanced: { label: 'Balanced Hunter', t7: 80, t530: 70, t4: 63, fallback: 58 },
  sniper: { label: 'Ultra Sniper', t7: 90, t530: 82, t4: 76, fallback: 70 },
  action: { label: 'Action Mode', t7: 72, t530: 62, t4: 55, fallback: 50 }
};

const STORE_KEY = 'edge15-ai-oracle-record-v1';
const LOCK_KEY = 'edge15-ai-oracle-locks-v1';
const MEMORY_KEY = 'edge15-ai-oracle-memory-v1';
const SCOUT_KEY = 'edge15-ai-oracle-scout-v2';
const MAX_HISTORY = 500;

const state = {
  mode: 'balanced',
  markets: [],
  activeLocks: load(LOCK_KEY, []),
  record: load(STORE_KEY, { wins: 0, losses: 0, skips: 0, history: [] }),
  memory: load(MEMORY_KEY, {}),
  scout: load(SCOUT_KEY, { snapshots: [] }),
  loading: false,
  lastRoundKey: '',
  currentForecast: null,
  abort: null,
  scanTimer: null
};

const els = {
  qrImage: document.getElementById('qrImage'),
  refreshNow: document.getElementById('refreshNow'),
  resetRecord: document.getElementById('resetRecord'),
  exportAll: document.getElementById('exportAll'),
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
  likelyBox: document.getElementById('likelyBox'),
  likelyPick: document.getElementById('likelyPick'),
  likelyProb: document.getElementById('likelyProb'),
  likelyWindow: document.getElementById('likelyWindow'),
  earlyRisk: document.getElementById('earlyRisk'),
  earlyReason: document.getElementById('earlyReason'),
  earlyEntryAction: document.getElementById('earlyEntryAction'),
  scoutWins: document.getElementById('scoutWins'),
  scoutLosses: document.getElementById('scoutLosses'),
  scoutFades: document.getElementById('scoutFades'),
  scoutAccuracy: document.getElementById('scoutAccuracy'),
  marketGrid: document.getElementById('marketGrid'),
  wins: document.getElementById('wins'),
  losses: document.getElementById('losses'),
  skips: document.getElementById('skips'),
  accuracy: document.getElementById('accuracy'),
  pickRate: document.getElementById('pickRate'),
  last10: document.getElementById('last10'),
  dataStatus: document.getElementById('dataStatus'),
  updatedAt: document.getElementById('updatedAt'),
  councilList: document.getElementById('councilList'),
  memorySummary: document.getElementById('memorySummary'),
  pendingList: document.getElementById('pendingList'),
  roundScoutList: document.getElementById('roundScoutList'),
  scoutList: document.getElementById('scoutList')
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
  els.exportAll.addEventListener('click', exportAllData);
  els.resetRecord.addEventListener('click', () => {
    if (!confirm('Reset official record, pending locks, learning memory, and early scout history in this browser?')) return;
    state.record = { wins: 0, losses: 0, skips: 0, history: [] };
    state.activeLocks = [];
    state.memory = {};
    state.scout = { snapshots: [] };
    save(STORE_KEY, state.record);
    save(LOCK_KEY, state.activeLocks);
    save(MEMORY_KEY, state.memory);
    save(SCOUT_KEY, state.scout);
    render();
  });
  setInterval(updateTimerOnly, 1000);
  scheduleNextScan(150);
}

function selectedSymbols() {
  return Array.from(els.coinSelect.selectedOptions).map((o) => o.value);
}

function scheduleNextScan(delayMs = adaptiveRefreshMs()) {
  clearTimeout(state.scanTimer);
  state.scanTimer = setTimeout(async () => {
    await scan();
    scheduleNextScan();
  }, delayMs);
}

function adaptiveRefreshMs() {
  const timeMin = (state.markets[0]?.timeRemaining ?? 15 * 60000) / 60000;
  if (timeMin <= 1.1) return 1000;
  if (timeMin <= 4) return 2000;
  if (timeMin <= 7) return 3000;
  if (timeMin <= 10) return 5000;
  return 10000;
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
    state.markets = rows.filter(Boolean).sort((a, b) => b.edgeScore - a.edgeScore);
    await resolvePendingLocks();
    await resolveScoutSnapshots();
    updateForecastAndScout();
    maybeLockBest();
    render();
    els.dataStatus.textContent = `Live scan complete • next refresh ${Math.round(adaptiveRefreshMs() / 1000)}s`;
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
  if (!ks?.ticker) return null;

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
  const cleanCandles = candles.filter(c => Number.isFinite(number(c.close)));
  const closes = cleanCandles.map(c => number(c.close));
  const last = closes.at(-1) ?? price;
  const c1 = cleanCandles.at(-1) || { open: last, high: last, low: last, close: last };
  const c2 = cleanCandles.at(-2) || c1;
  const c3 = cleanCandles.at(-3) || c2;
  const c5 = cleanCandles.at(-6) || cleanCandles[0] || c1;
  const c1open = number(c1.open);
  const c1high = number(c1.high);
  const c1low = number(c1.low);
  const c1close = number(c1.close);
  const delta1 = pct(last - number(c2.close ?? last), last);
  const delta3 = pct(last - number(c3.close ?? last), last);
  const delta5 = pct(last - number(c5.close ?? last), last);
  const momentum = (delta1 * 0.45) + (delta3 * 0.35) + (delta5 * 0.2);
  const highs = cleanCandles.slice(-8).map(c => number(c.high)).filter(Number.isFinite);
  const lows = cleanCandles.slice(-8).map(c => number(c.low)).filter(Number.isFinite);
  const localHigh = highs.length ? Math.max(...highs) : price;
  const localLow = lows.length ? Math.min(...lows) : price;
  const range = Math.max(0.000001, number(localHigh) - number(localLow));
  const rangePos = Number.isFinite(price) ? (price - localLow) / range : 0.5;
  const body = Math.abs(c1close - c1open);
  const candleRange = Math.max(0.000001, c1high - c1low);
  const bodyRatio = Number.isFinite(body / candleRange) ? body / candleRange : 0;
  const upperWick = Math.max(0, c1high - Math.max(c1open, c1close)) / candleRange;
  const lowerWick = Math.max(0, Math.min(c1open, c1close) - c1low) / candleRange;
  const targetDistance = Number.isFinite(price) && Number.isFinite(target) ? price - target : null;
  const absDistance = Math.abs(targetDistance ?? 0);
  const targetSide = !Number.isFinite(targetDistance) ? 'SKIP' : targetDistance >= 0 ? 'OVER' : 'UNDER';
  const momentumSide = momentum > 0.008 ? 'OVER' : momentum < -0.008 ? 'UNDER' : 'WAIT';
  const trendSide = rangePos > 0.66 ? 'OVER' : rangePos < 0.34 ? 'UNDER' : 'WAIT';
  const candleSide = c1close > c1open ? 'OVER' : c1close < c1open ? 'UNDER' : 'WAIT';
  const wickSide = upperWick > 0.42 && c1close < c1open ? 'UNDER' : lowerWick > 0.42 && c1close > c1open ? 'OVER' : 'WAIT';
  const oddsSide = oddsLean(market);
  const direction = chooseDirection(targetSide, momentumSide, trendSide, wickSide, oddsSide);

  const timeMin = timeRemaining / 60000;
  const cushionScore = clamp((absDistance / meta.ideal) * 27, 0, 27);
  const momentumScore = clamp(Math.abs(momentum) * 620, 0, 18);
  const bodyScore = clamp(bodyRatio * 13, 0, 13);
  const structureScore = direction === trendSide ? 8 : trendSide === 'WAIT' ? 4 : 1;
  const oddsScore = oddsSide === direction ? 5 : oddsSide === 'WAIT' ? 2.5 : 0;
  const memory = memoryBoost(symbol, direction, absDistance, timeMin);
  const settlementPenalty = settlementDanger(absDistance, meta, timeMin);
  const chopPenalty = (momentumSide === 'WAIT' ? 7 : 0) + (targetSide !== 'SKIP' && targetSide !== direction ? 8 : 0) + (bodyRatio < 0.24 ? 5 : 0);
  const wrongSideWick = (direction === 'OVER' && upperWick > 0.45) || (direction === 'UNDER' && lowerWick > 0.45);
  const wickPenalty = wrongSideWick ? 9 : 0;
  const reversalPenalty = reversalDanger({ direction, targetSide, momentumSide, candleSide, trendSide, upperWick, lowerWick, bodyRatio, absDistance, meta });
  const apiPenalty = (!Number.isFinite(target) ? 20 : 0) + (!Number.isFinite(price) ? 40 : 0);

  let edgeScore = Math.round(clamp(35 + cushionScore + momentumScore + bodyScore + structureScore + oddsScore + memory - settlementPenalty - chopPenalty - wickPenalty - reversalPenalty - apiPenalty, 0, 99));
  if (direction === 'WAIT' || direction === 'SKIP') edgeScore = Math.min(edgeScore, 59);

  const risk = edgeScore >= 82 && settlementPenalty < 8 && reversalPenalty < 6 ? 'Low' : edgeScore >= 68 && reversalPenalty < 10 ? 'Medium' : 'High';
  const status = lockStatus(edgeScore, timeMin);
  const forecast = makeForecast({ symbol, direction, edgeScore, timeMin, settlementPenalty, reversalPenalty, momentumSide, trendSide, targetSide, absDistance, meta });
  const reasons = buildReasons({ symbol, direction, targetSide, momentumSide, trendSide, wickSide, oddsSide, absDistance, meta, momentum, bodyRatio, settlementPenalty, reversalPenalty, edgeScore, target, price, forecast });
  const council = [
    { name: 'Genesis Balanced', vote: targetSide, note: Number.isFinite(target) ? `${formatSigned(targetDistance, meta.decimals)} from target` : 'No target yet' },
    { name: 'Momentum Hunter', vote: momentumSide, note: `${(momentum * 100).toFixed(3)}% weighted move` },
    { name: 'Reversal Detector', vote: reversalPenalty > 9 ? 'SKIP' : wickSide, note: reversalPenalty > 9 ? `Reversal danger ${Math.round(reversalPenalty)}/18` : 'No major late-flip danger' },
    { name: 'Settlement Guard', vote: settlementPenalty > 12 ? 'SKIP' : direction, note: `Settlement risk ${Math.round(settlementPenalty)}/22` },
    { name: 'Kalshi Odds Reader', vote: oddsSide, note: market ? oddsText(market) : 'No odds data' },
    { name: 'Historical Match', vote: memory > 0 ? direction : 'WAIT', note: `${memory >= 0 ? '+' : ''}${memory.toFixed(1)} memory boost` },
    { name: 'Likely Lock Forecaster', vote: forecast.probability >= 70 ? direction : 'WAIT', note: `${forecast.probability}% chance of official lock` }
  ];

  return { edgeScore, direction, risk, status, reasons, council, momentum, rangePos, bodyRatio, upperWick, lowerWick, targetDistance, absDistance, settlementPenalty, reversalPenalty, forecast };
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

function settlementDanger(absDistance, meta, timeMin) {
  if (!Number.isFinite(absDistance)) return 20;
  const closeness = clamp(1 - absDistance / meta.warning, 0, 1);
  const timePressure = timeMin < 5 ? (5 - timeMin) / 5 : 0;
  return clamp(closeness * 15 + timePressure * 8, 0, 22);
}

function reversalDanger(input) {
  const { direction, targetSide, momentumSide, candleSide, trendSide, upperWick, lowerWick, bodyRatio, absDistance, meta } = input;
  if (!['OVER', 'UNDER'].includes(direction)) return 12;
  let danger = 0;
  if (momentumSide !== 'WAIT' && momentumSide !== direction) danger += 6;
  if (candleSide !== 'WAIT' && candleSide !== direction && bodyRatio > 0.35) danger += 5;
  if (trendSide !== 'WAIT' && trendSide !== direction) danger += 3;
  if (direction === 'OVER' && upperWick > 0.38) danger += 5 + upperWick * 4;
  if (direction === 'UNDER' && lowerWick > 0.38) danger += 5 + lowerWick * 4;
  if (targetSide === direction && absDistance > meta.ideal && momentumSide !== direction) danger += 4;
  return clamp(danger, 0, 18);
}

function lockStatus(score, timeMin) {
  const rules = MODE_RULES[state.mode];
  if (timeMin > 7) return score >= rules.t7 + 8 ? 'Elite early watch' : score >= rules.t530 ? 'Likely lock forming' : 'Observe';
  if (timeMin <= 7 && timeMin > 5.5) return score >= rules.t7 ? '7:00 lock eligible' : score >= rules.t530 ? 'Likely 5:30 lock' : 'Wait';
  if (timeMin <= 5.5 && timeMin > 4) return score >= rules.t530 ? '5:30 lock eligible' : score >= rules.t4 ? 'Likely 4:00 lock' : 'Wait';
  if (timeMin <= 4 && timeMin > 2.8) return score >= rules.t4 ? '4:00 confirmation eligible' : 'Late watch';
  if (timeMin <= 2.8) return score >= rules.t7 ? 'Emergency only' : 'Too late';
  return 'Wait';
}

function makeForecast(input) {
  const { symbol, direction, edgeScore, timeMin, settlementPenalty, reversalPenalty, momentumSide, trendSide, targetSide, absDistance, meta } = input;
  const rules = MODE_RULES[state.mode];
  if (!['OVER', 'UNDER'].includes(direction)) {
    return { symbol, pick: 'WAIT', probability: 18, projectedWindow: 'No lock', risk: 'Very High', action: 'Wait', entryAdvice: 'Do not enter early', note: 'No stable direction yet.' };
  }

  let projectedWindow = 'No lock';
  let threshold = rules.fallback;
  if (timeMin > 7) {
    if (edgeScore >= rules.t7) { projectedWindow = '7:00'; threshold = rules.t7; }
    else if (edgeScore >= rules.t530) { projectedWindow = '5:30'; threshold = rules.t530; }
    else if (edgeScore >= rules.t4) { projectedWindow = '4:00'; threshold = rules.t4; }
  } else if (timeMin > 5.5) {
    if (edgeScore >= rules.t7) { projectedWindow = '7:00'; threshold = rules.t7; }
    else if (edgeScore >= rules.t530) { projectedWindow = '5:30'; threshold = rules.t530; }
    else if (edgeScore >= rules.t4) { projectedWindow = '4:00'; threshold = rules.t4; }
  } else if (timeMin > 4) {
    if (edgeScore >= rules.t530) { projectedWindow = '5:30'; threshold = rules.t530; }
    else if (edgeScore >= rules.t4) { projectedWindow = '4:00'; threshold = rules.t4; }
  } else if (timeMin > 2.8) {
    if (edgeScore >= rules.t4) { projectedWindow = '4:00'; threshold = rules.t4; }
  }

  const agreement = [momentumSide, trendSide, targetSide].filter(v => v === direction).length;
  const stabilityBonus = agreement * 5 + (absDistance > meta.ideal ? 4 : absDistance > meta.warning ? 2 : -2);
  let probability = Math.round(clamp(46 + (edgeScore - threshold) * 3.15 + stabilityBonus - settlementPenalty * 1.15 - reversalPenalty * 1.35, 5, 96));
  if (projectedWindow === 'No lock') probability = Math.min(probability, edgeScore >= rules.fallback ? 49 : 35);

  const risk = probability >= 82 && reversalPenalty < 6 && settlementPenalty < 8 ? 'Medium-Low'
    : probability >= 70 && reversalPenalty < 10 ? 'Medium'
    : probability >= 58 ? 'High'
    : 'Very High';
  const action = probability >= 82 ? 'Early attack candidate'
    : probability >= 70 ? 'Likely lock forming'
    : probability >= 58 ? 'Watch only'
    : 'Wait';
  const entryAdvice = projectedWindow === 'No lock' || probability < 58 ? 'Do not enter early'
    : (risk === 'Medium-Low' && probability >= 78) || (risk === 'Medium' && probability >= 82) ? 'Early entry possible'
    : probability >= 70 ? 'Wait for lock'
    : 'Watch only';
  const note = projectedWindow === 'No lock'
    ? 'Signal is not strong enough to forecast an official lock yet.'
    : `${direction} may become official at ${projectedWindow}; early entry stays separate from the official record.`;
  return { symbol, pick: direction, probability, projectedWindow, risk, action, entryAdvice, note };
}

function buildReasons(input) {
  const { direction, targetSide, momentumSide, trendSide, wickSide, oddsSide, absDistance, meta, momentum, bodyRatio, settlementPenalty, reversalPenalty, edgeScore, target, price, forecast } = input;
  const reasons = [];
  if (!Number.isFinite(price)) reasons.push('Coinbase price feed unavailable.');
  if (!Number.isFinite(target)) reasons.push('Kalshi target not detected yet; app will keep scanning.');
  if (Number.isFinite(target)) reasons.push(`${direction} lean: price is ${format(absDistance, meta.decimals)} away from Kalshi target.`);
  if (momentumSide === direction) reasons.push('Momentum agrees with the target-side read.');
  else if (momentumSide === 'WAIT') reasons.push('Momentum is not strong yet.');
  else reasons.push('Momentum is fighting the target-side read.');
  if (trendSide === direction) reasons.push('Local range position supports the pick.');
  if (wickSide !== 'WAIT') reasons.push(`${wickSide} wick/rejection signal detected.`);
  if (oddsSide === direction) reasons.push('Kalshi pricing agrees with the chart lean.');
  if (reversalPenalty > 9) reasons.push('Reversal danger is elevated; score was reduced.');
  if (settlementPenalty > 10) reasons.push('Settlement/flip risk is elevated because price is close to target or time is late.');
  if (bodyRatio < 0.24) reasons.push('Small candle bodies suggest chop; confidence reduced.');
  if (forecast?.probability >= 70) reasons.push(`${forecast.probability}% likely-lock forecast for ${forecast.projectedWindow}.`);
  if (edgeScore >= 80) reasons.push('Strong enough for an early Balanced Hunter lock window if timing allows.');
  return reasons.slice(0, 5);
}

function updateForecastAndScout() {
  const best = state.markets[0];
  state.currentForecast = best?.forecast || null;
  if (!best) return;
  const bucket = scoutBucket(best.timeRemaining / 60000);
  if (!bucket) return;
  if (!['OVER', 'UNDER'].includes(best.direction)) return;
  const forecast = best.forecast;
  if (!forecast || forecast.probability < 50 || best.edgeScore < MODE_RULES[state.mode].fallback) return;

  const roundKey = getRoundKey(best.closeMs);
  const key = `${roundKey}:${bucket}:${best.symbol}:${best.direction}`;
  const existing = state.scout.snapshots.find(s => s.key === key);
  const snap = {
    key,
    roundKey,
    bucket,
    ts: Date.now(),
    closeMs: best.closeMs,
    marketTicker: best.kalshi?.ticker,
    symbol: best.symbol,
    pick: best.direction,
    score: best.edgeScore,
    probability: forecast.probability,
    projectedWindow: forecast.projectedWindow,
    risk: forecast.risk,
    entryAdvice: forecast.entryAdvice,
    target: best.target,
    priceAtScout: best.price,
    setupKey: setupKey(best.symbol, best.direction, best.absDistance, best.timeRemaining / 60000),
    status: 'open',
    note: forecast.note
  };
  if (existing) {
    if (snap.score > existing.score || snap.probability > existing.probability) Object.assign(existing, snap);
  } else {
    state.scout.snapshots.unshift(snap);
  }
  state.scout.snapshots = state.scout.snapshots.slice(0, MAX_HISTORY);
  save(SCOUT_KEY, state.scout);
}

function scoutBucket(timeMin) {
  if (timeMin <= 10 && timeMin > 9.45) return '10:00';
  if (timeMin <= 8 && timeMin > 7.45) return '8:00';
  if (timeMin <= 7 && timeMin > 6.45) return '7:00';
  if (timeMin <= 6.5 && timeMin > 5.95) return '6:30';
  if (timeMin <= 6 && timeMin > 5.48) return '6:00';
  if (timeMin <= 5.5 && timeMin > 4.95) return '5:30';
  if (timeMin <= 4 && timeMin > 3.45) return '4:00';
  return null;
}

async function resolveScoutSnapshots() {
  const officialByRound = new Map();
  for (const h of state.record.history || []) {
    if (!officialByRound.has(h.roundKey)) officialByRound.set(h.roundKey, h);
  }
  let changed = false;
  let resolvedThisScan = 0;
  for (const snap of state.scout.snapshots || []) {
    if (snap.status !== 'open') continue;
    if (Date.now() <= snap.closeMs + 45_000) continue;
    const official = officialByRound.get(snap.roundKey);
    if (!official && Date.now() <= snap.closeMs + 4 * 60_000) continue;

    const finalOutcome = await resolveScoutOutcome(snap);
    if (finalOutcome) {
      snap.scoutActual = finalOutcome.actual;
      snap.finalValue = finalOutcome.finalValue;
      snap.resolvedAt = Date.now();
    }

    const scoutWon = finalOutcome ? finalOutcome.actual === snap.pick : null;
    if (official?.result === 'S') {
      snap.status = scoutWon === true ? 'faded_win' : scoutWon === false ? 'faded_loss' : 'faded';
      snap.result = scoutWon === true ? 'FW' : scoutWon === false ? 'FL' : 'F';
      snap.fadeReason = 'Faded to official skip';
    } else if (official && official.symbol === snap.symbol && official.pick === snap.pick) {
      snap.status = official.result === 'W' ? 'win' : 'loss';
      snap.result = official.result;
      snap.officialWindow = official.window;
      snap.officialScore = official.score;
      snap.fadeReason = 'Confirmed by official lock';
    } else if (official) {
      snap.status = scoutWon === true ? 'faded_win' : scoutWon === false ? 'faded_loss' : 'faded';
      snap.result = scoutWon === true ? 'FW' : scoutWon === false ? 'FL' : 'F';
      snap.officialPick = `${official.symbol || 'ALL'} ${official.pick || official.result}`;
      snap.fadeReason = official.symbol === snap.symbol ? 'Flipped before official lock' : 'Faded to a different official pick';
    } else {
      snap.status = scoutWon === true ? 'faded_win' : scoutWon === false ? 'faded_loss' : 'faded';
      snap.result = scoutWon === true ? 'FW' : scoutWon === false ? 'FL' : 'F';
      snap.fadeReason = 'No official record found for the round';
    }
    changed = true;
    resolvedThisScan += 1;
    if (resolvedThisScan >= 8) break;
  }
  if (changed) save(SCOUT_KEY, state.scout);
}

async function resolveScoutOutcome(snap) {
  if (!snap.marketTicker || !Number.isFinite(number(snap.target))) return null;
  try {
    const data = await fetchJson(`/api/kalshi-market?ticker=${encodeURIComponent(snap.marketTicker)}`);
    const m = data?.market || {};
    let actual = null;
    if (m.result === 'yes') actual = 'OVER';
    if (m.result === 'no') actual = 'UNDER';
    const finalValue = number(m.expirationValue ?? m.expirationValueRaw);
    if (!actual && Number.isFinite(finalValue)) actual = finalValue >= number(snap.target) ? 'OVER' : 'UNDER';
    return actual ? { actual, finalValue: Number.isFinite(finalValue) ? finalValue : null } : null;
  } catch (err) {
    console.warn('Scout resolve failed', err);
    return null;
  }
}

function maybeLockBest() {
  if (!state.markets.length) return;
  const best = state.markets[0];
  const roundKey = getRoundKey(best.closeMs);
  state.lastRoundKey = roundKey;
  const already = state.activeLocks.find(l => l.roundKey === roundKey && l.status === 'pending');
  if (already) return;

  const existingRound = state.record.history.find(h => h.roundKey === roundKey);
  if (existingRound) return;

  const timeMin = best.timeRemaining / 60000;
  const rules = MODE_RULES[state.mode];
  let threshold = Infinity;
  let window = '';
  if (timeMin <= 7 && timeMin > 5.5) { threshold = rules.t7; window = '7:00'; }
  else if (timeMin <= 5.5 && timeMin > 4) { threshold = rules.t530; window = '5:30'; }
  else if (timeMin <= 4 && timeMin > 2.8) { threshold = rules.t4; window = '4:00'; }

  if (best.edgeScore >= threshold && ['OVER', 'UNDER'].includes(best.direction)) {
    const lock = {
      id: `${roundKey}-${best.symbol}-${Date.now()}`,
      roundKey,
      marketTicker: best.kalshi?.ticker,
      symbol: best.symbol,
      pick: best.direction,
      score: best.edgeScore,
      likelyProbability: best.forecast?.probability,
      risk: best.risk,
      earlyRisk: best.forecast?.risk,
      window,
      target: best.target,
      priceAtLock: best.price,
      closeMs: best.closeMs,
      lockedAt: Date.now(),
      reason: best.reasons.join(' '),
      setupKey: setupKey(best.symbol, best.direction, best.absDistance, timeMin),
      status: 'pending'
    };
    state.activeLocks.unshift(lock);
    save(LOCK_KEY, state.activeLocks.slice(0, 80));
  } else if (timeMin <= 2.8 && !existingRound) {
    state.record.skips += 1;
    state.record.history.unshift({ roundKey, result: 'S', symbol: 'ALL', pick: 'SKIP', ts: Date.now(), note: 'No market passed lock threshold.' });
    state.record.history = state.record.history.slice(0, MAX_HISTORY);
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
    likelyProbability: lock.likelyProbability,
    window: lock.window,
    ts: Date.now(),
    setupKey: lock.setupKey
  });
  state.record.history = state.record.history.slice(0, MAX_HISTORY);
  updateMemory(lock.setupKey, result === 'W');
  save(STORE_KEY, state.record);
  save(LOCK_KEY, state.activeLocks.slice(0, 80));
  save(MEMORY_KEY, state.memory);
  resolveScoutSnapshots();
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
  const d = absDistance > SYMBOLS[symbol]?.ideal ? 'far' : absDistance > SYMBOLS[symbol]?.warning ? 'mid' : 'close';
  const t = timeMin > 5.5 ? 't7' : timeMin > 4 ? 't530' : 't4';
  return `${symbol}:${direction}:${d}:${t}`;
}

function render() {
  const rules = MODE_RULES[state.mode];
  els.modePill.textContent = rules.label;
  renderRecord();
  renderScoutStats();
  renderMarkets();
  renderBest();
  renderForecast();
  renderCouncil();
  renderMemory();
  renderPending();
  renderRoundScoutList();
  renderScoutList();
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
    els.bestReason.textContent = 'Waiting for active Kalshi 15-minute markets and Coinbase feeds.';
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

function renderForecast() {
  const best = state.markets[0];
  const pending = state.activeLocks.find(l => l.roundKey === state.lastRoundKey && l.status === 'pending');
  els.likelyBox.classList.toggle('hot', Boolean(best?.forecast?.probability >= 75 && !pending));
  if (pending) {
    els.likelyPick.textContent = 'Official lock active';
    els.likelyProb.textContent = `${pending.likelyProbability ?? '--'}%`;
    els.likelyWindow.textContent = pending.window;
    els.earlyRisk.textContent = 'Record protected';
    els.earlyEntryAction.textContent = 'Official lock active';
    els.earlyEntryAction.className = 'entry-advice official';
    els.earlyReason.textContent = 'The early-scout layer is paused because the official locked pick is now frozen.';
    return;
  }
  if (!best?.forecast) {
    els.likelyPick.textContent = 'No forecast yet';
    els.likelyProb.textContent = '--';
    els.likelyWindow.textContent = '--';
    els.earlyRisk.textContent = '--';
    els.earlyEntryAction.textContent = 'Wait for lock';
    els.earlyEntryAction.className = 'entry-advice wait';
    els.earlyReason.textContent = 'Waiting for enough signal stability.';
    return;
  }
  const f = best.forecast;
  els.likelyPick.textContent = f.pick === 'WAIT' ? 'No likely lock' : `${f.symbol} ${f.pick}`;
  els.likelyProb.textContent = `${f.probability}%`;
  els.likelyWindow.textContent = f.projectedWindow;
  els.earlyRisk.textContent = f.risk;
  els.earlyEntryAction.textContent = f.entryAdvice || f.action;
  els.earlyEntryAction.className = `entry-advice ${entryAdviceClass(f.entryAdvice || f.action)}`;
  els.earlyReason.textContent = `${f.action}. ${f.note}`;
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
        <span class="pill">${m.edgeScore}/100</span>
      </div>
      <div class="edge-meter"><span style="width:${m.edgeScore}%"></span></div>
      <div class="metrics">
        <div class="metric"><b>${formatMoney(m.price, m.meta.decimals)}</b><small>Coinbase spot</small></div>
        <div class="metric"><b>${formatMoney(m.target, m.meta.decimals)}</b><small>Kalshi target</small></div>
        <div class="metric"><b>${formatSigned(m.targetDistance, m.meta.decimals)}</b><small>Distance</small></div>
        <div class="metric"><b>${m.status}</b><small>Status</small></div>
        <div class="metric"><b>${m.forecast?.probability ?? '--'}%</b><small>Likely lock</small></div>
        <div class="metric"><b>${Math.round(m.reversalPenalty)}/18</b><small>Reversal danger</small></div>
        <div class="metric"><b>${m.kalshi?.yesBid ?? '--'}/${m.kalshi?.yesAsk ?? '--'}</b><small>Yes bid/ask</small></div>
        <div class="metric"><b>${m.kalshi?.noBid ?? '--'}/${m.kalshi?.noAsk ?? '--'}</b><small>No bid/ask</small></div>
      </div>
      <canvas class="spark" width="420" height="92" data-symbol="${m.symbol}"></canvas>
      <ul class="market-reasons">${m.reasons.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>
    `;
    els.marketGrid.appendChild(card);
    drawSpark(card.querySelector('canvas'), m.coinbase?.candles || [], m.target);
  });
  if (!state.markets.length) {
    els.marketGrid.innerHTML = '<article class="market-card"><h4>No active markets</h4><p class="small-note">No selected coin returned an active Kalshi 15-minute market. The app will keep scanning.</p></article>';
  }
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
    els.memorySummary.innerHTML = '<p class="small-note">No learned setup history yet. It will adapt after completed official locks.</p>';
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

function computeRoundScoutSummaries() {
  const groups = new Map();
  for (const snap of state.scout.snapshots || []) {
    if (!groups.has(snap.roundKey)) groups.set(snap.roundKey, []);
    groups.get(snap.roundKey).push(snap);
  }
  return Array.from(groups.entries()).map(([roundKey, snaps]) => {
    const sorted = snaps.slice().sort((a, b) => {
      const aResolved = a.status !== 'open' ? 1 : 0;
      const bResolved = b.status !== 'open' ? 1 : 0;
      if (aResolved !== bResolved) return bResolved - aResolved;
      if ((a.probability || 0) !== (b.probability || 0)) return (b.probability || 0) - (a.probability || 0);
      return (a.ts || 0) - (b.ts || 0);
    });
    const best = sorted[0];
    const status = roundScoutStatus(best);
    return {
      roundKey,
      best,
      status,
      label: roundScoutLabel(status),
      snapshots: snaps.length,
      officialPick: best?.officialPick,
      fadeReason: best?.fadeReason
    };
  }).sort((a, b) => (b.best?.closeMs || 0) - (a.best?.closeMs || 0));
}

function roundScoutStatus(snap) {
  if (!snap) return 'none';
  if (snap.status === 'win') return 'confirmed_win';
  if (snap.status === 'loss') return 'confirmed_loss';
  if (snap.status === 'faded_win') return 'faded_win';
  if (snap.status === 'faded_loss') return 'faded_loss';
  if (snap.status === 'faded') return 'faded';
  return 'open';
}

function roundScoutLabel(status) {
  return {
    confirmed_win: 'Confirmed win',
    confirmed_loss: 'Confirmed loss',
    faded_win: 'Faded but won',
    faded_loss: 'Faded and lost',
    faded: 'Faded',
    open: 'Open',
    none: 'No scout'
  }[status] || status;
}

function renderRoundScoutList() {
  const rounds = computeRoundScoutSummaries().slice(0, 8);
  if (!rounds.length) {
    els.roundScoutList.innerHTML = '<p class="small-note">No round-level scout summaries yet. v2.1 will choose the strongest scout per round so early history is not inflated by repeated snapshots.</p>';
    return;
  }
  els.roundScoutList.innerHTML = rounds.map(r => {
    const s = r.best || {};
    const extra = r.fadeReason ? ` • ${escapeHtml(r.fadeReason)}` : r.officialPick ? ` • official ${escapeHtml(r.officialPick)}` : '';
    return `
      <div class="scout-item ${r.status}">
        <div><strong>${escapeHtml(r.roundKey)} • ${escapeHtml(s.symbol || '--')} ${escapeHtml(s.pick || '--')}</strong><span>${escapeHtml(s.bucket || '--')} • ${s.probability ?? '--'}% • ${r.snapshots} scout snapshots${extra}</span></div>
        <strong>${escapeHtml(r.label)}</strong>
      </div>
    `;
  }).join('');
}

function renderScoutList() {
  const snaps = (state.scout.snapshots || []).slice(0, 8);
  if (!snaps.length) {
    els.scoutList.innerHTML = '<p class="small-note">No early scout snapshots yet. The app records pre-lock candidates at 10:00, 8:00, 7:00, 6:30, 6:00, 5:30, and 4:00 when a likely lock is forming.</p>';
    return;
  }
  els.scoutList.innerHTML = snaps.map(s => `
    <div class="scout-item ${s.status}">
      <div><strong>${s.bucket} • ${s.symbol} ${s.pick}</strong><span>${s.probability}% • score ${s.score} • projected ${s.projectedWindow}${s.entryAdvice ? ` • ${escapeHtml(s.entryAdvice)}` : ''}${s.fadeReason ? ` • ${escapeHtml(s.fadeReason)}` : ''}</span></div>
      <strong>${escapeHtml(s.result || roundScoutLabel(roundScoutStatus(s)))}</strong>
    </div>
  `).join('');
}

function renderRecord() {
  const { wins, losses, skips, history } = state.record;
  els.wins.textContent = wins;
  els.losses.textContent = losses;
  els.skips.textContent = skips;
  const total = wins + losses;
  const all = wins + losses + skips;
  els.accuracy.textContent = total ? `${Math.round((wins / total) * 1000) / 10}%` : '--';
  els.pickRate.textContent = all ? `${Math.round((total / all) * 1000) / 10}%` : '--';
  const last = history.slice(0, 10);
  els.last10.innerHTML = last.map(h => `<span title="${h.symbol} ${h.pick || ''}" class="dot ${h.result === 'W' ? 'win' : h.result === 'L' ? 'loss' : 'skip'}">${h.result}</span>`).join('');
}

function renderScoutStats() {
  const rounds = computeRoundScoutSummaries();
  const wins = rounds.filter(r => r.status === 'confirmed_win' || r.status === 'faded_win').length;
  const losses = rounds.filter(r => r.status === 'confirmed_loss' || r.status === 'faded_loss').length;
  const fades = rounds.filter(r => r.status === 'faded' || r.status === 'open').length;
  const total = wins + losses;
  els.scoutWins.textContent = wins;
  els.scoutLosses.textContent = losses;
  els.scoutFades.textContent = fades;
  els.scoutAccuracy.textContent = total ? `${Math.round((wins / total) * 1000) / 10}%` : '--';
}

function entryAdviceClass(label) {
  const text = String(label || '').toLowerCase();
  if (text.includes('possible')) return 'possible';
  if (text.includes('wait')) return 'wait';
  if (text.includes('watch')) return 'watch';
  if (text.includes('official')) return 'official';
  return 'danger';
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
  const values = candles.slice(-40).map(c => number(c.close)).filter(Number.isFinite);
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

function exportAllData() {
  const payload = {
    app: 'Edge15 AI Oracle',
    version: 'v2.1-round-scout-grading',
    exportedAt: new Date().toISOString(),
    officialRecord: state.record,
    activeLocks: state.activeLocks,
    learningMemory: state.memory,
    earlyScout: state.scout,
    roundScoutSummary: computeRoundScoutSummaries(),
    selectedMode: state.mode,
    selectedMarkets: selectedSymbols(),
    latestMarkets: state.markets.map(m => ({
      symbol: m.symbol,
      direction: m.direction,
      edgeScore: m.edgeScore,
      forecast: m.forecast,
      target: m.target,
      price: m.price,
      closeMs: m.closeMs,
      risk: m.risk,
      status: m.status,
      reasons: m.reasons
    }))
  };
  downloadJson(payload, `edge15-ai-oracle-v21-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  URL.revokeObjectURL(a.href);
  a.remove();
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
