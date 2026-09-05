import { NextResponse } from "next/server";

// TEMPORARY testing lock: only requests carrying the shared edge secret
// (stamped by the Cloudflare Worker) may reach the origin directly.
// Exempt: localhost (local dev), /api/health (uptime monitors can't send
// custom headers on all plans). Fail OPEN when unconfigured so a missing
// env var can never take the site down — remove this once the custom
// domain + Cloudflare firewall replace it.
export function middleware(request) {
  const host = request.headers.get("host") || "";
  if (host.startsWith("localhost") || host.startsWith("127.")) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next();
  }

  const secret = process.env.EDGE_SECRET;
  if (!secret) return NextResponse.next();

  if (request.headers.get("x-edge-secret") === secret) {
    return NextResponse.next();
  }

  return new NextResponse("Direct origin access disabled during testing.", { status: 403 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
