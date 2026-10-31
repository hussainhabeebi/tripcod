import { cookies } from "next/headers";
import { serverAuthHeaders, SERVER_API, SERVER_TOKEN } from "../../../lib/server";
import { BookingList } from "./BookingList";
export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const filters = await searchParams;
  // Preserve the existing server-side service-token fallback for Cloudflare Access
  // sessions without an admin login cookie. Normal logins use their own JWT.
  let initial: Record<string, { bookings?: any[]; error?: string }> | undefined;
  if (!(await cookies()).get("tripcod_admin_token") && (SERVER_TOKEN || process.env.ADMIN_API_TOKEN)) {
    const headers = await serverAuthHeaders();
    const query = new URLSearchParams(filters); query.delete("type");
    const reads = await Promise.all((["flights", "hotels"] as const).map(async kind => {
      try {
        const response = await fetch(`${SERVER_API}/api/admin/bookings${kind === "hotels" ? "/hotels" : ""}?${query}`, { headers, cache: "no-store" });
        if (!response.ok) return [kind, { error: `Could not load ${kind} (HTTP ${response.status})` }];
        return [kind, await response.json()];
      } catch { return [kind, { error: `Could not load ${kind}` }]; }
    }));
    initial = Object.fromEntries(reads);
  }
  return <BookingList filters={filters} initial={initial} />;
}
