# Cloudflare One Setup (free subdomain, protect `/admin/sync`)

This guide sets up **Cloudflare Tunnel + Zero Trust (Access)** for IPO Board.
Your site stays on **Vercel**; Cloudflare sits in front as CDN + Access gateway.

**No custom domain needed** — we use a free subdomain on the account's zone
(e.g. `ipoboard.<your-zone>.com`) or a Cloudflare-issued hostname.

> Cloudflare Tunnel with a stable/reusable subdomain requires a zone on your
> Cloudflare account (free plan is fine). A true **temporary** `*.trycloudflare.com`
> URL has no persistent DNS record and **cannot** have Access policies reliably
> attached, so we don't use it for production.

---

## Architecture recap

```
Users ──▶ Cloudflare Tunnel (public hostname)
             │  Cloudflare Access: /admin/sync requires login
             ▼  (everything else passes through)
          Vercel/Next.js (origin)
             │
             ▼
          Upstash Redis + Supabase
```

---

## Part 0 — Install tools

PowerShell (admin not required):

```powershell
# cloudflared (Windows amd64)
# Download from: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
# Or via winget:
winget install --id Cloudflare.cloudflared

cloudflared --version
```

---

## Part 1 — Add a zone to Cloudflare

If you **don't** have a domain on Cloudflare yet, the simplest permanent option
is to get any domain (even a cheap one) and add it:

1. In Cloudflare dashboard → **Add a site**
2. Enter your domain → Free plan
3. Cloudflare gives you **two nameservers** → set them at your registrar
4. Wait for "Active" (DNS propagates, typically minutes to hours)

Skip this if you already have a zone.

---

## Part 2 — Authenticate & create the tunnel

```powershell
# Login (opens browser, authorizes cloudflared for your account)
cloudflared tunnel login

# Create a tunnel named 'ipoboard'
cloudflared tunnel create ipoboard
```

Output includes a `<TUNNEL-UUID>` and writes a credentials JSON to
`~/.cloudflared/`. Copy the UUID.

## Part 3 — Configure ingress

Edit **`.cloudflared\config.yml`** in this repo:

```yaml
tunnel: <YOUR-TUNNEL-UUID>
credentials-file: <path-to-your-credentials>-file.json

ingress:
  # Your public hostname for the app:
  - hostname: ipoboard.example.com
    # If app runs locally during dev:
    service: http://localhost:3000
    # If app is deployed on Vercel, use the public URL instead:
    # service: https://your-app.vercel.app
  - service: http_status:404
```

If the tunnel runs on a server/VPS, point `service` at your **Vercel URL** and
run the tunnel there; if running tunnel locally for dev, keep `localhost:3000`.

## Part 4 — Route DNS

```powershell
cloudflared tunnel route dns ipoboard ipoboard.example.com
```

This creates the DNS CNAME automatically (proxied). To confirm in the dashboard:
**Your zone → DNS → Records** → a `CNAME ipoboard → <uuid>.cfargotunnel.com`.

## Part 5 — Run the tunnel

```powershell
# Foreground (test first):
cloudflared tunnel run ipoboard

# Windows service (persistent):
cloudflared service install
cloudflared service start
```

Verify: open `https://ipoboard.example.com` → your app loads.

---

## Part 6 — Cloudflare Access: protect `/admin/sync`

Dashboard → **Zero Trust → Access → Applications** → **Add an application**:

| Field | Value |
|---|---|
| Application type | **Self-hosted** |
| Name | `IPO Admin` |
| Session duration | e.g. 24h |
| **Domain / path** | `ipoboard.example.com` and path `/admin/sync` |

> Use domain `ipoboard.example.com` with **path = `/admin/sync`** so the public
> dashboard stays open and only the sync endpoint is gated.

Under **Policies → Add a policy**:

| Field | Value |
|---|---|
| Policy name | `Only-team` |
| Action | **Allow** |
| Session duration | 24h |
| Include: **Everyone** | (or lock to your team email domain) |

Then **Add** → **Done**.

### (Optional) Service token for the cron / curl calls

The daily GitHub Actions cron calls the sync endpoint server-to-server. Access
can allow it without an interactive login using a **Service Token**:

1. Zero Trust → **Access → Service Auth → Service Tokens → Create**
2. Copy the **Client ID** and **Client Secret**
3. Add a **second policy** in the app: action **Allow**, include **Service Token**, select it
4. Put values in env vars:
   - `.env`: `CF_ACCESS_CLIENT_ID=...`, `CF_ACCESS_CLIENT_SECRET=...`
   - GitHub Actions secrets: same two names (and `ADMIN_SYNC_TOKEN`)

The route (`app/admin/sync/route.js`) already validates these headers as
defense-in-depth, plus a plain `Authorization: Bearer $ADMIN_SYNC_TOKEN` fallback.

---

## Part 7 — CDN caching in front

The app already sends `Cache-Control: s-maxage=60, stale-while-revalidate=300`
via `next.config.mjs`. With the tunnel proxied, Cloudflare's edge can cache `/`.

To be explicit, add a **Cache Rule** in the dashboard:

1. **Rules → Cache Rules → Create**
2. When: `Hostname equals ipoboard.example.com`
3. Then: **Cache eligibility → Eligible for cache**, **Edge TTL → 60s**
4. Deploy

Now the 10,000-refresh scenario is absorbed by Cloudflare edge + Redis at the
origin — see `README.md` for the full architecture.

---

## Quick reference — files in this repo

| File | Purpose |
|---|---|
| `.cloudflared/config.yml` | Tunnel ingress config (edit UUID/hostname) |
| `.cloudflared/setup.ps1` | Helper script for tunnel creation |
| `.gitignore` | Ignores `.cloudflared/*.json` credentials |
| `app/admin/sync/route.js` | Protected sync endpoint (validates CF + bearer) |
| `next.config.mjs` | Edge cache headers |

## Troubleshooting

- **`cloudflared tunnel login` opens nothing** — copy the URL manually into a browser; ensure you're logged into the Cloudflare account owning the zone.
- **Hostname 502** — the origin (`localhost:3000` or Vercel URL) isn't reachable from where the tunnel runs; check the app is up / CORS not blocking.
- **`/admin/sync` returns 401 even after login** — the route also requires either CF service-token env vars or `ADMIN_SYNC_TOKEN`; set at least one.
- **Access blocking whole site** — make sure the application's path is `/admin/sync`, not `/` (and no catch-all application above it).