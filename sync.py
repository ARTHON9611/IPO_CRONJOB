import os
from datetime import datetime, timezone
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

IPO_CACHE_KEY = "ipos:calendar"

def now_iso():
    return datetime.now(timezone.utc).isoformat()

def strip_updated_at(records):
    return [{k: v for k, v in r.items() if k != "updated_at"} for r in records]

def invalidate_redis():
    """Evict the cached IPO calendar from Upstash Redis so the next read is fresh."""
    url = os.environ.get("UPSTASH_REDIS_REST_URL")
    token = os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    if not url or not token:
        print("Redis not configured; skipping invalidation. Cache will self-heal by TTL.")
        return
    try:
        resp = requests.post(
            f"{url.rstrip('/')}/del/{IPO_CACHE_KEY}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=10,
        )
        resp.raise_for_status()
        print("Redis cache invalidated.")
    except Exception as e:
        print(f"Redis invalidation failed (cache will expire by TTL): {e}")

def legacy_upsert(records):
    """Per-row fallback when bulk upsert is unavailable (pre-migration DB)."""
    for record in records:
        company_name = record["company_name"]
        existing = supabase.table("ipos").select("id").eq("company_name", company_name).execute()
        if existing.data:
            ipo_id = existing.data[0].get("id")
            supabase.table("ipos").update(record).eq("id", ipo_id).execute()
            print(f"Cron Updated live IPO: {company_name}")
        else:
            supabase.table("ipos").insert(record).execute()
            print(f"Cron Inserted live IPO: {company_name}")

def close_missing(feed_names):
    """IPOs absent from the open feed are no longer open — mark them Closed
    so the board doesn't accumulate dead 'Open' rows forever."""
    try:
        rows = supabase.table("ipos").select("company_name").eq("status", "Open").execute().data or []
    except Exception as e:
        print(f"Could not list open IPOs for close-check: {e}")
        return
    stale = [r["company_name"] for r in rows if r.get("company_name") not in feed_names]
    for name in stale:
        payload = {"status": "Closed", "updated_at": now_iso()}
        try:
            supabase.table("ipos").update(payload).eq("company_name", name).execute()
        except Exception as e:
            if "updated_at" in str(e):
                supabase.table("ipos").update({"status": "Closed"}).eq("company_name", name).execute()
            else:
                raise
        print(f"Cron Closed stale IPO: {name}")
    if not stale:
        print("No stale open IPOs to close.")

def sync_daily_open_ipo():
    print("Running daily cron job for open IPO...")

    url = "https://api.ipoalerts.in/ipos?status=open"
    headers = {"x-api-key": os.environ.get("IPO_ALERTS_API_KEY")}

    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        data = response.json()
    except Exception as e:
        print(f"API Error: {e}")
        return

    ipos_data = data.get("ipos")

    if not ipos_data:
        print("No open IPOs returned from free tier.")
        return

    # Safely extract IPO dictionaries whether the API returns a list or a single object.
    if isinstance(ipos_data, list):
        ipo_items = [item for item in ipos_data if isinstance(item, dict)]
    elif isinstance(ipos_data, dict):
        ipo_items = [ipos_data]
    else:
        print("Unexpected or empty data format from API.")
        return

    if not ipo_items:
        print("No valid IPO records found in API response.")
        return

    ts = now_iso()
    records = []
    for ipo_item in ipo_items:
        company_name = ipo_item.get("name")
        if not company_name:
            print("Skipping IPO record without a company name.")
            continue
        records.append({
            "company_name": company_name,
            "issue_type": ipo_item.get("type"),
            "open_date": ipo_item.get("startDate"),
            "close_date": ipo_item.get("endDate"),
            "listing_date": ipo_item.get("listingDate"),
            "status": "Open",
            "updated_at": ts,
        })

    if not records:
        print("No valid IPO records to upsert.")
        return

    # Fast path: single bulk upsert (needs the unique index from the migration).
    try:
        supabase.table("ipos").upsert(records, on_conflict="company_name").execute()
        print(f"Cron bulk-upserted {len(records)} IPO records.")
    except Exception as e:
        print(f"Bulk upsert failed ({e}); falling back to per-row.")
        try:
            legacy_upsert(records)
        except Exception as e2:
            if "updated_at" in str(e2):
                print("Retrying without updated_at (run supabase/migrations/*_cache_hardening.sql).")
                legacy_upsert(strip_updated_at(records))
            else:
                raise

    close_missing({r["company_name"] for r in records})

    invalidate_redis()

if __name__ == "__main__":
    sync_daily_open_ipo()
