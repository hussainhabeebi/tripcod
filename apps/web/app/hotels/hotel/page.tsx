"use client";

import { useEffect, useState } from "react";
import { decodeOccupancy, occupancyTotals, toTripjackRooms, type RoomOccupancy } from "@tripcod/suppliers/hotel-occupancy";
import {
  API_URL, CancellationPolicy, HotelNotes, OccupancyList, dayLabel, hotelCss, mealLabel, money, type HotelOption,
} from "../hotel-ui";

// Room selection: every TripJack option for this hotel at the searched occupancy.

type Ctx = {
  hid: string; sid: string; exp: string; occ: string; rooms: RoomOccupancy[]; nat: string; currency: string;
  checkIn: string; checkOut: string; nights: number; name: string; stars: number; city: string; address: string; cc: string; img: string;
};
type Detail = {
  hotelName: string; reviewHash: string; options: HotelOption[];
  hotel: { name?: string; address?: string; images?: string[]; amenities?: string[]; headline?: string; starRating?: number } | null;
};

export default function HotelRoomsPage() {
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "refundable" | "breakfast">("all");

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const rooms = decodeOccupancy(q.get("occ"));
    const c: Ctx = {
      hid: q.get("hid") ?? "", sid: q.get("sid") ?? "", exp: q.get("exp") ?? "", occ: q.get("occ") ?? "", rooms: rooms ?? [],
      nat: q.get("nat") ?? "IN", currency: q.get("currency") ?? "INR", checkIn: q.get("checkIn") ?? "", checkOut: q.get("checkOut") ?? "",
      nights: parseInt(q.get("nights") ?? "1") || 1, name: q.get("name") ?? "", stars: parseInt(q.get("stars") ?? "0") || 0,
      city: q.get("city") ?? "", address: q.get("address") ?? "", cc: (q.get("cc") ?? "").toUpperCase(), img: q.get("img") ?? "",
    };
    setCtx(c);
    if (!c.hid || !c.sid || !rooms) { setError("This hotel link is incomplete or from an older search. Please search again."); setLoading(false); return; }
    if (c.exp && Date.parse(c.exp) < Date.now()) { setError("Your search has expired. Please search again for live prices."); setLoading(false); return; }
    fetch(`${API_URL}/api/hotels/detail`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-slug": "tripcod" },
      body: JSON.stringify({ correlationId: c.sid, hid: c.hid, checkIn: c.checkIn, checkOut: c.checkOut, rooms: toTripjackRooms(rooms), nationality: c.nat, currency: c.currency }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(typeof d.error === "string" ? d.error : "Could not load rooms for this hotel.");
        setDetail(d as Detail);
      })
      .catch((e) => setError(e?.message ?? "Could not load rooms."))
      .finally(() => setLoading(false));
  }, []);

  const options = (detail?.options ?? []).filter((o) => filter === "all" ? true
    : filter === "refundable" ? o.cancellation.isRefundable : /breakfast|^CP$|^MAP$|^AP$|half board|full board/i.test(o.mealBasis));

  function bookUrl(o: HotelOption) {
    if (!ctx || !detail) return "#";
    const p = new URLSearchParams({
      hid: ctx.hid, sid: ctx.sid, exp: ctx.exp, occ: ctx.occ, nat: ctx.nat, optionId: o.optionId, rh: detail.reviewHash,
      name: detail.hotelName || ctx.name, stars: String(ctx.stars), price: String(o.pricing.totalPrice), currency: o.pricing.currency || ctx.currency,
      checkIn: ctx.checkIn, checkOut: ctx.checkOut, nights: String(ctx.nights), roomType: o.roomInfo.map((r) => r.name).join(" | "),
      mealPlan: o.mealBasis, ref: o.cancellation.isRefundable ? "1" : "0", city: ctx.city, address: detail.hotel?.address || ctx.address, cc: ctx.cc,
      img: detail.hotel?.images?.[0] ?? ctx.img,
    });
    return `/hotels/book?${p}`;
  }

  const totals = ctx ? occupancyTotals(ctx.rooms) : null;
  const name = detail?.hotelName || detail?.hotel?.name || ctx?.name || "Hotel";
  const image = detail?.hotel?.images?.[0] || ctx?.img;

  return (
    <main className="ck"><style>{hotelCss + css}</style>
      <header>
        <button type="button" onClick={() => history.back()} aria-label="Back to results">‹</button>
        <div><b>{name}</b><span>{ctx ? `${dayLabel(ctx.checkIn)} → ${dayLabel(ctx.checkOut)}` : ""}</span></div>
      </header>
      <ol className="steps" aria-label="Booking steps"><li className="done">Search</li><li className="done">Hotel</li><li className="on">Room</li><li>Guests &amp; payment</li></ol>

      {error && <div className="err" role="alert"><b>Couldn&apos;t load rooms</b><span>{error}</span><a href="/hotels" style={{ fontWeight: 700 }}>Search again</a></div>}

      {ctx && (
        <section className="card">
          {image && /* eslint-disable-next-line @next/next/no-img-element */ <img className="himg" src={image} alt="" />}
          <div className="hh">
            <div>
              <b style={{ fontSize: 18 }}>{name}</b>
              {(detail?.hotel?.starRating || ctx.stars) > 0 && <span className="stars" aria-label={`${detail?.hotel?.starRating || ctx.stars} star`}>{"★".repeat(Math.min(5, detail?.hotel?.starRating || ctx.stars))}</span>}
              {(detail?.hotel?.address || ctx.address) && <small>{detail?.hotel?.address || ctx.address}</small>}
            </div>
          </div>
          <div className="hd">
            <div><b>{dayLabel(ctx.checkIn)}</b><span>Check-in</span></div>
            <div className="hd-nights">{ctx.nights} night{ctx.nights === 1 ? "" : "s"}</div>
            <div className="hd-end"><b>{dayLabel(ctx.checkOut)}</b><span>Check-out</span></div>
          </div>
          {totals && <p style={{ margin: "4px 0 0", fontSize: 13, fontWeight: 700 }}>{totals.rooms} room{totals.rooms === 1 ? "" : "s"} · {totals.adults} adult{totals.adults === 1 ? "" : "s"}{totals.children ? ` · ${totals.children} child${totals.children === 1 ? "" : "ren"}` : ""}</p>}
          <OccupancyList rooms={ctx.rooms} />
          {detail?.hotel?.amenities?.length ? <p className="amen">{detail.hotel.amenities.slice(0, 8).join(" · ")}</p> : null}
        </section>
      )}

      {loading && <div className="note note-info" role="status"><span className="spinner" /> Loading live room rates…</div>}

      {detail && (
        <section aria-labelledby="rooms-title">
          <div className="rooms-head">
            <h2 id="rooms-title">Choose your room{ctx && ctx.rooms.length > 1 ? "s" : ""}</h2>
            <div className="filters" role="group" aria-label="Filter rooms">
              {(["all", "refundable", "breakfast"] as const).map((f) => (
                <button key={f} type="button" aria-pressed={filter === f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? `All (${detail.options.length})` : f === "refundable" ? "Free cancellation" : "With meals"}
                </button>
              ))}
            </div>
          </div>
          {!options.length && <div className="card">No rooms match this filter.</div>}
          {options.map((o) => (
            <article key={o.optionId} className="card opt">
              <div className="opt-main">
                <ul className="opt-rooms">
                  {o.roomInfo.map((r, i) => <li key={i}><b>{o.roomInfo.length > 1 || (ctx?.rooms.length ?? 1) > 1 ? `Room ${i + 1}: ` : ""}</b>{r.name}</li>)}
                </ul>
                <p className="opt-tags">
                  <span>{mealLabel(o.mealBasis) || "Room only"}</span>
                  {o.compliance.panRequired && <span className="tag-warn">PAN required</span>}
                  {o.compliance.passportRequired && <span className="tag-warn">Passport required</span>}
                </p>
                <details><summary>{o.cancellation.isRefundable ? "Refundable — see cancellation policy" : "Non-refundable — see policy"}</summary>
                  <CancellationPolicy policy={o.cancellation} currency={o.pricing.currency} />
                </details>
                <HotelNotes items={[...o.inclusions, ...(o.bookingNotes ? [o.bookingNotes] : [])]} />
              </div>
              <div className="opt-price">
                {o.pricing.strikethrough && o.pricing.strikethrough > o.pricing.totalPrice ? <s>{money(o.pricing.strikethrough, o.pricing.currency)}</s> : null}
                <strong>{money(o.pricing.totalPrice, o.pricing.currency)}</strong>
                <small>Total for {ctx?.nights ?? 1} night{(ctx?.nights ?? 1) === 1 ? "" : "s"}, {ctx?.rooms.length ?? 1} room{(ctx?.rooms.length ?? 1) === 1 ? "" : "s"} · incl. taxes &amp; fees</small>
                <a className="btn" href={bookUrl(o)}>Select</a>
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}

const css = `.amen{font-size:12px;color:#667085;margin:10px 0 0;line-height:1.6}
.rooms-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin:6px 0 12px}.rooms-head h2{font-size:18px;margin:0}
.filters{display:flex;gap:6px;flex-wrap:wrap}.filters button{min-height:36px;padding:0 12px;border-radius:99px;border:1px solid #d0d5dd;background:#fff;font-size:12px;font-weight:700;cursor:pointer;color:#344054}.filters button.on{background:#4B4D4F;border-color:#4B4D4F;color:#fff}
.opt{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}.opt-rooms{list-style:none;margin:0;padding:0;display:grid;gap:4px;font-size:14px}.opt-tags{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;font-size:12px}.opt-tags span{padding:3px 8px;border-radius:6px;background:#f2f4f7;color:#344054}.opt-tags .tag-warn{background:#fffbeb;color:#92400e}
.opt details summary{cursor:pointer;font-size:13px;font-weight:700;color:#344054;margin-bottom:6px}
.opt-price{display:flex;flex-direction:column;gap:6px;align-items:flex-start;border-top:1px dashed #eaecf0;padding-top:12px}.opt-price strong{font-size:22px}.opt-price s{font-size:12px;color:#98a2b3}.opt-price small{font-size:11px;color:#667085}.opt-price .btn{width:100%;margin-top:4px;box-sizing:border-box}
@media(min-width:720px){.opt{grid-template-columns:minmax(0,1fr) 220px}.opt-price{border-top:0;border-left:1px solid #eaecf0;padding:0 0 0 16px;align-items:flex-end;text-align:right}}`;
