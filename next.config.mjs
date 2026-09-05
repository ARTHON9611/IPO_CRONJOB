/** @type {import('next').NextConfig} */
const nextConfig = {
  // Edge caching is owned by ISR: app/page.js sets `revalidate = 60`, so Next
  // emits `s-maxage` itself and any CDN (Vercel edge, Cloudflare) can cache.
  // On-demand refresh happens via revalidatePath("/") in app/admin/sync/route.js.
};

export default nextConfig;
