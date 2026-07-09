# Edge15 AI Oracle v1 — 6 Minute Lock + 100% Defense Mode

Standalone Vercel-ready app for scanning 15-minute crypto prediction markets.

## What this version is

This is the **v1 model branch** with the main official lock window moved from **5:30 remaining** to **6:00 remaining**.

It intentionally does **not** include the v2/v2.1 early-scout system, likely-lock forecast layer, or round-scout grading. This is meant to preserve the simpler v1 behavior that produced the strongest early record, while testing whether a slightly earlier 6-minute official lock improves entry timing.

## What it does

- Reads live Coinbase public market data through Vercel API proxies.
- Looks up open Kalshi 15-minute crypto markets through public Kalshi endpoints.
- Ranks BTC, ETH, SOL, and BNB by an Edge Score.
- Shows the best current opportunity, current lean, official locked pick, risk, confidence, and reason.
- Uses **7:00 / 6:00 / 4:00** official lock windows.
- Stores local results, pending locks, and adaptive setup memory in the browser.
- Attempts to auto-resolve completed Kalshi locks and provides manual correction buttons for pending locks.
- Includes an **Export** button for downloading the local record/history JSON.
- Keeps money/odds visible but does not block picks because payout is low.
- Shows a QR code at the top so you can open the deployed link on your phone.

## Operating modes

### Balanced Hunter — default
Designed to avoid becoming a 95% skip machine.

- 7:00 lock threshold: 80+
- **6:00 main lock threshold: 70+**
- 4:00 lock threshold: 63+

### Ultra Sniper
Fewer picks, stricter standards.

- 7:00 lock threshold: 90+
- **6:00 main lock threshold: 82+**
- 4:00 lock threshold: 76+

### Action Mode
More picks, higher risk.

- 7:00 lock threshold: 72+
- **6:00 main lock threshold: 62+**
- 4:00 lock threshold: 55+

## Deploy on Vercel

1. Replace the files in your `edge15-ai-oracle` GitHub repo with this package.
2. Commit and push to GitHub.
3. Vercel should rebuild automatically.

For a new deployment:

1. Create a GitHub repo named `edge15-ai-oracle-v1-6min` or reuse your current `edge15-ai-oracle` repo.
2. Upload all files from this folder.
3. Go to Vercel and click **Add New Project**.
4. Import the repo.
5. Framework preset: **Other**.
6. Build command: leave blank.
7. Output directory: leave blank.
8. Deploy.

No environment variables are required for this public-data version.

## Local preview

Install Vercel CLI and run:

```bash
npm install
npm run start
```

Then open the localhost URL Vercel gives you.

## File map

```text
index.html          Main app UI
styles.css          Visual design and mobile layout
app.js              Scanner, AI council, 6-minute lock engine, tracker, learning memory
api/coinbase.js     Coinbase public ticker/stats/candles proxy
api/candles.js      Coinbase candle proxy
api/kalshi.js       Kalshi open 15m market lookup proxy
api/kalshi-market.js Completed market/result lookup
api/health.js       Basic deploy health check
vercel.json         Vercel config
package.json        Dev script and Node version
```

## Important

This is a decision-support tool, not financial advice and not an auto-trading bot. Prediction markets and crypto are risky. The app can be wrong, APIs can lag, and Kalshi settlement may differ from Coinbase spot ticks.

## Vercel runtime note

This version intentionally does **not** set a custom function runtime in `vercel.json`. Vercel will auto-detect the `/api/*.js` serverless functions and use the default Node runtime.


## New in this build

This keeps the v1 6-minute model behavior and adds one extra operating mode:

- **100% Defense Mode**: the strictest optional mode. It attempts to protect the official record by blocking setups that resemble prior loss patterns.

Defense Mode blocks locks when any of these are present:

- risk is not Low
- distance is not far enough
- momentum is not confirming the pick
- local range position is not confirming the pick
- wick/reversal risk is detected
- settlement risk is too high
- candle bodies suggest chop
- late 4:00 locks do not have an 86+ score
- BTC setups lack extra cushion

Balanced Hunter, Ultra Sniper, and Action Mode are unchanged.

Important: the mode is designed to chase a perfect official record by skipping more. It does not guarantee future wins.
