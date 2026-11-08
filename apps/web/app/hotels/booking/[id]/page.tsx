"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { RoomOccupancy } from "@tripcod/suppliers/hotel-occupancy";
import {
  CancellationPolicy, OccupancyList, PriceBreakup, Row, dayLabel, hotelCss, istTime, mealLabel, money, orderApi, readCustomerToken,
  readOrderKey, type HotelOption,
} from "../../hotel-ui";

// Hotel booking details (also the payment return page): live TripJack status,
// hold deadline, pay / confirm a hold, cancel with the supplier's charges.

type Order = {
  id: string; supplierBookingId: string; mode: "INSTANT" | "HOLD"; status: string; statusText: string; supplierStatus: string | null;
  confirmationNo: string | null; holdDeadline: string | null; holdExpired: boolean;
  hotel: { name: string; address: string; city: string; countryCode: string; stars: number; image?: string; checkIn: string; checkOut: string; nights: number };
  occupancy: RoomOccupancy[]; guests: { title: string; firstName: string; lastName: string; type: string }[][];
  option: HotelOption; amount: number; currency: string; contactEmail: string;
  payment: { status: string; gateway: string | null; paidAt: string | null; refundAmount: number | null; refundNote: string | null; payable: boolean; payableReason: string | null };
  cancellation: { requestedAt: string; charge: number; refund: number } | null;
  canCancel: boolean; pending: boolean;
};
type Quote = { eligible: boolean; reason: string | null; paid: boolean; amount: number; currency: string; charge: number; refund: number; basis: string };
type PayOptions = { payable: boolean; reason: string | null; card: { available: boolean }; wallet: { available: boolean; balance: number | null; reason: string | null }; upi?: { available: boolean; testMode?: boolean; reason: string | null } };

const LOOK: Record<string, { cls: string; icon: string; title: (o: Order) => string; text: (o: Order) => string }> = {
  CONFIRMED:  { cls: "s-ok", icon: "✓", title: () => "Booking confirmed", text: (o) => `The hotel supplier confirmed your booking${o.confirmationNo ? ` (hotel confirmation ${o.confirmationNo})` : ""}.` },
  ON_HOLD:    { cls: "s-hold", icon: "⏸", title: (o) => o.holdExpired ? "Hold deadline passed" : "On hold — not confirmed",
    text: (o) => o.holdExpired ? "The supplier releases unpaid holds automatically after the deadline. Search again to book."
      : `The room is held without payment${o.holdDeadline ? ` until ${istTime(o.holdDeadline)}` : ""}. Pay before then to confirm it; otherwise the supplier cancels the hold automatically.` },
  PAYMENT_PENDING: { cls: "s-pay", icon: "₹", title: () => "Awaiting payment", text: () => "Nothing is booked with the hotel until your payment succeeds." },
  PROCESSING: { cls: "s-wait", icon: "…", title: () => "Confirming with the hotel", text: () => "Your payment is received. Hotels can take a few minutes to confirm — keep this page open or come back later. It is not confirmed yet." },
  CANCELLATION_PENDING: { cls: "s-wait", icon: "…", title: () => "Cancellation requested", text: () => "The supplier accepted the request. The booking shows as cancelled once the supplier confirms it." },
  CANCELLED:  { cls: "s-bad", icon: "×", title: () => "Booking cancelled", text: (o) => o.cancellation ? "Cancelled with the hotel supplier." : o.mode === "HOLD" ? "The hold was released by the supplier." : "This booking was cancelled." },
  FAILED:     { cls: "s-bad", icon: "×", title: () => "Booking could not be completed", text: () => "The hotel supplier did not confirm this booking." },
};

