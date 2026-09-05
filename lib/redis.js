import { Redis } from "@upstash/redis";

const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasRedis = Boolean(redisUrl && redisToken);

export const redis = hasRedis
  ? new Redis({
      url: redisUrl,
      token: redisToken,
      automaticDeserialization: false,
    })
  : null;

// Long-lived backup copy: on every successful fetch we also store the data
// under `<key>:prev` with a 7-day TTL. If the database fails later, callers
// get the last-known-good snapshot instead of an error page.
const PREV_TTL_SECONDS = 7 * 24 * 3600;

function prevKey(key) {
  return `${key}:prev`;
}

export async function getCached(key, ttlSeconds, fetcher) {
  if (!hasRedis) return { data: await fetcher(), from: "db" };

  try {
    const cached = await redis.get(key);
    if (cached) return { data: JSON.parse(cached), from: "redis" };
  } catch (err) {
    console.error("Redis read failed (falling back to DB):", err.message);
  }

  try {
    const data = await fetcher();
    try {
      await redis.set(key, JSON.stringify(data), { ex: ttlSeconds });
      await redis.set(prevKey(key), JSON.stringify(data), { ex: PREV_TTL_SECONDS });
    } catch (err) {
      console.error("Redis write failed:", err.message);
    }
    return { data, from: "db" };
  } catch (err) {
    // Database failed — serve the last-known-good snapshot if we have one.
    try {
      const prev = await redis.get(prevKey(key));
      if (prev) {
        console.error("DB failed, serving stale cache:", err.message);
        return { data: JSON.parse(prev), from: "stale" };
      }
    } catch {
      // fall through to the original error
    }
    throw err;
  }
}

export function invalidate(key) {
  if (!hasRedis) return Promise.resolve();
  // NOTE: intentionally keeps `<key>:prev` — it is the disaster-recovery
  // copy and must survive invalidations.
  return redis.del(key);
}
