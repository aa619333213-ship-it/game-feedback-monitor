# Backend Contract

This prototype uses `shared.js` as a mock backend. A production service can replace it with the following API contract.

## Endpoints

### `GET /api/dashboard/overview?date=YYYY-MM-DD`

Returns:

```json
{
  "game": "Project Vanguard",
  "sources": ["r/ProjectVanguard", "r/gachagaming"],
  "riskScore": 72,
  "riskLevel": "orange",
  "riskChange": 9,
  "negativeVolume": 6,
  "discussionHeat": 3280,
  "growthRate": 0.41,
  "alertsCount": 3,
  "topTopic": {
    "key": "monetization",
    "label": "Monetization",
    "riskScore": 88,
    "riskLevel": "red"
  }
}
```

### `GET /api/issues?system=&risk=`

Returns an array of topic-level risk objects:

```json
[
  {
    "key": "matchmaking",
    "label": "Matchmaking",
    "negativeCount": 2,
    "negativeShare": 1,
    "heat": 1110,
    "growth": 0.35,
    "trend": [28, 32, 30, 38, 49, 56, 65],
    "riskScore": 74,
    "riskLevel": "orange",
    "rootCause": "..."
  }
]
```

### `GET /api/posts?topic=&sentiment=&risk=`

Returns filtered posts and comments with linked analysis results.

### `GET /api/reports/daily?date=YYYY-MM-DD`

Returns the generated daily report payload used by `reports.html`.

### `POST /api/labels/review`

Request body:

```json
{
  "postId": "p2",
  "topic": "balance",
  "sentiment": "negative",
  "ignored": false,
  "note": "This belongs to balance rather than matchmaking."
}
```

### `POST /api/alerts/test`

Triggers a test delivery to Feishu/WeCom.

## Processing pipeline

1. Scheduled job pulls Reddit submissions and comments for configured subreddits.
2. Raw content is de-duplicated and normalized into `raw_posts`.
3. A rules-first classifier maps content to known systems.
4. Unmatched items are marked as cluster candidates.
5. Sentiment, root-cause summary, action suggestion, and risk are generated into `analyzed_feedback`.
6. Daily snapshots and alerts are written for dashboard and report consumption.
