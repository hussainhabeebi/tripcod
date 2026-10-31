"use client";
import { useEffect, useState } from "react";
import styles from "./bookings.module.css";
import { API, apiHeaders } from "@/lib/api";
import { CertificationExport } from "./CertificationExport";
import { HotelCertificationPacks } from "./HotelCertificationPacks";

type Product = "all" | "flights" | "hotels";
type Row = { id: string; product: "flights" | "hotels"; name: string; customer: string; reference: string; tenant: string; supplier: string; channel: string; status: string; amount: number; currency: string; date: string; end?: string; createdAt: string };
export function BookingList({ filters, initial }: { filters: Record<string, string>; initial?: Record<string, { bookings?: any[]; error?: string }> }) {
  const [product, setProduct] = useState<Product>(["flights", "hotels"].includes(filters.type) ? filters.type as Product : "all");
  const [rows, setRows] = useState<Row[]>([]), [errors, setErrors] = useState<string[]>([]), [loading, setLoading] = useState(true), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setErrors([]);
    const params = new URLSearchParams(filters); params.delete("type");
    const load = async (kind: "flights" | "hotels"): Promise<Row[]> => {
      try {
        // These are hotel-only statuses; never send them to the Flight PostgreSQL enum.
        if (kind === "flights" && ["ON_HOLD", "PROCESSING", "CANCELLATION_PENDING", "FAILED"].includes(filters.status)) return [];
        const prefetched = initial?.[kind];
        const res = prefetched ? null : await fetch(`${API}/api/admin/bookings${kind === "hotels" ? "/hotels" : ""}?${params}`, { headers: apiHeaders() });
        const data = prefetched ?? await res!.json();
        if (data.error || (res && !res.ok)) throw new Error(data.message ?? data.error ?? `HTTP ${res?.status}`);
        return data.bookings.map((b: any) => kind === "hotels" ? {
          id: b.id, product: kind, name: b.hotel.name, customer: b.contactEmail || b.userId || "Guest", reference: b.supplierBookingId,
          tenant: b.tenantId, supplier: "TRIPJACK", channel: b.mode, status: b.status, amount: b.amount, currency: b.currency,
          date: b.hotel.checkIn, end: b.hotel.checkOut, createdAt: b.createdAt,
        } : { id: b.id, product: kind, name: `${b.origin} → ${b.destination}`, customer: b.customerEmail || b.userId || "—", reference: b.pnr || "—",
          tenant: b.tenantSlug || b.tenantId, supplier: b.supplier, channel: b.channel, status: b.status, amount: Number(b.totalAmount), currency: b.currency, date: b.departureDate, createdAt: b.createdAt });
      } catch (e: any) { if (active) setErrors((old) => [...old, `${kind === "hotels" ? "Hotels" : "Flights"}: ${e.message}`]); return []; }
    };
    Promise.all([load("flights"), load("hotels")]).then((all) => { if (active) { setRows(all.flat().sort((a,b) => b.createdAt.localeCompare(a.createdAt))); setLoading(false); } });
    return () => { active = false; };
  }, [filters, initial, attempt]);
  const visible = rows.filter((r) => product === "all" || r.product === product);
  return <div style={{ minWidth: 0 }}>
    <h1 style={{ fontSize: 22, color: "#f1f5f9" }}>All Bookings</h1>
    <div className={styles.tabs} aria-label="Booking type filters">
      {(["all", "flights", "hotels"] as const).map((p) => <button key={p} type="button" aria-pressed={product === p} onClick={() => setProduct(p)} style={{ ...button, background: product === p ? "#FFB005" : "#1e293b", color: product === p ? "#111827" : "#f1f5f9" }}>{p === "all" ? "All" : p === "flights" ? "Flights" : "Hotels"}</button>)}
    </div>
    <form method="GET" className={styles.filters}>
      <input type="hidden" name="type" value={product} />
      <select name="status" aria-label="Booking status" defaultValue={filters.status ?? ""} style={field}><option value="">All Statuses</option>{["SEARCHED","HELD","ON_HOLD","PAYMENT_PENDING","PAYMENT_FAILED","PROCESSING","CONFIRMED","TICKETED","CANCELLATION_PENDING","CANCELLED","FAILED","REFUND_PENDING","REFUNDED"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select>
      <input name="tenantId" aria-label="Tenant ID" placeholder="Tenant ID (super admin)" defaultValue={filters.tenantId ?? ""} style={field} />
      <input name="pnr" aria-label="PNR or TripJack booking ID" placeholder="PNR / TripJack booking ID" defaultValue={filters.pnr ?? ""} style={field} />
      <button type="submit" style={button}>Filter</button>
    </form>
    {errors.map(e=><p key={e} role="alert" style={{ color: "#fca5a5" }}>{e}</p>)}
    {!!errors.length && <button type="button" style={button} onClick={() => initial ? window.location.reload() : setAttempt(n=>n+1)}>Retry bookings</button>}
    {loading ? <p role="status">Loading bookings…</p> : <>
      <p style={{ color: "#94a3b8" }}>{visible.length} bookings shown (up to 50 per source by default)</p>
      <p id="booking-scroll-help" className={styles.scrollHint}>Scroll horizontally for more columns. Details stays visible.</p>
      <div className={styles.tableScroll} role="region" aria-label="Booking results" aria-describedby="booking-scroll-help" tabIndex={0}>
        <table className={styles.table}>
          <colgroup>{[80,200,150,140,170,110,145,180,150,230,112].map((width,index)=><col key={index} style={{width}} />)}</colgroup>
          <thead><tr>{["Type", "Route / Hotel", "Customer", "Tenant", "PNR / TripJack ID", "Supplier", "Channel / Mode", "Status", "Amount", "Travel / Stay dates", "Details"].map(x=><th key={x} style={cell}>{x}</th>)}</tr></thead>
          <tbody>{visible.map(b=><tr key={`${b.product}-${b.id}`}>
            <td data-label="Type" style={cell}>{b.product === "hotels" ? "Hotel" : "Flight"}</td><td data-label="Route / Hotel" style={cell}><span className={styles.clip} title={b.name}>{b.name}</span></td><td data-label="Customer" style={cell}><FullValue value={b.customer} label="customer" /></td><td data-label="Tenant" style={cell}><FullValue value={b.tenant} label="tenant ID" /></td><td data-label="PNR / TripJack ID" style={cell}><FullValue value={b.reference} label="booking reference" /></td><td data-label="Supplier" style={cell}>{b.supplier}</td><td data-label="Channel / Mode" style={cell}>{b.channel}</td>
            <td data-label="Status" style={{ ...cell, color: b.status === "ON_HOLD" ? "#fbbf24" : b.status === "CONFIRMED" || b.status === "TICKETED" ? "#4ade80" : "#cbd5e1" }}>{b.status}</td>
            <td data-label="Amount" style={cell}>{b.currency} {Number(b.amount).toLocaleString("en-IN")}</td><td data-label="Travel / Stay dates" style={cell}><span className={styles.date}>{b.date?.slice(0,10) || "—"}</span>{b.end && <span className={styles.date}>→ {b.end.slice(0,10)}</span>}</td><td data-label="Details" style={cell}><a style={{ color: "#93c5fd" }} href={`/bookings/${b.product === "hotels" ? "hotels/" : ""}${b.id}`}>Details →</a></td>
          </tr>)}{!visible.length && <tr><td colSpan={11} style={cell}>No bookings found</td></tr>}</tbody>
        </table>
      </div>
    </>}
    <CertificationExport />
    <HotelCertificationPacks />
  </div>;
}
const field: React.CSSProperties = { background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#f1f5f9", padding: 10, minHeight: 44, maxWidth: "100%" };
const button: React.CSSProperties = { ...field, cursor: "pointer", fontWeight: 700, padding: "10px 16px" };
const cell: React.CSSProperties = { padding: "12px", textAlign: "left", borderBottom: "1px solid #334155", color: "#e2e8f0", fontSize: 13 };

function FullValue({ value, label }: { value?: string; label: string }) {
  const text = value || "—";
  if (text.length <= 20) return <span className={styles.clip} title={text}>{text}</span>;
  return <details className={styles.fullValue}>
    <summary title={text} aria-label={`Show full ${label}`}>{text.slice(0,6)}…{text.slice(-4)}</summary>
    <span className={styles.expandedValue}>{text}</span>
  </details>;
}
