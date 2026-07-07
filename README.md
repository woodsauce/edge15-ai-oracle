# Edge15 AI Oracle

Standalone Vercel-ready app for scanning 15-minute crypto prediction markets.

## What it does

- Reads live Coinbase public market data through a Vercel API proxy.
- Looks up open Kalshi 15-minute crypto markets through public Kalshi endpoints.
- Ranks BTC, ETH, SOL, and BNB by an Edge Score.
- Shows the best current opportunity, current lean, official locked pick, risk, confidence, and reason.
- Uses 7:00 / 5:30 / 4:00 lock windows.
- Stores local results, pending locks, and adaptive setup memory in the browser.
- Attempts to auto-resolve completed Kalshi locks and also provides manual correction buttons.
- Keeps money/odds visible but does not block picks because payout is low.
- Shows a QR code at the top so you can open the deployed link on your phone.

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

1. Create a new GitHub repo named `edge15-ai-oracle`.
2. Upload all files from this folder to that repo.
3. Go to Vercel and click **Add New Project**.
4. Import the `edge15-ai-oracle` repo.
5. Framework preset: **Other**.
6. Build command: leave blank.
7. Output directory: leave blank.
8. Deploy.

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
app.js              Scanner, AI council, lock engine, tracker, learning memory
api/coinbase.js     Coinbase public ticker/stats/candles proxy
api/kalshi.js       Kalshi open 15m market lookup proxy
api/kalshi-market.js Completed market/result lookup
api/health.js       Basic deploy health check
vercel.json         Vercel config
package.json        Dev script and Node version
```

## Important

This is a decision-support tool, not financial advice and not an auto-trading bot. Prediction markets and crypto are risky. The app can be wrong, APIs can lag, and Kalshi settlement may differ from Coinbase spot ticks.


## Vercel runtime note

This version intentionally does **not** set a custom function runtime in `vercel.json`. Vercel will auto-detect the `/api/*.js` serverless functions and use the default Node runtime. This avoids the build error: `Function Runtimes must have a valid version`.
