# Upgrade Roadmap

## Phase 1: Replace mock APIs

Move the logic from `shared.js` into real services:

- `collector/reddit-client`
- `analysis/topic-classifier`
- `analysis/sentiment-service`
- `analysis/report-generator`
- `alerts/notifier`

## Phase 2: Add persistence

Back the prototype with Postgres using `schema.sql`.

- ingest Reddit posts into `raw_posts`
- write analysis results into `analyzed_feedback`
- compute daily snapshots into `risk_daily_snapshot`
- store alerts and reports

## Phase 3: Production UI

Port the static pages into Next.js:

- `/dashboard`
- `/reports/[date]`
- `/review`

Keep `ui-config.js` as the source for branding tokens, then move those values into a theme module.

## Suggested app structure

```text
src/
  app/
    dashboard/
    reports/
    review/
    api/
  modules/
    collector/
    analysis/
    risk/
    alerts/
    review/
  lib/
    db/
    config/
    types/
```

## First backend integrations

1. Reddit ingestion job
2. Topic and sentiment analysis service
3. Dashboard overview endpoint
4. Alert delivery adapter for Feishu and WeCom
5. Review writeback endpoint
