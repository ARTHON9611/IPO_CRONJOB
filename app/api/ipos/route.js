import { NextResponse } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { hasRedis, redis, getCached } from "@/lib/redis";

export const runtime = "nodejs";

const IPO_CACHE_KEY = "ipos:calendar";
// Long TTL on purpose: the page revalidates every 60s, so an equal/short TTL
// phase-locks expiry with regeneration and EVERY generation misses. With a
// long TTL, regenerations always hit Redis; freshness is handled by explicit
// invalidation in lib/sync.js on every data write, not by expiry.
const IPO_CACHE_TTL = 86400;

// Generous per-IP budget for humans; scrapers hammering the origin directly
// (bypassing the edge cache) get 429s. Fails OPEN if Redis is unreachable.
const ratelimit = hasRedis
  ? new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(100, "1 m"), prefix: "rl:ipos" })
  : null;

function clientIp(request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "anon";
}

export async function GET(request) {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ ipos: [], error: "Missing Supabase public credentials." }, { status: 500 });
  }

  if (ratelimit) {
    try {
      const { success } = await ratelimit.limit(clientIp(request));
      if (!success) {
        return NextResponse.json({ ipos: [], error: "Rate limited, try again shortly." }, { status: 429 });
      }
    } catch (err) {
      console.error("Ratelimit failed open:", err.message);
    }
  }

  const fetcher = async () => {
    const { data, error } = await supabase
      .from("ipos")
      .select(
        "id, company_name, issue_type, open_date, close_date, listing_date, price_band_low, price_band_high, lot_size, issue_size_cr, status",
      )
      .order("open_date", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  };

  try {
    const { data, from } = await getCached(IPO_CACHE_KEY, IPO_CACHE_TTL, fetcher);
    return NextResponse.json({ ipos: data, from, redis: hasRedis });
  } catch (err) {
    return NextResponse.json({ ipos: [], error: err.message }, { status: 500 });
  }
}
