import Link from "next/link";

export const revalidate = 60;

function formatDate(value) {
  if (!value) return "TBA";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatPrice(low, high) {
  if (low == null && high == null) return "TBA";
  if (low === high || high == null) return `Rs. ${low}`;
  return `Rs. ${low} - ${high}`;
}

function statusClass(status) {
  const normalized = status?.toLowerCase();
  if (normalized === "open") return "status status-open";
  if (normalized === "upcoming") return "status status-upcoming";
  return "status status-closed";
}

async function getIpos() {
  // Fetch the same-origin API route with ISR caching. This keeps all
  // no-store SDK fetches (Upstash/Supabase) inside the dynamic API route so
  // this page prerenders statically and serves `s-maxage` at the edge.
  // NOTE: no headers()/cookies() here — those Dynamic APIs would force the
  // page dynamic and kill ISR. Base URL comes from env instead.
  // Prefer the stable public alias (NEXT_PUBLIC_SITE_URL): Vercel's
  // auto VERCEL_URL points at the gated deployment URL (Deployment
  // Protection returns an HTML login page there, breaking self-fetch).
  const baseUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  try {
    const res = await fetch(`${baseUrl}/api/ipos`, { next: { revalidate: 60 } });
    if (!res.ok) return { ipos: [], error: `API responded with status ${res.status}` };
    const payload = await res.json();
    if (payload.error) return { ipos: [], error: payload.error };
    const cacheInfo = payload.redis ? { from: payload.from } : null;
    return { ipos: payload.ipos ?? [], error: null, cacheInfo };
  } catch (err) {
    return { ipos: [], error: err.message };
  }
}

export default async function Home() {
  const { ipos, error, cacheInfo } = await getIpos();
  const openCount = ipos.filter((ipo) => ipo.status?.toLowerCase() === "open").length;

  return (
    <main>
      <header className="topbar">
        <Link className="brand" href="/">IPO Board</Link>
        <span className="market-label">India / Primary Markets</span>
      </header>

      <section className="page-heading" aria-labelledby="page-title">
        <div>
          <p className="eyebrow">Market calendar</p>
          <h1 id="page-title">Initial public offerings</h1>
          <p className="intro">Track active and upcoming public issues in one practical view.</p>
        </div>
        <div className="summary" aria-label={`${openCount} IPOs currently open`}>
          <span>Open now</span>
          <strong>{openCount}</strong>
        </div>
      </section>

      <section className="table-section" aria-label="IPO calendar">
        <div className="section-bar">
          <h2>IPO calendar</h2>
          <div className="section-bar-tools">
            <span>{ipos.length} issues</span>
            {cacheInfo && (
              <span className={`cache-pill ${cacheInfo.from === "redis" ? "cache-hit" : cacheInfo.from === "stale" ? "cache-stale" : "cache-miss"}`} title="Data source">
                {cacheInfo.from === "redis" ? "redis·cached" : cacheInfo.from === "stale" ? "stale·cache" : "db·direct"}
              </span>
            )}
          </div>
        </div>

        {error ? (
          <div className="notice" role="status">
            {error === "Missing Supabase public credentials."
              ? "Add the Supabase URL and anon key to .env.local to load IPO data."
              : `Unable to load IPO data: ${error}`}
          </div>
        ) : ipos.length === 0 ? (
          <div className="notice" role="status">No IPO records are available yet.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Issue type</th>
                  <th scope="col">Issue window</th>
                  <th scope="col">Price band</th>
                  <th scope="col">Lot size</th>
                  <th scope="col">Issue size</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {ipos.map((ipo) => (
                  <tr key={ipo.id}>
                    <td className="company-cell">
                      <strong>{ipo.company_name}</strong>
                      <span>Listing: {formatDate(ipo.listing_date)}</span>
                    </td>
                    <td>{ipo.issue_type || "Mainboard"}</td>
                    <td>
                      <span className="date-range">{formatDate(ipo.open_date)}</span>
                      <span className="date-range">to {formatDate(ipo.close_date)}</span>
                    </td>
                    <td>{formatPrice(ipo.price_band_low, ipo.price_band_high)}</td>
                    <td>{ipo.lot_size ?? "TBA"}</td>
                    <td>{ipo.issue_size_cr ? `Rs. ${ipo.issue_size_cr} Cr` : "TBA"}</td>
                    <td><span className={statusClass(ipo.status)}>{ipo.status || "Unknown"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
