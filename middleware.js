import { NextResponse } from "next/server";

// Canonical-host enforcement: the app's public face is https://ipo.arthon.dev
// (Cloudflare-proxied). Direct hits to other hosts (e.g. *.vercel.app) are
// redirected to canonical, except:
// - localhost (local dev)
// - /api/health (uptime monitors may check any URL)
const CANONICAL_HOST = "ipo.arthon.dev";

export function middleware(request) {
  const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();

  if (host.startsWith("localhost") || host.startsWith("127.")) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  if (host === CANONICAL_HOST) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.host = CANONICAL_HOST;
  url.protocol = "https:";
  url.port = "";
  return NextResponse.redirect(url, 301);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
