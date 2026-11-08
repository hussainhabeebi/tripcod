"use client";
// TripJack Hotel API v3 UAT certification: one ZIP per TripJack hotel booking with
// every request / response (search → review → book / hold → confirm → details →
// cancel) and HotelBookingSummary.json naming the scenario and any missing step.
import { useCallback, useEffect, useState } from "react";
import { API, apiHeaders } from "@/lib/api";

type Pack = {
  bookingId: string; firstCallAt: string; lastCallAt: string; calls: number; failedCalls: number;
  scenario: string; covered: string[]; missing: string[]; searchAndReviewFromSearchLogs?: boolean;
  order: { id: string; mode: string; status: string; supplierStatus: string | null; hotel: string | null } | null;
};

const STEP_LABEL: Record<string, string> = {
  Search: "Search", Review: "Review", InstantBook: "Instant book", HoldBook: "Hold", ConfirmHold: "Confirm hold",
  BookingDetails: "Booking details", Cancellation: "Cancellation",
};

async function download(path: string, fallback: string) {
  const res = await fetch(`${API}${path}`, { headers: apiHeaders() });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message ?? d.error ?? `HTTP ${res.status}`); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function HotelCertificationPacks() {
  const [packs, setPacks] = useState<Pack[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [lookup, setLookup] = useState("");

  const load = useCallback(async () => {
    setPacks(null); setError("");
    try {
      const res = await fetch(`${API}/api/admin/bookings/hotel-certification?limit=100`, { headers: apiHeaders() });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? d.message ?? `HTTP ${res.status}`);
      setPacks(d.packs);
    } catch (e: any) { setError(e.message); setPacks([]); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const get = async (id: string) => {
    setBusy(id); setError("");
    try { await download(`/api/admin/bookings/hotel-certification/${encodeURIComponent(id)}/zip`, `tripjack-hotel-${id}.zip`); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(""); }
  };

  return (
    <section id="hotel-uat-logs" style={{ marginBottom: 24, background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>Hotel UAT certification logs (TripJack Hotel API v3)</h2>
        <button type="button" style={pill} onClick={() => void load()}>Reload</button>
      </div>
      <p style={{ color: "#64748b", fontSize: 12, margin: "0 0 12px" }}>
        One ZIP per TripJack hotel booking ID: the original request (TripJack URL + apikey) and response JSON for Search, Review, Instant book or Hold,
        Confirm hold, Booking details and Cancellation, plus HotelBookingSummary.json with the scenario, the correlation / booking IDs and any missing step.
      </p>
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "0 0 12px" }}
        onSubmit={(e) => { e.preventDefault(); const id = lookup.trim(); if (id) void get(id); }}>
        <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="TripJack booking ID, e.g. TJP209903275079"
          aria-label="TripJack hotel booking ID" style={input} />
        <button type="submit" style={dl} disabled={!lookup.trim() || busy === lookup.trim()}>{busy && busy === lookup.trim() ? "Preparing…" : "Download ZIP"}</button>
      </form>
      {error && <p style={{ color: "#fca5a5", fontSize: 13 }}>{error}</p>}
      {!packs ? <p style={{ color: "#64748b", fontSize: 13 }}>Loading…</p> : !packs.length ? (
        <p style={{ color: "#64748b", fontSize: 13 }}>No hotel booking has been reviewed yet. A pack appears here as soon as a hotel room reaches Review.</p>
      ) : (
        <div style={{ overflowX: "auto", maxHeight: 520, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#1e293b" }}>{["Last call", "TripJack booking ID", "Scenario", "Steps logged", "Missing", "Calls", "Order", ""].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {packs.map((p) => (
                <tr key={p.bookingId} style={{ borderTop: "1px solid #1e293b" }}>
                  <td style={td}>{new Date(p.lastCallAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
                  <td style={{ ...td, fontFamily: "monospace", color: "#e2e8f0" }}>{p.bookingId}</td>
                  <td style={td}>{p.scenario.replace(/_/g, " ").toLowerCase()}</td>
                  <td style={td}>
                    {p.covered.map((s) => <span key={s} style={chip}>{STEP_LABEL[s] ?? s}</span>)}
                    {p.searchAndReviewFromSearchLogs && <span style={{ ...chip, color: "#94a3b8" }} title="Logged before booking folders existed; the ZIP adds them from the search logs">Search + Review from search logs</span>}
                  </td>
                  <td style={{ ...td, color: p.missing.length ? "#fbbf24" : "#4ade80" }}>{p.missing.length ? p.missing.map((s) => STEP_LABEL[s] ?? s).join(", ") : "none"}</td>
                  <td style={td}>{p.calls}{p.failedCalls ? <span style={{ color: "#f87171" }}> ({p.failedCalls} failed)</span> : null}</td>
                  <td style={{ ...td, fontSize: 12, color: "#94a3b8" }}>{p.order ? `${p.order.hotel ?? ""} · ${p.order.mode} · ${p.order.status}` : "—"}</td>
                  <td style={td}><button type="button" style={dl} disabled={busy === p.bookingId} onClick={() => void get(p.bookingId)}>{busy === p.bookingId ? "Preparing…" : "Download ZIP"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const pill: React.CSSProperties = { background: "#1e293b", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const dl: React.CSSProperties = { background: "#2563eb", color: "#fff", border: 0, borderRadius: 6, padding: "10px 12px", minHeight: 44, fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" };
const input: React.CSSProperties = { flex: "1 1 220px", minWidth: 0, width: "100%", maxWidth: 360, background: "#020617", color: "#f1f5f9", border: "1px solid #334155", borderRadius: 8, padding: "7px 10px", fontSize: 13, fontFamily: "monospace" };
const chip: React.CSSProperties = { display: "inline-block", background: "#1e293b", color: "#93c5fd", borderRadius: 99, padding: "2px 8px", fontSize: 11, margin: "0 4px 4px 0" };
const th: React.CSSProperties = { padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#475569", textTransform: "uppercase", whiteSpace: "nowrap" };
const td: React.CSSProperties = { padding: "8px 12px", verticalAlign: "top", color: "#cbd5e1" };
