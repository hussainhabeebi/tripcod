"use client";

// Admin → Transactions: Nomod / PhonePe payments for flights and hotels, the
// payment ledger (checkouts, webhooks, captures, refunds, anomalies), hotel
// orders, and refund / re-check actions.

import { useEffect, useState } from "react";
import { adminApi } from "../../../lib/files";
import { money, ui } from "../../../lib/ui";

type Payment = {
  id: string; product: "FLIGHT" | "HOTEL"; gateway: string; environment: string | null; status: string;
  amount: string; currency: string; gatewayOrderId: string | null; gatewayPaymentId: string | null;
  refundedAmount: string | null; refundGatewayRef: string | null; refundInitiatedAt: string | null; refundCompletedAt: string | null;
  bookingId: string | null; hotelBookingId: string | null; createdAt: string;
  bookingStatus: string | null; route: string | null; pnr: string | null; hotelStatus: string | null; hotelName: string | null;
};
type Event = { id: string; paymentId: string | null; product: string; referenceId: string | null; gateway: string; environment: string | null; event: string; status: string | null; amount: string | null; currency: string | null; gatewayRef: string | null; message: string | null; createdAt: string };
type HotelOrder = {
  id: string; status: string; supplierStatus: string | null; supplierBookingId: string; mode: string; hotelName: string | null; amount: number; currency: string;
  paymentStatus: string; paymentGateway: string | null; paymentOrderId: string | null; paymentRef: string | null;
  refundAmount: string | null; refundNote: string | null; contactEmail: string | null; lastError: string | null; createdAt: string;
};
type Status = { nomod: { enabled: boolean; available: boolean; webhookSecretSet: boolean }; phonepe: { enabled: boolean; available: boolean; environment: string; missingSecrets: string[] } };