export default function HotelBookingPage() {
  const { id } = useParams<{ id: string }>();
  const [key, setKey] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [payOpts, setPayOpts] = useState<PayOptions | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [agree, setAgree] = useState(false);
  // "return": back from PhonePe, which doesn't say how it went — the API asks PhonePe.
  const paymentReturn = useRef<"success" | "failed" | "return" | null>(null);
  const started = useRef(Date.now());

  const load = useCallback(async (k: string, refresh = false) => {
    try {
      const d = await orderApi<{ order: Order }>(`/orders/${encodeURIComponent(id)}${refresh ? "?refresh=1" : ""}`, { key: k });
      setOrder(d.order);
      setError("");
      return d.order;
    } catch (e: any) {
      setError(e?.status === 404 ? "We couldn't find this booking in this browser. Open it from My Trips (signed in) or from the link you were given." : e?.message ?? "Could not load the booking.");
      return null;
    }
  }, [id]);

  useEffect(() => {
    const k = readOrderKey(id);
    setKey(k);
    const q = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.slice(1));
    paymentReturn.current = q.get("payment") === "success" ? "success" : q.get("payment") === "failed" ? "failed" : q.get("payment") === "return" ? "return" : null;
    if (paymentReturn.current === "failed") setNotice("The payment didn't go through. You have not been charged — you can try again below.");
    if (hash.get("error")) setNotice(hash.get("error")!);
    // Drop the key from the address bar once it is saved in this browser.
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
    void load(k);
  }, [id, load]);

  // Poll while TripJack or the payment is still settling.
  useEffect(() => {
    if (!order) return;
    const awaitingWebhook = (paymentReturn.current === "success" || paymentReturn.current === "return") && order.payment.status === "PENDING";
    if (!order.pending && !awaitingWebhook) return;
    if (Date.now() - started.current > 10 * 60_000) return;
    const t = window.setTimeout(() => void load(key), 5000);
    return () => window.clearTimeout(t);
  }, [order, key, load]);

  // Payment options when the booking can be paid.
  useEffect(() => {
    if (!order?.payment.payable || order.payment.status === "PENDING" && (paymentReturn.current === "success" || paymentReturn.current === "return")) { setPayOpts(null); return; }
    orderApi<PayOptions>(`/orders/${id}/payment-options`, { key }).then(setPayOpts).catch(() => setPayOpts(null));
  }, [order?.payment.payable, order?.payment.status, id, key]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pay(method: "CARD" | "WALLET" | "UPI") {
    setBusy(true); setNotice("");
    try {
      const d = await orderApi<{ paymentUrl?: string; order?: Order }>(`/orders/${id}/pay`, { key, body: { method } });
      if (d.paymentUrl) { window.location.href = d.paymentUrl; return; }
      if (d.order) setOrder(d.order);
    } catch (e: any) {
      setNotice(e?.message ?? "Payment could not be started.");
      void load(key);
    } finally {
      setBusy(false);
    }
  }

  async function openCancel() {
    setBusy(true); setNotice(""); setAgree(false);
    try {
      const d = await orderApi<{ quote: Quote; order: Order }>(`/orders/${id}/cancel-quote`, { key });
      setOrder(d.order);
      if (!d.quote.eligible) setNotice(d.quote.reason ?? "This booking can't be cancelled here.");
      else setQuote(d.quote);
    } catch (e: any) {
      setNotice(e?.message ?? "Could not load the cancellation terms.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancel() {
    if (!quote) return;
    setBusy(true);
    try {
      const d = await orderApi<{ order: Order }>(`/orders/${id}/cancel`, { key, body: { confirm: true, expectedCharge: quote.charge } });
      setOrder(d.order);
      setQuote(null);
    } catch (e: any) {
      if (e?.data?.quote) setQuote(e.data.quote);
      setNotice(e?.message ?? "Cancellation failed.");
      if (!e?.data?.quote) setQuote(null);
    } finally {
      setBusy(false);
    }
  }

  const look = order ? LOOK[order.status] ?? LOOK.PROCESSING : null;
  const signedIn = typeof document !== "undefined" && Boolean(readCustomerToken());

  return (
    <main className="ck"><style>{hotelCss + css}</style>
      <header>
        <a className="back" href={signedIn ? "/trips" : "/hotels"} aria-label="Back">‹</a>
        <div><b>Hotel booking</b><span>{order ? `${order.hotel.name} · Ref ${order.supplierBookingId}` : "Loading…"}</span></div>
      </header>

      {error && <div className="err" role="alert"><b>Couldn&apos;t load the booking</b><span>{error}</span></div>}
      {notice && <div className="note note-warn" role="status">{notice}</div>}
      {!order && !error && <div className="note note-info" role="status"><span className="spinner" /> Loading your booking…</div>}

      {order && look && (
        <>
          <section className={`card status ${look.cls}`} aria-live="polite">
            <div className="status-icon" aria-hidden="true">{order.pending ? <span className="spinner" /> : look.icon}</div>
            <div>
              <h1>{look.title(order)}</h1>
              <p>{paymentReturn.current === "success" && order.payment.status === "PENDING" ? "Payment received by the payment page — waiting for the payment confirmation. Nothing is confirmed yet."
                : paymentReturn.current === "return" && order.payment.status === "PENDING" ? "Checking your payment with PhonePe — nothing is confirmed yet. Please keep this page open."
                : look.text(order)}</p>
            </div>
          </section>

          <div className="cols">
            <div>
              <section className="card">
                <div className="receipt">
                  <Row l="Booking reference" v={order.supplierBookingId} />
                  {order.confirmationNo && <Row l="Hotel confirmation no." v={order.confirmationNo} />}
                  <Row l="Status" v={order.statusText} />
                  <Row l="Booking type" v={order.mode === "HOLD" ? "Hold (pay later)" : "Pay now"} />
                  {order.mode === "HOLD" && order.holdDeadline && <Row l="Hold deadline" v={istTime(order.holdDeadline)} />}
                  <Row l="Check-in" v={dayLabel(order.hotel.checkIn)} />
                  <Row l="Check-out" v={`${dayLabel(order.hotel.checkOut)} · ${order.hotel.nights} night${order.hotel.nights === 1 ? "" : "s"}`} />
                </div>
              </section>

              <section className="card">
                <div className="hh"><div>
                  <b style={{ fontSize: 17 }}>{order.hotel.name}</b>
                  {order.hotel.stars > 0 && <span className="stars">{"★".repeat(Math.min(5, order.hotel.stars))}</span>}
                  {order.hotel.address && <small>{order.hotel.address}</small>}
                </div></div>
                <p style={{ margin: "10px 0 0", fontSize: 13 }}>{mealLabel(order.option.mealBasis)}</p>
                <OccupancyList rooms={order.occupancy} roomNames={order.option.roomInfo.map((r) => r.name)} />
                <h3 style={{ fontSize: 14, margin: "16px 0 6px" }}>Guests</h3>
                <ul className="guests">
                  {order.guests.map((room, i) => (
                    <li key={i}><b>Room {i + 1}</b> {room.map((g) => `${g.title} ${g.firstName} ${g.lastName}${g.type === "CHILD" ? " (child)" : ""}`).join(", ")}</li>
                  ))}
                </ul>
              </section>

              <section className="card">
                <div className="title"><span>↺</span><div><h2>Cancellation policy</h2><p>The hotel supplier&apos;s terms for this booking.</p></div></div>
                <CancellationPolicy policy={order.option.cancellation} currency={order.currency} />
              </section>
            </div>

            <aside>
              <section className="card">
                <div className="title"><span>₹</span><div><h2>Payment</h2><p>{paymentLine(order)}</p></div></div>
                <PriceBreakup pricing={{ ...order.option.pricing, currency: order.currency }} />
                {order.payment.refundNote && <p className="refund">{order.payment.refundAmount !== null && order.payment.refundAmount > 0 ? <b>Refund {money(order.payment.refundAmount, order.currency)}: </b> : null}{order.payment.refundNote}</p>}
              </section>

              {order.payment.payable && payOpts?.payable && (
                <section className="card">
                  <div className="title"><span>💳</span><div><h2>{order.mode === "HOLD" ? "Pay & confirm held booking" : "Complete payment"}</h2>
                    <p>{order.mode === "HOLD" ? "After payment we ask the supplier to confirm the hold. It is confirmed only when the supplier confirms." : "We book with the hotel once payment succeeds."}</p></div></div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <button type="button" className="btn" disabled={busy || !payOpts.card.available} onClick={() => pay("CARD")}>
                      {payOpts.card.available ? `Pay ${money(order.amount, order.currency)} by card` : "Card payment unavailable"}
                    </button>
                    {payOpts.upi?.available && (
                      <button type="button" className="btn btn-light" disabled={busy} onClick={() => pay("UPI")}>
                        Pay {money(order.amount, order.currency)} by UPI / netbanking (PhonePe{payOpts.upi.testMode ? " · test mode" : ""})
                      </button>
                    )}
                    {payOpts.wallet.available
                      ? <button type="button" className="btn btn-light" disabled={busy} onClick={() => pay("WALLET")}>Pay from wallet (balance {money(payOpts.wallet.balance ?? 0, "INR")})</button>
                      : payOpts.wallet.reason && <small style={{ color: "#667085" }}>Wallet: {payOpts.wallet.reason}</small>}
                  </div>
                </section>
              )}
              {!order.payment.payable && order.payment.payableReason && ["ON_HOLD", "PAYMENT_PENDING"].includes(order.status) && order.payment.status !== "PENDING" && (
                <div className="note note-warn">{order.payment.payableReason}</div>
              )}

              {order.canCancel && (
                <button type="button" className="btn btn-light" style={{ width: "100%" }} disabled={busy} onClick={openCancel}>
                  {order.status === "ON_HOLD" ? "Cancel hold" : "Cancel booking"}
                </button>
              )}
              {(order.status === "FAILED" || order.status === "CANCELLED" || order.holdExpired) && (
                <a className="btn btn-light" style={{ width: "100%", boxSizing: "border-box", marginTop: 10 }} href="/hotels">Search hotels</a>
              )}
            </aside>
          </div>
        </>
      )}

      {quote && order && (
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
          <div>
            <h2 id="cancel-title">{order.status === "ON_HOLD" ? "Cancel this hold?" : "Cancel this booking?"}</h2>
            <p style={{ color: "#667085", fontSize: 13, margin: "0 0 12px" }}>{order.hotel.name} · {dayLabel(order.hotel.checkIn)} – {dayLabel(order.hotel.checkOut)}</p>
            <div className="receipt">
              <Row l="Amount" v={money(quote.amount, quote.currency)} />
              <Row l="Cancellation charge" v={quote.charge > 0 ? money(quote.charge, quote.currency) : "No charge"} />
              {quote.paid && <Row l="Refund (to original payment method)" v={money(quote.refund, quote.currency)} strong />}
              {!quote.paid && <Row l="Payment" v={order.status === "ON_HOLD" ? "Nothing was paid for this hold" : "Not paid on Tripcod"} />}
            </div>
            <p style={{ fontSize: 12, color: "#667085" }}>Based on the supplier&apos;s cancellation policy at this time ({basisText(quote.basis)}). The booking is cancelled only after the supplier confirms; refunds are then processed to your original payment method.</p>
            <label style={{ display: "flex", gap: 10, fontSize: 13, alignItems: "flex-start" }}>
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#b42318" }} />
              <span>I understand {quote.charge > 0 ? `a charge of ${money(quote.charge, quote.currency)} applies and ` : ""}this can&apos;t be undone.</span>
            </label>
            <div className="actions">
              <button type="button" className="btn btn-light" disabled={busy} onClick={() => setQuote(null)}>Keep booking</button>
              <button type="button" className="btn btn-danger" disabled={busy || !agree} onClick={confirmCancel}>{busy ? "Cancelling…" : "Confirm cancellation"}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function paymentLine(o: Order) {
  const via = o.payment.gateway === "WALLET" ? "Tripcod wallet" : o.payment.gateway === "NOMOD" ? "card" : o.payment.gateway === "PHONEPE" ? "UPI (PhonePe)" : "";
  switch (o.payment.status) {
    case "PAID": return `Paid${via ? ` by ${via}` : ""}${o.payment.paidAt ? ` on ${new Date(o.payment.paidAt).toLocaleDateString("en-IN")}` : ""}.`;
    case "PENDING": return "Payment started — waiting for the payment provider.";
    case "REFUND_PENDING": return "Refund in progress.";
    case "REFUNDED": return "Refunded.";
    default: return o.mode === "HOLD" ? "Not paid — pay before the hold deadline." : "Not paid yet.";
  }
}

function basisText(basis: string) {
  return ({
    POLICY_WINDOW: "current penalty window", BEFORE_PENALTIES: "before any penalty applies", AFTER_PENALTIES: "after the last penalty window",
    NON_REFUNDABLE: "non-refundable rate", NO_POLICY: "refundable rate", UNPAID_HOLD: "unpaid hold",
  } as Record<string, string>)[basis] ?? basis;
}

const css = `.guests{list-style:none;margin:0;padding:0;display:grid;gap:6px;font-size:13px}.guests b{margin-right:6px}.refund{font-size:13px;background:#f0fdf4;border:1px solid #bbf7d0;color:#166534;border-radius:12px;padding:10px 12px;margin:12px 0 0}`;
