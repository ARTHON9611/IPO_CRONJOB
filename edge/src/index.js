/**
 * IPO Board edge proxy (Cloudflare Worker, free workers.dev subdomain).
 *
 * - GET /            -> cached at the edge for 60s (Cache API, explicit TTL).
 * - /admin/*, /api/* -> always passed through to origin, never cached.
 * - POST /__purge    -> deletes the cached homepage (x-purge-token required).
 * - Everything else (/_next/*, static) -> passed through (Vercel handles it).
 * - Adds `x-edge-cache: HIT|MISS` so edge behavior is observable.
 */

const ORIGIN = "https://ipo-tracker-phi.vercel.app";
const EDGE_TTL_SECONDS = 60;

function isCacheable(request, url) {
  if (request.method !== "GET") return false;
  if (url.pathname === "/") return true;
  return false;
}

function isBypass(url) {
  return url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/");
}

// Fetch origin with the shared testing secret stamped on, so the origin
// middleware can tell Worker traffic apart from direct hits.
function originFetch(path, request, env) {
  const headers = new Headers(request.headers);
  if (env.EDGE_SECRET) headers.set("x-edge-secret", env.EDGE_SECRET);
  return fetch(ORIGIN + path, { method: request.method, headers, body: request.body });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cache = caches.default;
    // Vary the cache key on nothing but the path — one shared copy for all users.
    const cacheKey = new Request(ORIGIN + "/", { method: "GET" });

    // Edge purge, called by /admin/sync after each data sync so visitors see
    // fresh data immediately instead of waiting out the 60s edge TTL.
    if (url.pathname === "/__purge") {
      const token = request.headers.get("x-purge-token");
      if (request.method === "POST" && token && env.PURGE_TOKEN && token === env.PURGE_TOKEN) {
        await cache.delete(cacheKey);
        return new Response(JSON.stringify({ purged: true }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("forbidden", { status: 403 });
    }

    // Never cache admin/API — always fresh from origin.
    if (isBypass(url)) {
      const res = await originFetch(url.pathname + url.search, request, env);
      const out = new Response(res.body, res);
      out.headers.set("x-edge-cache", "BYPASS");
      return out;
    }

    if (!isCacheable(request, url)) {
      return originFetch(url.pathname + url.search, request, env);
    }

    let cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("x-edge-cache", "HIT");
      return hit;
    }

    const res = await originFetch("/", request, env);
    // Buffer once — a body stream can only be consumed a single time, and we
    // need it twice (client response + edge-cache copy).
    const buf = await res.arrayBuffer();

    const out = new Response(buf, res);
    out.headers.set("x-edge-cache", "MISS");

    // Store an edge-cacheable copy with explicit TTL, independent of the
    // origin's Cache-Control (Vercel ISR emits max-age=0 for this page).
    if (res.ok) {
      const store = new Response(buf, res);
      store.headers.set("Cache-Control", `public, max-age=${EDGE_TTL_SECONDS}`);
      store.headers.set("x-edge-cache", "HIT");
      ctx.waitUntil(cache.put(cacheKey, store));
    }
    return out;
  },
};
