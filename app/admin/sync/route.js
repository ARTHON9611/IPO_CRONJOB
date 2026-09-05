import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { syncOpenIpos } from "@/lib/sync";

export const runtime = "nodejs";

const expectedClientId = process.env.CF_ACCESS_CLIENT_ID;
const expectedSecret = process.env.CF_ACCESS_CLIENT_SECRET;
const adminToken = process.env.ADMIN_SYNC_TOKEN;

function isAuthorized(request) {
  // Option 1: Cloudflare Access service token headers (set automatically when
  // the request passes through a Cloudflare Access application using a service
  // token as the identity provider).
  const cfId = request.headers.get("cf-access-client-id");
  const cfSecret = request.headers.get("cf-access-client-secret");
  if (expectedClientId && expectedSecret && cfId === expectedClientId && cfSecret === expectedSecret) {
    return true;
  }

  // Option 2: Simple shared admin token sent as `Authorization: Bearer <token>`
  // or `x-admin-token`. Use this when calling the route directly (e.g. curl or a
  // GitHub Actions cron) without Cloudflare Access in front.
  const auth = request.headers.get("authorization") || "";
  const headerToken = request.headers.get("x-admin-token");
  if (adminToken && (auth === `Bearer ${adminToken}` || headerToken === adminToken)) {
    return true;
  }

  return false;
}

export async function POST(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncOpenIpos();
    // Instantly refresh the ISR-cached homepage (Vercel edge + any CDN)
    // so the new data is visible immediately instead of waiting for revalidate.
    revalidatePath("/");
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
