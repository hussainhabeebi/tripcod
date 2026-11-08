"use client";
// Admin → Bookings → Hotel booking details. Same layout as the Flight booking
// page: tabs, cards, and an API logs table with each TripJack request /
// response as its own JSON file. Read-only: no supplier call, cancellation or
// payment is made from here. API keys are masked by the API; PAN / passport
// numbers are masked on screen.
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API, apiHeaders } from "@/lib/api";

type Tab = "overview" | "rooms" | "policy" | "payments" | "logs";

const STATUS_COLOR: Record<string, string> = {
  CONFIRMED: "#4ade80", ON_HOLD: "#fbbf24", PROCESSING: "#93c5fd", PAYMENT_PENDING: "#fbbf24", FAILED: "#f87171",
  CANCELLATION_PENDING: "#a5b4fc", CANCELLED: "#94a3b8",
};
// Order of the TripJack Hotel v3 certification steps.
const STEPS = ["Search", "HotelDetail", "Review", "HoldBook", "InstantBook", "ConfirmHold", "BookingDetails", "Cancellation"];
const STEP_LABEL: Record<string, string> = {
  Search: "Search", HotelDetail: "Detail", Review: "Review", HoldBook: "Hold", InstantBook: "Instant Book",
  ConfirmHold: "Confirm Hold", BookingDetails: "Booking Details", Cancellation: "Cancellation",
};
const OUTCOME_TEXT: Record<string, string> = {
  ON_HOLD: "Hold still open", UNKNOWN: "No Booking Details status yet",
  CANCELLED_ON_REQUEST: "Cancelled on request (cancel-booking called)",
  CANCELLED_BY_TRIPJACK_AFTER_HOLD_DEADLINE: "Cancelled by TripJack after the hold deadline",
};

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const fmtTime = (s?: string | null) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "medium" }) : "—");
// TripJack times without an offset are IST.
const fmtIst = (s?: string | null) => (s ? `${s.replace("T", " ")}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : " IST"}` : "—");
const money = (v: unknown, cur: string) => v === null || v === undefined || v === "" ? "—" : `${cur} ${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskId = (v?: string | null) => !v ? "—" : v.length <= 4 ? "••••" : `${v.slice(0, 2)}${"•".repeat(Math.max(v.length - 4, 2))}${v.slice(-2)}`;
const label = (s?: string | null) => (s ? s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "—");

export default function HotelBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<any>(null);
  const [logs, setLogs] = useState<{ exchanges: any[]; certification: any } | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [busy, setBusy] = useState("");
  const [viewer, setViewer] = useState<{ title: string; name: string; text: string; pretty: boolean } | null>(null);
  const root = `/api/admin/bookings/hotels/${encodeURIComponent(id)}`;
  // Phones: each call as a stacked card instead of a wide table.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(mq.matches);
    update(); mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  async function get(path: string) {
    const res = await fetch(`${API}${path}`, { headers: apiHeaders() });
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.message ?? d.error ?? `HTTP ${res.status}`); }
    return res;
  }
  useEffect(() => {
    let active = true;
    get(root).then((r) => r.json()).then((d) => { if (active) setBooking(d.booking); }).catch((e) => { if (active) setError(e.message); });
    get(`${root}/exchanges`).then((r) => r.json()).then((d) => { if (active) setLogs({ exchanges: d.exchanges ?? [], certification: d.certification ?? null }); })
      .catch((e) => { if (active) { setError(e.message); setLogs({ exchanges: [], certification: null }); } });
    return () => { active = false; };
  }, [root]);

  const fileName = (res: Response, fallback: string) => /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallback;
  async function view(x: any, part: "request" | "response") {
    setBusy(`${x.id}-${part}`); setError("");
    try {
      const res = await get(`${root}/exchanges/${x.id}/${part}`);
      setViewer({ title: `${x.label} — ${part}`, name: fileName(res, `${part}.json`), text: await res.text(), pretty: false });
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }
  async function download(path: string, key: string, fallback: string) {
    setBusy(key); setError("");
    try {
      const res = await get(path);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = fileName(res, fallback);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { setError(e.message); } finally { setBusy(""); }
  }

  const callCell = (x: any) => (
    <span style={{ minWidth: 0 }}>
      <strong>{x.label}</strong>
      {x.supplierStatus && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 800, color: STATUS_COLOR[x.supplierStatus] ?? "#cbd5e1" }}>{x.supplierStatus}</span>}
      <small style={{ display: "block", color: "#64748b", fontFamily: "monospace", overflowWrap: "anywhere" }}>{x.endpoint}</small>
      {(x.gatewayRequestId || x.requestId) && <small style={{ display: "block", color: "#64748b", fontFamily: "monospace", overflowWrap: "anywhere" }}>req {x.gatewayRequestId ?? x.requestId}</small>}
      {x.supplierError && <small style={{ display: "block", color: "#fca5a5", marginTop: 2 }}>{x.errorCode ? `${x.errorCode}: ` : ""}{x.supplierError}</small>}
    </span>
  );
  const requestButtons = (x: any) => (
    <span style={{ display: "flex", gap: 6 }}>
      <button disabled={!!busy} onClick={() => view(x, "request")} style={small}>View</button>
      <button disabled={!!busy} onClick={() => download(`${root}/exchanges/${x.id}/request`, `${x.id}-rq`, `${x.name}Request.json`)} style={small}>Download</button>
    </span>
  );
  const responseButtons = (x: any) => x.hasResponse ? (
    <span style={{ display: "flex", gap: 6 }}>
      <button disabled={!!busy} onClick={() => view(x, "response")} style={small}>View</button>
      <button disabled={!!busy} onClick={() => download(`${root}/exchanges/${x.id}/response`, `${x.id}-rs`, `${x.name}Response.json`)} style={small}>Download</button>
    </span>
  ) : <span style={{ color: "#f87171", fontSize: 12 }}>{x.transportError ?? "No response"}</span>;

  if (error && !booking) return <div><a href="/bookings" style={backLink}>← Bookings</a><div style={errBox} role="alert">{error}</div></div>;
  if (!booking) return <p style={{ color: "#64748b" }} role="status">Loading hotel booking…</p>;

  const b = booking, h = b.hotel ?? {}, opt = b.option ?? {}, pricing = opt.pricing ?? {}, policy = opt.cancellation ?? {};
  const rooms: { adults: number; childAges?: number[] }[] = Array.isArray(b.occupancy) ? b.occupancy : [];
  const guests: any[][] = Array.isArray(b.guests) ? b.guests : [];
  const adults = rooms.reduce((n, r) => n + (r.adults ?? 0), 0), children = rooms.reduce((n, r) => n + (r.childAges?.length ?? 0), 0);
  const exchanges = logs?.exchanges ?? [];
  const cert = logs?.certification;
  const TABS: [Tab, string][] = [["overview", "Overview"], ["rooms", `Rooms & guests (${rooms.length})`], ["policy", "Cancellation policy"],
    ["payments", "Payments & refunds"], ["logs", `API logs (${logs ? exchanges.length : "…"})`]];

  return (
    <div style={{ minWidth: 0 }}>
      <a href="/bookings" style={backLink}>← Bookings</a>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", margin: "10px 0 16px" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "#f1f5f9", margin: 0, overflowWrap: "anywhere" }}>{h.name ?? "Hotel booking"}</h1>
          <div style={{ color: "#94a3b8", fontSize: 13, marginTop: 4, overflowWrap: "anywhere" }}>
            {[h.city, h.countryCode].filter(Boolean).join(", ")} · {h.checkIn ?? "—"} → {h.checkOut ?? "—"} · TripJack <strong style={{ color: "#e2e8f0" }}>{b.supplierBookingId}</strong> · <span style={{ fontFamily: "monospace" }}>{b.id}</span>
          </div>
        </div>
        <span style={{ color: STATUS_COLOR[b.status] ?? "#94a3b8", fontWeight: 800, fontSize: 13, border: "1px solid #334155", borderRadius: 20, padding: "5px 12px" }}>{b.status}</span>
      </div>

      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: "1px solid #334155", marginBottom: 16, overflowX: "auto" }}>
        {TABS.map(([k, text]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} style={{
            background: "none", border: 0, borderBottom: `2px solid ${tab === k ? "#4B4D4F" : "transparent"}`, color: tab === k ? "#f1f5f9" : "#94a3b8",
            padding: "10px 14px", fontWeight: 700, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
          }}>{text}</button>
        ))}
      </div>

      {error && <div style={errBox} role="alert">{error}</div>}
      {b.holdExpired && <div style={warnBox}>The hold deadline ({fmtIst(b.holdDeadline)}) has passed. The status follows TripJack&apos;s Booking Details — it is shown as cancelled only when TripJack reports CANCELLED.</div>}
      {b.lastError && <div style={errBox}><b>Last supplier error:</b> {b.lastError}</div>}

      {tab === "overview" && (
        <div style={grid}>
          <Card title="Booking">
            <Row k="Status" v={b.statusText ?? b.status} /><Row k="TripJack status" v={b.supplierStatus ?? "—"} />
            <Row k="Booking type" v={b.mode === "HOLD" ? "Hold (pay later)" : "Instant"} />
            {b.mode === "HOLD" && <Row k="Hold deadline" v={`${fmtIst(b.holdDeadline)}${b.holdExpired ? " · passed" : ""}`} />}
            <Row k="Confirmation no." v={b.confirmationNo ?? "—"} mono /><Row k="Booked" v={fmtDate(b.createdAt)} />
          </Card>
          <Card title="Hotel">
            <Row k="Hotel" v={h.name ?? "—"} /><Row k="Stars" v={h.stars ? "★".repeat(Math.round(h.stars)) : "—"} />
            <Row k="Address" v={[h.address, h.city, h.countryCode].filter(Boolean).join(", ") || "—"} />
            <Row k="Stay" v={`${h.checkIn ?? "—"} → ${h.checkOut ?? "—"}${h.nights ? ` · ${h.nights} night${h.nights === 1 ? "" : "s"}` : ""}`} />
            <Row k="Room" v={(opt.roomInfo ?? []).map((r: any) => r.name).filter(Boolean).join(" + ") || "—"} />
            <Row k="Meal plan" v={opt.mealBasis || "—"} />
          </Card>
          <Card title="Amounts">
            <Row k="Base price" v={money(pricing.basePrice, b.currency)} /><Row k="Taxes" v={money(pricing.taxes, b.currency)} />
            {Number(pricing.discount) > 0 && <Row k="Discount" v={`− ${money(pricing.discount, b.currency)}`} />}
            {(Number(pricing.mf) > 0 || Number(pricing.mft) > 0) && <Row k="Management fee + tax" v={money(Number(pricing.mf ?? 0) + Number(pricing.mft ?? 0), b.currency)} />}
            <Row k="Total" v={money(b.amount, b.currency)} />
          </Card>
          <Card title="Customer & supplier">
            <Row k="Contact email" v={b.contactEmail ?? "—"} /><Row k="Contact phone" v={b.contactPhone ? `${b.dialCode ?? ""} ${b.contactPhone}` : "—"} />
            <Row k="Account" v={b.userId ? "Signed-in customer" : "Guest checkout"} /><Row k="Nationality" v={b.nationality ?? "—"} />
            <Row k="Supplier" v="TripJack Hotel API v3" /><Row k="TripJack booking ID" v={b.supplierBookingId} mono />
          </Card>
        </div>
      )}

      {tab === "rooms" && (
        <div style={{ display: "grid", gap: 12 }}>
          <Card title={`Occupancy — ${adults} adult${adults === 1 ? "" : "s"}, ${children} child${children === 1 ? "" : "ren"}, ${rooms.length} room${rooms.length === 1 ? "" : "s"}`}>
            {opt.inclusions?.length ? <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 10px" }}>Inclusions: {opt.inclusions.join(", ")}</p> : null}
            {rooms.map((r, i) => (
              <div key={i} style={{ borderTop: i ? "1px solid #334155" : 0, paddingTop: i ? 12 : 0, marginTop: i ? 12 : 0 }}>
                <div style={{ color: "#e2e8f0", fontWeight: 700, fontSize: 13, marginBottom: 6 }}>
                  Room {i + 1}{opt.roomInfo?.[i]?.name ? ` · ${opt.roomInfo[i].name}` : ""} — {r.adults} adult{r.adults === 1 ? "" : "s"}
                  {r.childAges?.length ? `, ${r.childAges.length} child${r.childAges.length === 1 ? "" : "ren"} (age${r.childAges.length === 1 ? "" : "s"} ${r.childAges.join(", ")})` : ""}
                </div>
                <Table head={["#", "Type", "Name", "PAN", "Passport"]} rows={(guests[i] ?? []).map((g: any, j: number) => [
                  j + 1, label(g.type), `${g.title ? `${g.title} ` : ""}${g.firstName ?? ""} ${g.lastName ?? ""}`.trim(), maskId(g.pan), maskId(g.passport),
                ])} />
              </div>
            ))}
            {!rooms.length && <p style={muted}>No occupancy recorded.</p>}
          </Card>
        </div>
      )}

      {tab === "policy" && (
        <div style={grid}>
          <Card title="Supplier cancellation policy">
            <Row k="Refundable" v={policy.isRefundable === undefined ? "—" : policy.isRefundable ? "Yes" : "No (non-refundable)"} />
            <Row k="Free cancellation until" v={fmtIst(policy.deadlineDateTime)} />
            <div style={{ marginTop: 10 }}>
              <Table head={["From", "To", "Charge"]} rows={(policy.penalties ?? []).map((p: any) => [fmtIst(p.from), fmtIst(p.to), Number(p.amount) === 0 ? "Free" : money(p.amount, b.currency)])} />
            </div>
          </Card>
          <Card title="Recorded cancellation">
            {b.cancellation ? <>
              <Row k="Requested" v={fmtDate(b.cancellation.requestedAt)} /><Row k="Status before" v={label(b.cancellation.previousStatus)} />
              <Row k="Charge" v={money(b.cancellation.charge, b.currency)} /><Row k="Refund" v={money(b.cancellation.refund, b.currency)} />
              <Row k="Basis" v={label(b.cancellation.basis)} />
            </> : <p style={muted}>{b.status === "CANCELLED" ? "No cancellation request from Tripcod — TripJack cancelled this booking (e.g. an unconfirmed hold after its deadline)." : "Not cancelled."}</p>}
          </Card>
        </div>
      )}

      {tab === "payments" && (
        <Card title="Payment">
          <Row k="Status" v={label(b.payment?.status)} /><Row k="Gateway" v={b.payment?.gateway ?? "—"} />
          <Row k="Paid at" v={fmtDate(b.payment?.paidAt)} /><Row k="Payment reference" v={b.paymentRef || b.paymentOrderId || "—"} mono />
          <Row k="Refund amount" v={money(b.payment?.refundAmount, b.currency)} /><Row k="Refund note" v={b.payment?.refundNote || "—"} />
        </Card>
      )}

      {tab === "logs" && (
        <Card title="Supplier API request / response logs">
          <p style={{ color: "#94a3b8", fontSize: 13, margin: "0 0 12px" }}>
            Every TripJack Hotel v3 call for this booking — Search, Detail, Review, Hold / Instant Book, Confirm Hold, Booking Details and Cancellation — oldest first.
            Responses are shown exactly as stored. On this page the API key in requests is masked; the certification ZIP contains the requests exactly as TripJack received them.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <button disabled={!!busy || !exchanges.length} onClick={() => download(`${root}/certification.zip`, "zip", `tripjack-hotel-${b.supplierBookingId}.zip`)} style={btn}>
              {busy === "zip" ? "Preparing…" : "Download TripJack Certification ZIP"}
            </button>
          </div>
          {cert && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12, fontSize: 13 }}>
              <span style={{ color: "#94a3b8" }}>Certification set ({label(cert.scenario)}):</span>
              {STEPS.filter((s) => cert.covered?.includes(s) || cert.missing?.includes(s)).map((s) => {
                const ok = cert.covered?.includes(s);
                return <span key={s} title={ok ? `${STEP_LABEL[s]} logged` : `${STEP_LABEL[s]} not logged for this booking`}
                  style={{ padding: "3px 10px", borderRadius: 999, fontWeight: 700, background: ok ? "#052e16" : "#450a0a", color: ok ? "#86efac" : "#fca5a5" }}>{ok ? "✓" : "✗"} {STEP_LABEL[s]}</span>;
              })}
              {cert.holdLifecycle && <span style={{ color: "#cbd5e1" }}>· Hold: {OUTCOME_TEXT[cert.holdLifecycle.outcome] ?? cert.holdLifecycle.outcome}</span>}
            </div>
          )}
          {!logs ? <p style={muted} role="status">Loading logs…</p> : !exchanges.length ? (
            <p style={muted}>No stored request / response logs for this booking.</p>
          ) : narrow ? (
            <div style={{ display: "grid", gap: 10 }}>
              {exchanges.map((x: any) => (
                <div key={x.id} data-call={x.id} style={{ border: `1px solid ${x.ok ? "#334155" : "#7f1d1d"}`, borderRadius: 10, padding: 12, background: x.ok ? "transparent" : "rgba(239,68,68,.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                    {callCell(x)}
                    <span style={{ color: x.ok ? "#4ade80" : "#f87171", fontWeight: 700, whiteSpace: "nowrap", fontSize: 13 }}>{x.ok ? "✓" : "✗"} {x.httpStatus ?? (x.transportError ? "ERR" : "—")}</span>
                  </div>
                  <div style={{ color: "#94a3b8", fontSize: 12, margin: "6px 0 8px" }}>{fmtTime(x.startedAt)} · {x.durationMs !== null && x.durationMs !== undefined ? `${x.durationMs} ms` : "—"}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "#94a3b8" }}>
                    <span style={{ minWidth: 64 }}>Request</span>{requestButtons(x)}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
                    <span style={{ minWidth: 64 }}>Response</span>{responseButtons(x)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Table head={["Time", "API Call", "HTTP Status", "Duration", "Request", "Response"]}
              rows={exchanges.map((x: any) => [
                <span key="t" style={{ whiteSpace: "nowrap" }}>{fmtTime(x.startedAt)}</span>,
                <span key="c" style={{ display: "block", minWidth: 180 }}>{callCell(x)}</span>,
                <span key="h" style={{ color: x.ok ? "#4ade80" : "#f87171", fontWeight: 700, whiteSpace: "nowrap" }}>{x.ok ? "✓" : "✗"} {x.httpStatus ?? (x.transportError ? "ERR" : "—")}</span>,
                x.durationMs !== null && x.durationMs !== undefined ? `${x.durationMs} ms` : "—",
                <span key="rq">{requestButtons(x)}</span>,
                <span key="rs">{responseButtons(x)}</span>,
              ])} />
          )}
        </Card>
      )}

      {viewer && (
        <div onClick={() => setViewer(null)} style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,.75)", zIndex: 50, display: "grid", placeItems: "center", padding: 16 }}>
          <div role="dialog" aria-label={viewer.title} onClick={(e) => e.stopPropagation()} style={{ ...card, width: "min(1000px, 100%)", maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}><strong style={{ color: "#f1f5f9" }}>{viewer.title}</strong><small style={{ display: "block", color: "#64748b", fontFamily: "monospace", overflowWrap: "anywhere" }}>{viewer.name}</small></div>
              <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => setViewer({ ...viewer, pretty: !viewer.pretty })} style={small}>{viewer.pretty ? "Show raw" : "Pretty print (view only)"}</button>
                <button onClick={() => navigator.clipboard?.writeText(viewer.text)} style={small}>Copy raw</button>
                <button onClick={() => setViewer(null)} style={small}>Close</button>
              </span>
            </div>
            <pre tabIndex={0} style={{ margin: 0, overflow: "auto", background: "#020617", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 12, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {viewer.pretty ? prettyOrRaw(viewer.text) : viewer.text}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function prettyOrRaw(text: string) {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={card}><h2 style={{ fontSize: 14, color: "#cbd5e1", margin: "0 0 10px", fontWeight: 700 }}>{title}</h2>{children}</section>;
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", borderTop: "1px solid #1e293b", fontSize: 13 }}>
      <span style={{ color: "#94a3b8", flexShrink: 0 }}>{k}</span>
      <span style={{ color: "#e2e8f0", textAlign: "right", overflowWrap: "anywhere", minWidth: 0, fontFamily: mono ? "monospace" : "inherit" }}>{v}</span>
    </div>
  );
}
function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  if (!rows.length) return <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>None.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead><tr>{head.map((x) => <th key={x} style={{ textAlign: "left", color: "#64748b", fontWeight: 600, padding: "6px 8px", borderBottom: "1px solid #334155", whiteSpace: "nowrap" }}>{x}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} style={{ padding: "8px", borderBottom: "1px solid #1e293b", color: "#e2e8f0", verticalAlign: "top" }}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const card: React.CSSProperties = { background: "#1e293b", borderRadius: 12, padding: 16, border: "1px solid #334155", minWidth: 0 };
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12 };
const backLink: React.CSSProperties = { color: "#94a3b8", fontSize: 13, textDecoration: "none" };
const btn: React.CSSProperties = { background: "#4B4D4F", color: "#fff", border: 0, borderRadius: 8, padding: "8px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" };
const small: React.CSSProperties = { background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0", borderRadius: 6, padding: "4px 8px", fontWeight: 600, fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" };
const muted: React.CSSProperties = { color: "#64748b", fontSize: 13, margin: 0 };
const errBox: React.CSSProperties = { background: "rgba(239,68,68,.1)", border: "1px solid #7f1d1d", color: "#fca5a5", borderRadius: 8, padding: "10px 12px", fontSize: 13, margin: "10px 0" };
const warnBox: React.CSSProperties = { background: "rgba(245,158,11,.08)", border: "1px solid #78350f", color: "#fcd34d", borderRadius: 8, padding: "10px 12px", fontSize: 13, margin: "10px 0" };
