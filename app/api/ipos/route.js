import { NextResponse } from "next/server";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { hasRedis, getCached } from "@/lib/redis";

export const runtime = "nodejs";

const IPO_CACHE_KEY = "ipos:calendar";
// Long TTL on purpose: the page revalidates every 60s, so an equal/short TTL
// phase-locks expiry with regeneration and EVERY generation misses. With a
// long TTL, regenerations always hit Redis; freshness is handled by explicit
// invalidation in lib/sync.js on every data write, not by expiry.
const IPO_CACHE_TTL = 86400;

export async function GET() {
  if (!hasSupabaseConfig) {
    return NextResponse.json({ ipos: [], error: "Missing Supabase public credentials." }, { status: 500 });
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
