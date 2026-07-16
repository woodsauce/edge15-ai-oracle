# Kalshi Key Setup — Fixed Version

This build supports both raw PEM private keys and Base64-encoded private keys.

The recommended setup is Base64 because Vercel can mangle multiline private keys.

## Demo variables

Add these in Vercel Environment Variables:

- `KALSHI_DEMO_KEY_ID`
- `KALSHI_DEMO_PRIVATE_KEY_B64`

Keep the old `KALSHI_DEMO_PRIVATE_KEY` empty or delete it after the Base64 version works.

## Live variables

Only add these after Demo key test passes and a Demo order gets a real order ID:

- `KALSHI_LIVE_KEY_ID`
- `KALSHI_LIVE_PRIVATE_KEY_B64`

## Convert the `.key` file to Base64

### Windows PowerShell

Replace the path with your actual downloaded Kalshi `.key` file:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\\Users\\YOURNAME\\Downloads\\kalshi.key")) | Set-Clipboard
```

Then paste the clipboard value into `KALSHI_DEMO_PRIVATE_KEY_B64`.

### Mac / Linux Terminal

```bash
base64 -w 0 ~/Downloads/kalshi.key
```

If your Mac `base64` does not support `-w 0`, use:

```bash
base64 ~/Downloads/kalshi.key | tr -d '\n'
```

## Test inside the app

After redeploying, open the app and press:

`Test Kalshi keys`

A good result shows:

- API Key ID found: YES
- Private key found: YES
- Private key parsed: YES
- Signature created: YES
- Kalshi auth request: PASS

Do not switch to Live until this passes in Demo and a Kalshi Demo order produces an order ID.
