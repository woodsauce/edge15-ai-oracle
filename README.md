# Edge15 AI Oracle Bot — Mirror Modes

This package keeps the Edge15 AI Oracle v1 — 6 Minute Lock + Normalized Selector model and adds selectable automated bot modes with separate records.

## Bot strategy modes

### Champion Mirror 1:1

This is the clean mirror mode. It trades the champion model's official locked picks without re-filtering them by score, selector score, risk, 6:00-only, or 4:00 lock settings.

It still respects execution safety controls:

- Bot Mode: Off / Demo / Live
- Demo order mode: Simulated log or Kalshi Demo API
- Max trade size
- Max trades per day
- Max daily loss
- Max open positions
- Allowed markets
- Contract price cap / no cap
- Cancel unfilled order after X seconds
- Stop after first loss
- Stop after X wins
- Live confirmation switch
- Kill switch

### Armed Window 4:30–6:30

This is a separate test mode. It can act on the current champion selector leader between the adjustable armed-start and armed-end minutes. Defaults are 4.5 and 6.5 minutes remaining.

This mode has its own record so it does not contaminate the official champion model record or the Champion Mirror bot record.

## Records kept separate

The dashboard now tracks:

- Official model record
- Champion Mirror 1:1 bot record
- Armed Window 4:30–6:30 bot record
- Full bot log export with settings and both records

## Optional extra prediction filters

The old bot filters are still adjustable, but they are now optional. Turn on **Use extra score/risk/window filters** only if you intentionally want the bot to be stricter than the champion model.

Default behavior leaves those extra prediction filters off so Champion Mirror mode remains 1-to-1.

## Environment variables

For Kalshi Demo API orders, the recommended setup is:

- `KALSHI_DEMO_KEY_ID`
- `KALSHI_DEMO_PRIVATE_KEY_B64`

Raw PEM keys are still supported as a fallback with `KALSHI_DEMO_PRIVATE_KEY`, but Base64 is safer on Vercel because it avoids broken multiline values.

For Kalshi Live API orders, use:

- `KALSHI_LIVE_KEY_ID`
- `KALSHI_LIVE_PRIVATE_KEY_B64`

See `KEY_SETUP.md` for copy/paste commands.

Keep private keys server-side in Vercel environment variables or a local `.env` file. Do not put private keys in browser code.


## Fixes in key-test build

- Added Base64 private-key support.
- Added `/api/kalshi-key-test` and a dashboard **Test Kalshi keys** button.
- Added private-key parse diagnostics without exposing secrets.
- Failed signing/order attempts no longer count as an already-traded round.
- Pinned Node to `20.x` instead of `>=20` for stable crypto behavior.
