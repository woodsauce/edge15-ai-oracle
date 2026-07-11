# Edge15 AI Oracle Bot — Champion Auto Controls

This package keeps the v1 6-minute normalized-selector champion model and adds an adjustable automated bot control panel.

## Default bot settings

- Bot Mode: Demo
- Demo order mode: Kalshi Demo API if keys are configured
- Max trade size per pick: $1, adjustable
- Max trades per day: 0 = no max, adjustable
- Max daily loss: $5, adjustable
- Max open positions: 1, adjustable
- Allowed markets: BTC, ETH, SOL, BNB, XRP, adjustable
- Use 6:00 locks only: On, adjustable
- Allow 4:00 backup locks: Off, adjustable
- Minimum edge score: 70, adjustable
- Minimum selector score: 72, adjustable
- Allowed risk: Medium or better, adjustable
- Contract price cap: No cap / bet if possible, adjustable
- Cancel unfilled order after: 10 seconds, adjustable
- Stop after first loss: Off, adjustable
- Stop after X wins: 0 = no limit, adjustable

## Kalshi connection

The browser never stores or displays Kalshi private keys. Put keys in environment variables on the server/Vercel project.

Demo:

```bash
KALSHI_DEMO_KEY_ID=your-demo-key-id
KALSHI_DEMO_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Live:

```bash
KALSHI_LIVE_KEY_ID=your-live-key-id
KALSHI_LIVE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

The app defaults to Demo mode. Live Mode also requires the dashboard checkbox: `I understand Live Mode can place real Kalshi trades`.

## How the bot places orders

When the champion model creates an official lock, the bot checks every adjustable limit. If allowed, it sends a marketable limit order through `/api/bot-order`.

- OVER = buy YES using the V2 event order endpoint.
- UNDER = sell YES, which is economically equivalent to buying NO in Kalshi’s YES-leg order format.
- No price cap means the bot uses a highly marketable price, still through a limit order.
- Orders are created with an expiration time based on the dashboard cancel-after setting.

## Important

This is trading automation software. Demo mode should be verified before Live mode. API credentials, order behavior, and market settlement should be tested carefully with tiny limits before using real funds.
