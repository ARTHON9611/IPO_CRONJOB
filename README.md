# IPO Board — edgy scaling setup

A Next.js dashboard that tracks Indian IPOs. This branch adds a **3-layer scaling
architecture** so 10,000 concurrent refreshes never overwhelm the database:

```
[ Users ]
    │
    ▼
┌───────────────────────────┐
│  1. Cloudflare edge CDN   │  caches the HTML (s-maxage=60, SWR=300)
└───────────────────────────┘
    │  cache miss → origin
    ▼
┌───────────────────────────┐
│  2. Vercel / Next.js      │  cache-aside: reads Upstash Redis first
└───────────────────────────┘
    │  cache miss → Supabase
    ▼
┌─────────────────┐   ┌─────────────────┐
│  Upstash Redis  │   │  Supabase (src) │
└─────────────────┘   └─────────────────┘
```

## How the caching layers work

- **Redis (layer 2)** — `app/page.js` reads the IPO calendar through
  `lib/redis.js -> getCached("ipos:calendar", 60s, fetcher)`. The first request
  after a TTL expiry hits Supabase and writes Redis; every subsequent request is
  a millisecond cache hit. **Supabase is only touched once per 60s period.**
- **Cloudflare CDN (layer 1)** — `next.config.mjs` returns
  `Cache-Control: s-maxage=60, stale-while-revalidate=300` for `/`, so the edge
  serves cached HTML to users world-wide and only revalidates in the background.
- **Graceful fallback** — if Redis isn't configured, `lib/redis.js` returns
  `info: "redis-disabled"` and the page silently uses direct DB reads (with a
  `db·direct` indicator). Nothing breaks without Redis.

## Data / sync

- Data source: `https://api.ipoalerts.in/ipos?status=open`
- **Cron (recommended)** — `.github/workflows/sync.yml` runs `sync.py` daily and
  invalidates the Redis cache afterward (`/del/ipos:calendar`).
- **On-demand (protected)** — `POST /admin/sync` runs the same sync via
  `lib/sync.js` and returns `{ inserted, updated, total }`.

## Environment variables

See `.env.local.example` for the full template. Copy it:

```bash
cp .env.local.example .env.local
```

| Variable | Used for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Client + server Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (browser-safe) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Server-only sync scripts |
| `IPO_ALERTS_API_KEY` | External IPO API |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis cache |
| `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` | Cloudflare Access service token |
| `ADMIN_SYNC_TOKEN` | Fallback bearer token for `/admin/sync` |

## Cloudflare One (Zero Trust) — protecting `/admin/sync`

The on-demand sync endpoint is meant to be **private**. Two ways to gate it:

1. **Cloudflare Access (recommended)** — create a Cloudflare Access application
   covering `https://<your-domain>/admin/sync`. Use a **Service Token** as the
   identity provider and put its Client ID / Secret in
   `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET`. Requests that pass through
   Access automatically carry `cf-access-client-id` / `cf-access-client-secret`
   headers, which the route validates. Your entire team logs in via Cloudflare
   One — no VPN required.

2. **Shared admin token** — send `Authorization: Bearer <ADMIN_SYNC_TOKEN>` (or
   `x-admin-token`) when calling the route directly (curl, cron, etc.).

Trigger it manually:

```bash
curl -X POST https://<your-domain>/admin/sync \
  -H "Authorization: Bearer $ADMIN_SYNC_TOKEN"
```

## Local dev

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
npm run start    # production server
```

The `redis·cached` / `db·direct` pill in the UI shows which data source served
the current render — handy for verifying the cache is working.

## One-time Supabase migration (required for bulk sync + freshness)

Run `supabase/migrations/20260905_cache_hardening.sql` once in the Supabase
dashboard (SQL editor). It adds `updated_at` and a unique index on
`company_name`. The sync code keeps working without it (automatic per-row
fallback), but slower — and `/api/health` reports freshness "unknown".

## Freshness monitoring

`GET /api/health` returns `{ ok, count, latestUpdatedAt, stale }` (503 when
stale). Point any uptime monitor (UptimeRobot, BetterStack) at it and alert
when it stops returning 200 — that covers cron failures, API outages, and
stale data in one check.
