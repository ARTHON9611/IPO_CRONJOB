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

export async function getCached(key, ttlSeconds, fetcher) {
  if (!hasRedis) return { data: await fetcher(), from: "db", info: "redis-disabled" };

  try {
    const cached = await redis.get(key);
    if (cached) return { data: JSON.parse(cached), from: "redis", info: "hit" };
  } catch (err) {
    console.error("Redis read failed (falling back to DB):", err.message);
  }

  const data = await fetcher();
  try {
    await redis.set(key, JSON.stringify(data), { ex: ttlSeconds });
  } catch (err) {
    console.error("Redis write failed:", err.message);
  }
  return { data, from: "db", info: "miss" };
}

export function invalidate(key) {
  if (!hasRedis) return Promise.resolve();
  return redis.del(key);
}
