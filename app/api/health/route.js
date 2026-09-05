import { NextResponse } from "next/server";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";

export const runtime = "nodejs";

// Data older than this is considered stale (daily cron + margin).
const STALE_AFTER_HOURS = 26;

export async function GET() {
  const checkedAt = new Date().toISOString();
  if (!hasSupabaseConfig) {
    return NextResponse.json({ ok: false, error: "Missing Supabase public credentials.", checkedAt }, { status: 500 });
  }

  try {
    const { data, count, error } = await supabase
      .from("ipos")
      .select("updated_at", { count: "exact" })
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1);
    if (error) throw error;

    const latest = data?.[0]?.updated_at ?? null;
    const ageHours = latest ? (Date.now() - new Date(latest).getTime()) / 3600000 : null;
    const stale = ageHours == null || ageHours > STALE_AFTER_HOURS;
    return NextResponse.json({
      ok: !stale,
      count: count ?? 0,
      latestUpdatedAt: latest,
      ageHours: ageHours == null ? null : +ageHours.toFixed(2),
      stale,
      checkedAt,
    }, { status: stale ? 503 : 200 });
  } catch (err) {
    // Pre-migration (no updated_at column yet): report count only.
    try {
      const { count } = await supabase.from("ipos").select("id", { count: "exact", head: true });
      return NextResponse.json({ ok: true, count: count ?? 0, stale: "unknown", note: "Run supabase migration for updated_at freshness.", checkedAt });
    } catch {
      return NextResponse.json({ ok: false, error: err.message, checkedAt }, { status: 500 });
    }
  }
}
