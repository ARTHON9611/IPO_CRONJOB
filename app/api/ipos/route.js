import { NextResponse } from "next/server";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";
import { hasRedis, getCached } from "@/lib/redis";

export const runtime = "nodejs";

const IPO_CACHE_KEY = "ipos:calendar";
const IPO_CACHE_TTL = 60;

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
