import { supabase, hasSupabaseConfig } from "@/lib/supabase";
import { invalidate } from "@/lib/redis";

const API_URL = "https://api.ipoalerts.in/ipos?status=open";
const IPO_CACHE_KEY = "ipos:calendar";

function toRecord(item) {
  return {
    company_name: item?.name,
    issue_type: item?.type,
    open_date: item?.startDate ?? null,
    close_date: item?.endDate ?? null,
    listing_date: item?.listingDate ?? null,
    status: "Open",
  };
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

  let inserted = 0;
  let updated = 0;

  for (const item of items) {
    const companyName = item?.name;
    if (!companyName) continue;

    const record = toRecord(item);

    const { data: existing } = await supabase
      .from("ipos")
      .select("id")
      .eq("company_name", companyName)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("ipos")
        .update(record)
        .eq("id", existing.id);
      if (!error) updated += 1;
    } else {
      const { error } = await supabase.from("ipos").insert(record);
      if (!error) inserted += 1;
    }
  }

  await invalidate(IPO_CACHE_KEY);

  return { inserted, updated, total: items.length };
}
