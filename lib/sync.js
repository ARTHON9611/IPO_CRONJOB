import { supabase, hasSupabaseConfig } from "@/lib/supabase";
import { invalidate } from "@/lib/redis";

const API_URL = "https://api.ipoalerts.in/ipos?status=open";
const IPO_CACHE_KEY = "ipos:calendar";

function toRecord(item, ts) {
  return {
    company_name: item?.name,
    issue_type: item?.type,
    open_date: item?.startDate ?? null,
    close_date: item?.endDate ?? null,
    listing_date: item?.listingDate ?? null,
    status: "Open",
    updated_at: ts,
  };
}

function stripUpdatedAt(records) {
  return records.map(({ updated_at, ...rest }) => rest);
}

async function legacyUpsert(records, retried = false) {
  // Per-row fallback when bulk upsert is unavailable (pre-migration DB).
  let inserted = 0;
  let updated = 0;
  let firstError = null;
  for (const record of records) {
    const { data: existing } = await supabase
      .from("ipos")
      .select("id")
      .eq("company_name", record.company_name)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase.from("ipos").update(record).eq("id", existing.id);
      if (!error) updated += 1;
      else firstError = firstError || error;
    } else {
      const { error } = await supabase.from("ipos").insert(record);
      if (!error) inserted += 1;
      else firstError = firstError || error;
    }
  }
  // Pre-migration DBs lack updated_at: without this retry the sync would
  // silently write nothing (all per-row writes fail on the missing column).
  if (inserted === 0 && updated === 0 && !retried && firstError && /updated_at/.test(firstError.message)) {
    console.error("Retrying without updated_at (run supabase/migrations/20260905_cache_hardening.sql).");
    return legacyUpsert(stripUpdatedAt(records), true);
  }
  return { inserted, updated };
}

async function closeMissing(feedNames) {
  // IPOs absent from the open feed are no longer open — mark Closed.
  const { data: rows, error } = await supabase.from("ipos").select("company_name").eq("status", "Open");
  if (error) {
    console.error("Could not list open IPOs for close-check:", error.message);
    return 0;
  }
  const stale = (rows ?? []).map((r) => r.company_name).filter((n) => n && !feedNames.has(n));
  let closed = 0;
  for (const name of stale) {
    const payload = { status: "Closed", updated_at: new Date().toISOString() };
    const attempt = await supabase.from("ipos").update(payload).eq("company_name", name);
    if (attempt.error && /updated_at/.test(attempt.error.message)) {
      const retry = await supabase.from("ipos").update({ status: "Closed" }).eq("company_name", name);
      if (!retry.error) closed += 1;
    } else if (!attempt.error) {
      closed += 1;
    }
  }
  return closed;
}

export async function syncOpenIpos() {
  if (!hasSupabaseConfig) {
    throw new Error("Missing Supabase public credentials for sync.");
  }

  const apiKey = process.env.IPO_ALERTS_API_KEY;
  if (!apiKey) throw new Error("Missing IPO_ALERTS_API_KEY.");

  const response = await fetch(API_URL, {
    headers: { "x-api-key": apiKey },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    throw new Error(`API responded with status ${response.status}`);
  }

  const payload = await response.json();
  let items = payload?.ipos;

  if (Array.isArray(items)) {
    items = items.filter((i) => i && typeof i === "object");
  } else if (items && typeof items === "object") {
    items = [items];
  } else {
    items = [];
  }

  const ts = new Date().toISOString();
  const records = items.filter((i) => i?.name).map((i) => toRecord(i, ts));

  let inserted = 0;
  let updated = 0;

  // Fast path: single bulk upsert (needs the unique index from the migration).
  const { error: bulkError } = await supabase
    .from("ipos")
    .upsert(records, { onConflict: "company_name" });
  if (bulkError) {
    console.error(`Bulk upsert failed (${bulkError.message}); falling back to per-row.`);
    try {
      ({ inserted, updated } = await legacyUpsert(records));
    } catch (err) {
      if (/updated_at/.test(err.message)) {
        ({ inserted, updated } = await legacyUpsert(stripUpdatedAt(records)));
      } else {
        throw err;
      }
    }
  } else {
    updated = records.length;
  }

  const closed = await closeMissing(new Set(records.map((r) => r.company_name)));

  await invalidate(IPO_CACHE_KEY);

  return { inserted, updated, closed, total: items.length };
}
