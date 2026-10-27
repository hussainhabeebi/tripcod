"use client";
import { useCallback, useEffect, useState } from "react";
import { API, apiHeaders } from "@/lib/api";

// TripJack Hotel v3 search takes hotel IDs, not cities. This builds the city →
// region index from TripJack's City Region IDs API (paged, a few pages per call).
export function HotelCitySync() {
  const [status, setStatus] = useState<{ ready: boolean; builtAt: string | null; cities: number; inProgress: boolean; pagesDone: number; regionsSoFar: number; phase?: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/admin/hotels/city-index`, { headers: apiHeaders() });
      if (!res.ok) throw new Error("Could not load saved sync status. Refresh before syncing.");
      const saved = await res.json();
      if (typeof saved.ready !== "boolean" || typeof saved.inProgress !== "boolean") throw new Error("Invalid sync status response");
      setStatus(saved);
    } catch { setError("Could not load saved sync status. Refresh before syncing; do not restart."); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function sync(restart: boolean) {
    if (!status) return;
    setRunning(true); setError(""); setProgress("Starting…");
    try {
      let first = true;
      let done = false;
      for (let i = 0; i < 200; i++) {
        const res = await fetch(`${API}/api/admin/hotels/city-index/sync`, {
          method: "POST", headers: apiHeaders(), body: JSON.stringify({ restart: restart && first }),
        });
        first = false;
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`${d.page ? `Page ${d.page}: ` : ""}${d.error ?? `HTTP ${res.status}`}${d.errorCode ? ` (${d.errorCode})` : ""}${d.httpStatus ? ` · HTTP ${d.httpStatus}` : ""}${d.upstreamStatus ? ` · supplier HTTP ${d.upstreamStatus}` : ""}${d.gatewayRequestId ? ` · gateway ${d.gatewayRequestId}` : ""}${d.requestId ? ` · request ${d.requestId}` : ""}`);
        if (typeof d.done !== "boolean" || !Number.isFinite(d.pages) || !Number.isFinite(d.regions)) throw new Error("Invalid sync response; refresh the saved status before continuing");
        setProgress(`${d.phase ?? "Syncing"} · ${d.pages} pages · ${Number(d.regions).toLocaleString()} regions`);
        if (d.done) { done = true; setProgress(`Done — ${Number(d.cities).toLocaleString()} cities`); break; }
        // Bounded pacing, no automatic retry of failed supplier requests.
        if (i < 199) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!done) setProgress((p) => `${p} — paused safely. Press Continue sync to resume.`);
    } catch (e: any) {
      setError(`${e instanceof TypeError ? "Admin connection failed; no supplier HTTP response was available in this browser" : e.message} — saved pages are preserved. Refresh status and Continue sync; do not restart. See Supplier logs using the request reference if available.`);
    } finally {
      setRunning(false); void load();
    }
  }

  return (
    <div style={{ border: "1px solid #334155", borderRadius: 10, padding: 14, margin: "16px 0" }}>
      <div style={{ fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>Hotel city list (TripJack Hotel API v3)</div>
      <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 10px", lineHeight: 1.5 }}>
        Hotel search needs TripJack&apos;s city → hotel ID list. Sync it once after setup, then about monthly.
        {status && (status.ready
          ? <> Current list: <b>{status.cities.toLocaleString()}</b> cities, synced {status.builtAt ? new Date(status.builtAt).toLocaleString() : ""}.</>
          : status.inProgress ? <> A sync is part-way ({status.pagesDone} pages) — press <b>Continue sync</b>.</>
          : <> <b style={{ color: "#fbbf24" }}>Not synced yet — hotel search will not work until it is.</b></>)}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" disabled={running || !status} onClick={() => sync(!status?.inProgress)}
          style={{ background: "#2563eb", color: "#fff", border: 0, borderRadius: 8, padding: "8px 14px", fontWeight: 700, cursor: "pointer" }}>
          {!status ? "Loading sync status…" : running ? "Syncing…" : status?.inProgress ? "Continue sync" : "Sync hotel cities"}
        </button>
        {progress && <span style={{ color: "#94a3b8", fontSize: 13 }}>{progress}</span>}
      </div>
      {error && <div style={{ color: "#fca5a5", fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  );
}
