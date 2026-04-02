# Game Feedback Monitor

An internal operations dashboard for monitoring overseas player feedback from Reddit.

## What is implemented

- Live Reddit ingestion for configured subreddits
- Local persistent store in `data/store.json`
- PowerShell web server that serves both the UI and the API
- Risk dashboard with issue ranking, alerts, report view, and review queue
- Manual correction writeback for topic, sentiment, and false positives
- UI config layer for brand, copy, and theme tokens

## Start the app

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\Start-Server.ps1
```

Then open:

```text
http://127.0.0.1:8899/
```

## Live data flow

1. The server pulls Reddit submissions and a small number of top-level comments.
2. Results are stored in `data/store.json`.
3. Topic, sentiment, root-cause, action suggestion, and risk are computed locally.
4. The frontend reads the live API first and falls back to built-in mock data if the server is not available.

## Main files

- `scripts/Start-Server.ps1`: local web server, Reddit sync, API routes, static file hosting
- `data/sources.json`: game and subreddit configuration
- `data/store.json`: local persistent store
- `data/store.seed.json`: Vercel bootstrap snapshot used when online storage is empty
- `shared.js`: frontend API wrapper plus fallback mock dataset
- `ui-config.js`: branding and theme configuration

## Vercel deployment

- `api/_lib/persistent-store.js`: persistence layer for local file storage and Vercel Blob storage
- `vercel.json`: runtime config for Vercel Functions
- `.github/workflows/sync-monitor.yml`: 30-minute scheduled sync via GitHub Actions
- `api/cron/sync.js`: optional protected sync endpoint if you later move scheduling back to Vercel Pro

To make Vercel persist real data instead of seed data, add:

- `BLOB_READ_WRITE_TOKEN`
- `CRON_SECRET`

## UI customization

Edit `ui-config.js` to change:

- product and game naming
- dashboard and page copy
- brand colors and background
- risk labels

Edit `styles.css` for layout and component styling.

## Notes

- Local persistence remains JSON-backed, and the PowerShell service continues to use `data/store.json`.
- The Vercel version now supports persisted storage, but it needs a configured Blob token to write back fresh sync results.
