# VEXitEY Tagwatch (`vexigtracker`)

Live: **https://igtracker.apps.vexitey.com**

Browser-first Instagram giveaway tracker. Meta’s Instagram API **cannot** list followers or reliably return photo-tags for this use case. **Instagram Manager** (signed-in browser) finds followers + tags on the web, then **POSTs** them here. Display boards read from this API.

```
Instagram web UI (signed-in browser / Grok Bot)
        │  POST /api/ingest  (Bearer INGEST_API_KEY)
        ▼
   igtracker (this app)  — store + SSE
        │  GET /api/entries/latest?eligible=true
        │  GET /api/stream
        ▼
   Display / slide board
```

## Giveaway rules

| Rule | Detail |
|------|--------|
| Account | `@vexitey` |
| Entry | Currently **follows** @vexitey **and** **photo-tags** @vexitey |
| Follow timing | Follow may **predate** the window |
| Drawing window | Tag date **2026-09-13 … 2026-09-15** (`America/Chicago`) |
| Eligible | `follows && tagged && in_window` (computed on ingest) |

## Coolify

- Build: **Dockerfile**
- Port: **3000**
- Persistent volume: **`/data`** (store.json + media)

### Env vars

| Key | Required | Notes |
|-----|----------|--------|
| `APP_PASSWORD` | Yes (public) | Dashboard login |
| `INGEST_API_KEY` | Yes | Bearer token for browser agent ingest. Use the same secret you gave Instagram Manager (`IGTRACKER_INGEST_API_KEY`). |
| `APP_URL` | Yes | `https://igtracker.apps.vexitey.com` |
| `GIVEAWAY_WINDOW_START` | No | default `2026-09-13` |
| `GIVEAWAY_WINDOW_END` | No | default `2026-09-15` |
| `TZ` | No | `America/Chicago` |
| `DATA_DIR` | No | `/data` in the image |

> No `IG_ACCESS_TOKEN` / Meta app secrets are required for the browser-ingest path.

## Ingest webhook (browser agent)

All write routes require:

```http
Authorization: Bearer $INGEST_API_KEY
```

### `POST /api/ingest`

Batch upsert:

```bash
curl -sS -X POST https://igtracker.apps.vexitey.com/api/ingest \
  -H "Authorization: Bearer $INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "source": "browser",
    "snapshot": { "follower_count": 220, "notes": "daily check" },
    "followers": [
      { "username": "kentonjeberling", "display_name": "Kenton Eberling" }
    ],
    "tags": [
      {
        "username": "kentonjeberling",
        "display_name": "Kenton Eberling",
        "permalink": "https://www.instagram.com/p/DdCva58posv5_Qi4yFXg6KN4BvbNPuaTaulI9o0/",
        "tagged_at": "2026-09-13T14:22:00-05:00",
        "media_url": "https://igtracker.apps.vexitey.com/media/....jpg",
        "caption": "optional",
        "follows": true
      }
    ]
  }'
```

Also:

- `POST /api/ingest/followers` — body `{ "followers": [ ... ] }` or a raw array
- `POST /api/ingest/tags` — JSON or multipart (`media` file + fields)
- `POST /api/ingest/snapshot` — `{ "follower_count": 220 }`

## Display board API (public read)

| Endpoint | Use |
|----------|-----|
| `GET /api/health` | Coolify healthcheck |
| `GET /api/stats` | Counts + window |
| `GET /api/entries/latest?eligible=true&limit=20` | Newest eligible tags (with `media_url` + permalink) |
| `GET /api/entries?eligible=true` | Filtered list |
| `GET /api/stream` | SSE: `entry.created`, `stats` |

### Minimal display snippet

```html
<div id="card"></div>
<script>
const BASE = 'https://igtracker.apps.vexitey.com';
function show(e) {
  if (!e?.eligible) return;
  card.innerHTML = `<img src="${e.media_url||''}" style="max-width:480px;border-radius:12px"/>
    <h2>@${e.username}</h2>
    <a href="${e.permalink}" target="_blank">View post</a>`;
}
const es = new EventSource(BASE + '/api/stream');
es.addEventListener('entry.created', (ev) => show(JSON.parse(ev.data)));
setInterval(async () => {
  const r = await fetch(BASE + '/api/entries/latest?eligible=true&limit=1');
  const { entries } = await r.json();
  if (entries?.[0]) show(entries[0]);
}, 5000);
</script>
```

## Local

```bash
cp .env.example .env
# set APP_PASSWORD + INGEST_API_KEY
npm install
npm start
```

## What changed in v2

- Removed Meta Graph API / OAuth / Instagram Login webhook path as the primary data source
- Added **`INGEST_API_KEY`** browser ingest webhook
- Public SSE + entries API for slide displays
- Eligibility computed for Sept 13–15 America/Chicago
