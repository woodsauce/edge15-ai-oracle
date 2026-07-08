# Edge15 AI Oracle v2 — Pre-Lock Forecast

Standalone Vercel-ready app for scanning 15-minute crypto prediction markets.

## What changed in v2

- Adds **XRP** to the scanner: BTC / ETH / SOL / BNB / XRP.
- Adds **Likely Lock Forecast** so the app can show when a lock is forming before the official lock.
- Keeps the **Official Record** clean. Early-scout forecasts do **not** count as official W/L picks.
- Adds **Early Scout History** with scout wins, scout losses, faded signals, and scout accuracy.
- Adds an **Export all data** button for official record, pending locks, learning memory, early scout snapshots, and current scanner state.
- Adds a stronger **Reversal Danger** penalty so “far from target” does not automatically look safe if momentum is flipping.
- Adds **adaptive refresh**:
  - Normal: 10 seconds
  - 10:00 to 7:00 remaining: 5 seconds
  - 7:00 to 4:00 remaining: 3 seconds
  - Under 4:00: 2 seconds
  - Final minute: 1 second

## Important design rule

The official record remains the proof system.

- Official locks count as W/L.
- Official skips count as S.
- Likely Lock / Early Scout is separate and is meant to help a user understand when an official lock is forming.

## Operating modes

### Balanced Hunter — default
Designed to avoid becoming a 95% skip machine.

- 7:00 lock threshold: 80+
- 5:30 lock threshold: 70+
- 4:00 lock threshold: 63+

### Ultra Sniper
Fewer picks, stricter standards.

- 7:00 lock threshold: 90+
- 5:30 lock threshold: 82+
- 4:00 lock threshold: 76+

### Action Mode
More picks, higher risk.

- 7:00 lock threshold: 72+
- 5:30 lock threshold: 62+
- 4:00 lock threshold: 55+

## Deploy on Vercel

1. Replace the files in your `edge15-ai-oracle` GitHub repo with these files.
2. Push to GitHub.
3. Vercel should automatically rebuild.
4. Framework preset: **Other**.
5. Build command: leave blank.
6. Output directory: leave blank.

No environment variables are required for this public-data version.

## Local preview

Install Vercel CLI and run:

```bash
npm install
npm run dev
```

Then open the localhost URL Vercel gives you.

## File map

```text
index.html          Main app UI
styles.css          Visual design and mobile layout
app.js              Scanner, AI council, official lock engine, likely-lock forecast, early scout history
api/coinbase.js     Coinbase public ticker/stats/candles proxy
api/kalshi.js       Kalshi open 15m market lookup proxy
api/kalshi-market.js Completed market/result lookup
api/health.js       Basic deploy health check
vercel.json         Vercel config
package.json        Dev script and Node version
```

## Important

This is a decision-support tool, not financial advice and not an auto-trading bot. Prediction markets and crypto are risky. The app can be wrong, APIs can lag, and Kalshi settlement may differ from visible spot ticks.