const ALERT_EVENTS = new Set(["AMOUNT_MISMATCH", "DUPLICATE_CHARGE", "LATE_PAYMENT", "REFUND_FAILED", "CHECKOUT_FAILED"]);
const STATUS_TONE: Record<string, string> = { SUCCESS: "#4ade80", PENDING: "#fbbf24", FAILED: "#f87171", REFUNDED: "#94a3b8", PARTIAL_REFUND: "#60a5fa" };
const when = (d: string) => new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function TransactionsPage() {
  const [tab, setTab] = useState<"payments" | "events" | "hotels">("payments");
  const [filters, setFilters] = useState({ gateway: "", product: "", status: "" });   // payments tab: flights; hotel order payments are in the Hotel orders tab
  const [payments, setPayments] = useState<Payment[]>([]);
  const [events, setEvents] = useState<Event[]>([]);
  const [orders, setOrders] = useState<HotelOrder[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [selected, setSelected] = useState<{ payment: Payment; events: Event[] } | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const qs = (o: Record<string, string>) => new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();

  async function load() {
    setError("");
    try {
      if (tab === "payments") setPayments((await adminApi(`/api/admin/finance/payments?${qs(filters)}`)).payments);
      if (tab === "events") setEvents((await adminApi(`/api/admin/finance/payments/events?${qs({ gateway: filters.gateway, product: filters.product })}`)).events);
      if (tab === "hotels") setOrders((await adminApi(`/api/admin/finance/payments/hotel-orders`)).orders);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { void load(); }, [tab, filters.gateway, filters.product, filters.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { adminApi<Status>("/api/admin/finance/payments/status").then(setStatus).catch(() => {}); }, []);

  async function open(id: string) {
    try { setSelected(await adminApi(`/api/admin/finance/payments/${id}`)); } catch (e: any) { setError(e.message); }
  }

  async function act(path: string, body?: unknown, done?: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await adminApi(path, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      setMessage(done ?? `Done: ${JSON.stringify(r)}`);
      if (selected) await open(selected.payment.id);
      await load();
    } catch (e: any) { setError(e.message); }
    setBusy(false);
  }

  function refund(p: Payment) {
    const left = Number(p.amount) - Number(p.refundedAmount ?? 0);
    const amt = window.prompt(`Refund amount in ${p.currency} (max ${left.toFixed(2)}). Leave as is for a full refund.`, left.toFixed(2));
    if (amt === null) return;
    const reason = window.prompt("Reason (shown in the ledger)", "Customer refund");
    if (!reason) return;
    const n = Number(amt);
    if (!Number.isFinite(n) || n <= 0) { setError("Enter a valid amount"); return; }
    if (!window.confirm(`Refund ${money(n, p.currency)} through ${p.gateway}${p.environment ? ` (${p.environment})` : ""}? This sends money back to the customer.`)) return;
    void act(`/api/admin/finance/payments/${p.id}/refund`, { amount: n, reason }, "Refund sent to the gateway");
  }

  return (
    <div>
      <h1 style={ui.h1}>Transactions</h1>
      <p style={ui.sub}>Card / UPI payments for flights and hotels, every gateway event, and refunds.</p>

      {status && (
        <div style={{ ...ui.card, display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span style={ui.text}>Nomod: <b style={{ color: status.nomod.available ? "#4ade80" : "#f87171" }}>{status.nomod.available ? "live" : "off"}</b>{!status.nomod.webhookSecretSet && <span style={{ color: "#fbbf24" }}> · webhook secret missing</span>}</span>
          <span style={ui.text}>PhonePe ({status.phonepe.environment}): <b style={{ color: status.phonepe.available ? "#4ade80" : "#f87171" }}>{status.phonepe.available ? "on" : "off"}</b>
            {status.phonepe.missingSecrets.length > 0 && <span style={{ color: "#fbbf24" }}> · missing {status.phonepe.missingSecrets.join(", ")}</span>}</span>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {(["payments", "events", "hotels"] as const).map((t) => (
          <button key={t} type="button" style={ui.chip(tab === t)} onClick={() => setTab(t)}>{t === "payments" ? "Payments" : t === "events" ? "Ledger" : "Hotel orders"}</button>
        ))}
        {tab !== "hotels" && (
          <>
            <select style={ui.input} value={filters.gateway} onChange={(e) => setFilters({ ...filters, gateway: e.target.value })}>
              <option value="">All gateways</option><option value="NOMOD">Nomod</option><option value="PHONEPE">PhonePe</option><option value="RAZORPAY">Razorpay</option>
            </select>
            <select style={ui.input} value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
              <option value="">Flights & hotels</option><option value="FLIGHT">Flights</option><option value="HOTEL">Hotels</option>
            </select>
          </>
        )}
        {tab === "payments" && (
          <select style={ui.input} value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">Any status</option>{["PENDING", "SUCCESS", "FAILED", "REFUNDED", "PARTIAL_REFUND"].map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        <button type="button" style={ui.ghost} onClick={() => void load()}>Refresh</button>
      </div>

      {error && <div style={ui.err}>{error}</div>}
      {message && <div style={ui.ok}>{message}</div>}

      <div style={{ ...ui.card, overflowX: "auto" }}>
        {tab === "payments" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["When", "Product", "Gateway", "Amount", "Status", "Booking", "Gateway ref", ""].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td style={ui.td}>{when(p.createdAt)}</td>
                  <td style={ui.td}>{p.product === "HOTEL" ? `🏨 ${p.hotelName ?? "Hotel"}` : `✈️ ${p.route ?? ""}`}</td>
                  <td style={ui.td}>{p.gateway}{p.environment ? <small style={ui.muted}> · {p.environment}</small> : null}</td>
                  <td style={ui.td}>{money(p.amount, p.currency)}{p.refundedAmount ? <div style={ui.muted}>refunded {money(p.refundedAmount, p.currency)}</div> : null}</td>
                  <td style={{ ...ui.td, color: STATUS_TONE[p.status] ?? "#e2e8f0", fontWeight: 700 }}>{p.status}</td>
                  <td style={ui.td}>{p.product === "HOTEL" ? `${p.hotelStatus ?? ""}` : `${p.bookingStatus ?? ""}${p.pnr ? ` · ${p.pnr}` : ""}`}<div style={ui.muted}>{(p.bookingId ?? p.hotelBookingId ?? "").slice(0, 8)}</div></td>
                  <td style={{ ...ui.td, fontFamily: "monospace", fontSize: 11 }}>{p.gatewayOrderId}<div style={ui.muted}>{p.gatewayPaymentId}</div></td>
                  <td style={ui.td}><button type="button" style={ui.ghost} onClick={() => void open(p.id)}>Open</button></td>
                </tr>
              ))}
              {!payments.length && <tr><td style={ui.td} colSpan={8}>No payments.</td></tr>}
            </tbody>
          </table>
        )}

        {tab === "events" && <EventTable events={events} onOpen={(id) => void open(id)} />}

        {tab === "hotels" && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["When", "Hotel", "Amount", "Booking", "Payment", "Gateway ref", "Contact", ""].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td style={ui.td}>{when(o.createdAt)}</td>
                  <td style={ui.td}>{o.hotelName ?? "—"}<div style={ui.muted}>{o.mode}</div></td>
                  <td style={ui.td}>{money(o.amount, o.currency)}</td>
                  <td style={{ ...ui.td, fontWeight: 700 }}>{o.status}<div style={{ ...ui.muted, fontFamily: "monospace" }}>{o.supplierBookingId}</div>{o.lastError ? <div style={{ ...ui.muted, color: "#fca5a5" }}>{o.lastError}</div> : null}</td>
                  <td style={{ ...ui.td, color: STATUS_TONE[o.paymentStatus === "PAID" ? "SUCCESS" : o.paymentStatus] ?? "#e2e8f0", fontWeight: 700 }}>
                    {o.paymentStatus}{o.paymentGateway ? <small style={ui.muted}> · {o.paymentGateway}</small> : null}
                    {o.refundNote ? <div style={{ ...ui.muted, fontWeight: 400 }}>{o.refundAmount ? `${money(o.refundAmount, o.currency)}: ` : ""}{o.refundNote}</div> : null}
                  </td>
                  <td style={{ ...ui.td, fontFamily: "monospace", fontSize: 11 }}>{o.paymentOrderId}<div style={ui.muted}>{o.paymentRef}</div></td>
                  <td style={ui.td}>{o.contactEmail}</td>
                  <td style={ui.td}>{(o.paymentStatus === "PENDING" || !["CONFIRMED", "CANCELLED", "FAILED"].includes(o.status)) && (
                    <button type="button" style={ui.ghost} disabled={busy} onClick={() => void act(`/api/admin/finance/payments/hotel-orders/${o.id}/refresh`, undefined, "Re-checked payment and TripJack status")}>Re-check</button>
                  )}</td>
                </tr>
              ))}
              {!orders.length && <tr><td style={ui.td} colSpan={8}>No hotel orders.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <div style={ui.card}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <h2 style={ui.h2}>Payment {selected.payment.id.slice(0, 8)} · {selected.payment.gateway} · {money(selected.payment.amount, selected.payment.currency)} · {selected.payment.status}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              {selected.payment.gateway === "PHONEPE" && selected.payment.status === "PENDING" && (
                <button type="button" style={ui.ghost} disabled={busy} onClick={() => void act(`/api/admin/finance/payments/${selected.payment.id}/reconcile`)}>Re-check with PhonePe</button>
              )}
              {["NOMOD", "PHONEPE"].includes(selected.payment.gateway) && ["SUCCESS", "PARTIAL_REFUND"].includes(selected.payment.status) && (
                <button type="button" style={{ ...ui.btn, background: "#b91c1c" }} disabled={busy} onClick={() => refund(selected.payment)}>Refund…</button>
              )}
              <button type="button" style={ui.ghost} onClick={() => setSelected(null)}>Close</button>
            </div>
          </div>
          <EventTable events={selected.events} />
        </div>
      )}
    </div>
  );
}

function EventTable({ events, onOpen }: { events: Event[]; onOpen?: (paymentId: string) => void }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead><tr>{["When", "Event", "Gateway", "Amount", "Status", "Reference", "Message"].map((h) => <th key={h} style={ui.th}>{h}</th>)}</tr></thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} style={ALERT_EVENTS.has(e.event) ? { background: "rgba(239,68,68,.08)" } : undefined}>
            <td style={ui.td}>{when(e.createdAt)}</td>
            <td style={{ ...ui.td, fontWeight: 700, color: ALERT_EVENTS.has(e.event) ? "#fca5a5" : "#e2e8f0" }}>{e.event}</td>
            <td style={ui.td}>{e.gateway}{e.environment ? <small style={ui.muted}> · {e.environment}</small> : null}</td>
            <td style={ui.td}>{e.amount ? money(e.amount, e.currency ?? "INR") : ""}</td>
            <td style={ui.td}>{e.status}</td>
            <td style={{ ...ui.td, fontSize: 11 }}>
              {e.product} {(e.referenceId ?? "").slice(0, 8)}
              {e.paymentId && onOpen && <> · <button type="button" style={{ ...ui.ghost, padding: "2px 8px" }} onClick={() => onOpen(e.paymentId!)}>open</button></>}
              <div style={{ ...ui.muted, fontFamily: "monospace" }}>{e.gatewayRef}</div>
            </td>
            <td style={{ ...ui.td, maxWidth: 360 }}>{e.message}</td>
          </tr>
        ))}
        {!events.length && <tr><td style={ui.td} colSpan={7}>No events.</td></tr>}
      </tbody>
    </table>
  );
}
