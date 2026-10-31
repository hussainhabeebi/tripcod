"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { API, apiHeaders } from "@/lib/api";
export default function HotelBookingDetail() {
  const { id } = useParams<{ id: string }>();
  const [booking, setBooking] = useState<any>(null), [calls, setCalls] = useState<any[]>([]), [error, setError] = useState(""), [busy, setBusy] = useState(false), [viewer, setViewer] = useState<string | null>(null);
  const root = `/api/admin/bookings/hotels/${encodeURIComponent(id)}`;
  async function get(path: string) {
    const response = await fetch(`${API}${path}`, { headers: apiHeaders() });
    if (!response.ok) { const d = await response.json().catch(()=>({})); throw new Error(d.message ?? d.error ?? `HTTP ${response.status}`); }
    return response;
  }
  useEffect(() => {
    let active = true;
    get(root).then(r=>r.json()).then(d=>{if(active)setBooking(d.booking);}).catch(e=>{if(active)setError(e.message);});
    get(`${root}/exchanges`).then(r=>r.json()).then(d=>{if(active)setCalls(d.exchanges);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  }, [root]);
  async function view(index: number, part: string) {
    setBusy(true); setError("");
    try { const text = await (await get(`${root}/exchanges/${index}/${part}`)).text(); try { setViewer(JSON.stringify(JSON.parse(text),null,2)); } catch { setViewer(text); } }
    catch(e:any) { setError(e.message); } finally {setBusy(false);}
  }
  async function download() {
    setBusy(true); setError("");
    try { const res = await get(`${root}/certification.zip`); const url=URL.createObjectURL(await res.blob()); const a=document.createElement("a"); a.href=url; a.download=`tripjack-hotel-${booking.supplierBookingId}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000); }
    catch(e:any) {setError(e.message);} finally {setBusy(false);}
  }
  return <div style={{ minWidth: 0, color: "#e2e8f0" }}><a href="/bookings" style={{ color: "#93c5fd" }}>← Bookings</a><h1>Hotel Booking Details</h1>
    {error && <p role="alert" style={{color:"#fca5a5"}}>{error}</p>}
    {!booking ? <p role="status">Loading hotel booking…</p> : <>
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,240px),1fr))",gap:14,background:"#1e293b",padding:20,borderRadius:12 }}>
        {Object.entries({Hotel:booking.hotel.name,"TripJack booking ID":booking.supplierBookingId,"Tripcod order ID":booking.id,Customer:booking.contactEmail,"Account owner":booking.userId || "Guest",Tenant:booking.tenantId,"Check-in":booking.hotel.checkIn,"Check-out":booking.hotel.checkOut,Amount:`${booking.currency} ${booking.amount}`,Status:booking.status,"Supplier status":booking.supplierStatus || "—","Confirmation number":booking.confirmationNo || "—",Mode:booking.mode,"Hold deadline":booking.holdDeadline ? `${booking.holdDeadline} IST` : "—","Payment reference":booking.paymentRef || booking.paymentOrderId || "—","Refund amount":booking.payment.refundAmount ?? "—","Refund note":booking.payment.refundNote || "—","Payment status":booking.payment.status,"Payment gateway":booking.payment.gateway || "—"}).map(([label,value])=><div key={label} style={{overflowWrap:"anywhere"}}><small style={{color:"#94a3b8"}}>{label}</small><div>{String(value)}</div></div>)}
      </div>
      <h2>Cancellation details</h2><pre style={pre}>{JSON.stringify({ recordedCancellation: booking.cancellation, policy: booking.option?.cancellation },null,2)}</pre>
      <h2>Room and guest details</h2><pre style={pre}>{JSON.stringify({occupancy:booking.occupancy,guests:booking.guests},null,2)}</pre>
      <h2>TripJack request / response logs</h2>
      <button type="button" disabled={busy} style={button} onClick={download}>Download Certification ZIP</button>
      {!calls.length && <p>No stored request/response logs found for this booking.</p>}
      {calls.map(x=><div key={x.id} style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",padding:"12px 0",borderBottom:"1px solid #334155"}}><span style={{overflowWrap:"anywhere",flex:"1 1 240px"}}>{x.endpoint}<br/><small>{x.startedAt}</small></span><button type="button" disabled={busy} style={button} onClick={()=>view(x.id,"request")}>View Request JSON</button><button type="button" disabled={busy || !x.hasResponse} style={button} onClick={()=>view(x.id,"response")}>View Response JSON</button></div>)}
    </>}
    {viewer !== null && <section aria-label="Request/Response JSON"><h2>Request/Response JSON</h2><button type="button" style={button} onClick={()=>setViewer(null)}>Close JSON</button><pre tabIndex={0} style={pre}>{viewer}</pre></section>}
  </div>;
}
const pre: React.CSSProperties = {whiteSpace:"pre-wrap",overflowWrap:"anywhere",background:"#0f172a",padding:16,borderRadius:8,maxHeight:520,overflowY:"auto",fontSize:12};
const button: React.CSSProperties = {background:"#4B4D4F",color:"white",border:"1px solid #64748b",borderRadius:8,padding:"10px 14px",minHeight:44,cursor:"pointer"};
