"use client";

import { useEffect, useState } from "react";
import { apiCall, inr } from "../lib/customer-api";
import styles from "./trips.module.css";

// Hotel bookings (TripJack Hotel API v3) for the signed-in customer, from /api/hotels/orders/mine.

type HotelStay = {
  id: string; supplierBookingId: string; mode: string; status: string; statusText: string; holdDeadline: string | null; holdExpired: boolean;
  hotel: { name: string; city: string; checkIn: string; checkOut: string; nights: number };
  occupancy: { adults: number; childAges: number[] }[]; amount: number; currency: string;
};

const TONE: Record<string, { color: string; bg: string }> = {
  CONFIRMED: { color: "#166534", bg: "#dcfce7" }, ON_HOLD: { color: "#92400e", bg: "#fef3c7" },
  PAYMENT_PENDING: { color: "#334155", bg: "#f1f5f9" }, PROCESSING: { color: "#0369a1", bg: "#e0f2fe" },
  CANCELLATION_PENDING: { color: "#0369a1", bg: "#e0f2fe" }, CANCELLED: { color: "#991b1b", bg: "#fee2e2" }, FAILED: { color: "#991b1b", bg: "#fee2e2" },
};

const day = (v: string) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
};

export function HotelStays() {
  const [stays, setStays] = useState<HotelStay[] | null>(null);
  useEffect(() => {
    apiCall<{ orders: HotelStay[] }>("/api/hotels/orders/mine").then((d) => setStays(d.orders)).catch(() => setStays([]));
  }, []);
  if (!stays?.length) return null;
  return <section aria-labelledby="hotel-stays" style={{ marginTop: 28 }}>
    <h2 id="hotel-stays" style={{ fontSize: 20, margin: "0 0 12px" }}>Hotel stays</h2>
    <div className={styles.list}>{stays.map((s) => {
      const tone = TONE[s.status] ?? TONE.PAYMENT_PENDING;
      const guests = s.occupancy.reduce((n, r) => n + r.adults + r.childAges.length, 0);
      return <article key={s.id} className={styles.card}>
        <div className={styles.cardHead}><div><span className={styles.cardEyebrow}><span aria-hidden="true">🏨</span> Hotel booking</span>
          <h2>{s.hotel.name}</h2></div>
          <span className={styles.status} style={{ color: tone.color, backgroundColor: tone.bg }}>{s.holdExpired ? "Hold expired" : s.statusText}</span>
        </div>
        <p className={styles.summary}>{day(s.hotel.checkIn)} → {day(s.hotel.checkOut)} <span aria-hidden="true">·</span> {s.occupancy.length} room{s.occupancy.length === 1 ? "" : "s"} <span aria-hidden="true">·</span> {guests} guest{guests === 1 ? "" : "s"}</p>
        <div className={styles.cardFoot}>
          <div className={styles.facts}>
            <span><small>Booking ref</small><strong>{s.supplierBookingId}</strong></span>
            <span><small>Total amount</small><strong>{inr(s.amount, s.currency)}</strong></span>
            {s.status === "ON_HOLD" && s.holdDeadline && !s.holdExpired && <span><small>Pay before</small><strong>{s.holdDeadline.replace("T", " ").slice(0, 16)} IST</strong></span>}
          </div>
          <a className={styles.secondaryAction} href={`/hotels/booking/${s.id}`}>View booking <span aria-hidden="true">→</span></a>
        </div>
      </article>;
    })}</div>
  </section>;
}
