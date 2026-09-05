/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Let the edge CDN (Cloudflare) cache the IPO calendar HTML for a short window.
        // s-maxage: CDN cache time; stale-while-revalidate lets the CDN serve stale
        // instantly while fetching a fresh copy in the background. The Redis layer
        // at the origin absorbs the revalidation load.
        source: "/",
        headers: [
          { key: "Cache-Control", value: "s-maxage=60, stale-while-revalidate=300" },
        ],
      },
    ];
  },
};

export default nextConfig;
