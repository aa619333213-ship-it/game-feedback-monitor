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
http://127.0.0.1:8787/
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
- `shared.js`: frontend API wrapper plus fallback mock dataset
- `ui-config.js`: branding and theme configuration

## UI customization

Edit `ui-config.js` to change:

- product and game naming
- dashboard and page copy
- brand colors and background
- risk labels

Edit `styles.css` for layout and component styling.

## Notes

- This environment does not currently have Node installed, so the production-style local service is implemented in PowerShell.
- Persistence is JSON-backed instead of SQLite/Postgres in this version, but the existing `schema.sql` still documents the target relational model for the next upgrade.
