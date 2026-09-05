import os
import requests
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") 
supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

IPO_CACHE_KEY = "ipos:calendar"

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

    for ipo_item in ipo_items:
        company_name = ipo_item.get("name")
        if not company_name:
            print("Skipping IPO record without a company name.")
            continue

        record = {
            "company_name": company_name,
            "issue_type": ipo_item.get("type"),
            "open_date": ipo_item.get("startDate"),
            "close_date": ipo_item.get("endDate"),
            "listing_date": ipo_item.get("listingDate"),
            "status": "Open"
        }

        existing = supabase.table("ipos").select("id").eq("company_name", company_name).execute()

        if existing.data:
            ipo_id = existing.data[0].get("id")
            supabase.table("ipos").update(record).eq("id", ipo_id).execute()
            print(f"Cron Updated live IPO: {company_name}")
        else:
            supabase.table("ipos").insert(record).execute()
            print(f"Cron Inserted live IPO: {company_name}")

    invalidate_redis()

if __name__ == "__main__":
    sync_daily_open_ipo()
