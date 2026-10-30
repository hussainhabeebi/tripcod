"use client";

import { usePaymentOptions } from "../../components/PaymentMethodPicker";
import { FormEvent, useEffect, useState } from "react";
import { ScanDocument, type ScannedTraveller } from "../../components/ScanDocument";
import {
  PAN_PATTERN, decodeOccupancy, describeRoom, guestErrors, guestTitles, leadPanRequired, occupancyTotals, toTripjackRooms,
  type HotelGuestInput, type RoomOccupancy,
} from "@tripcod/suppliers/hotel-occupancy";
import {
  API_URL, CancellationPolicy, HotelNotes, OccupancyList, PriceBreakup, dayLabel, hotelCss, istTime, mealLabel, money,
  orderApi, readCustomerToken, saveOrderKey, type HotelOption,
} from "../hotel-ui";

// Hotel checkout: TripJack Review (live price + booking ID) → guests room by room →
// Instant (pay now) or Hold (pay before the supplier's deadline) → payment.

type HotelInfo = {
  optionId: string; hid: string; correlationId: string; reviewHash: string; occ: string; rooms: RoomOccupancy[];
  nationality: string; expiresAt: string; name: string; stars: number; price: number; currency: string;
  checkIn: string; checkOut: string; nights: number; roomType: string; mealPlan: string;
  isRefundable: boolean; city: string; address: string; countryCode: string; image: string;
};

type Guest = HotelGuestInput & { pan: string; passport: string; age?: number };

type Review = {
  bookingId: string; priceChanged: boolean; optionChanged: boolean; onholdAllowed: boolean; reviewExpiresAt?: string;
  hotel?: { name: string; address: string; countryCode: string; stars: number; image?: string };
  option: HotelOption;
};
type SavedPassenger = { id: string; firstName: string; lastName: string; isDefault: boolean };

// API errors are usually a string; a validation failure can be an object.
function errorText(err: unknown, fallback: string): string {
  if (typeof err === "string" && err.trim()) return err;
  const issue = (err as { issues?: { message?: string; path?: unknown[] }[] } | null)?.issues?.[0];
  if (issue?.message) return `Please search again (${[issue.path?.join("."), issue.message].filter(Boolean).join(": ")}).`;
  return fallback;
}

const guestsFor = (rooms: RoomOccupancy[]): Guest[][] => rooms.map((r) => [
  ...Array.from({ length: r.adults }, (): Guest => ({ title: "Mr", firstName: "", lastName: "", type: "ADULT", pan: "", passport: "" })),
  ...r.childAges.map((age): Guest => ({ title: "Master", firstName: "", lastName: "", type: "CHILD", pan: "", passport: "", age })),
]);

export default function HotelBookPage() {
  const apiUrl = API_URL;

  const [hotel,       setHotel]       = useState<HotelInfo | null>(null);
  const [prebooking,  setPrebooking]  = useState(false);
  const [prebookErr,  setPrebookErr]  = useState("");
  const [review,      setReview]      = useState<Review | null>(null);
  // PAN becomes required when the room says so, or when TripJack asks for it at booking (error 1092).
  const [panNeeded,   setPanNeeded]   = useState(false);

  const [contactName, setContactName] = useState("");
  const [email,       setEmail]       = useState("");
  const [phone,       setPhone]       = useState("");
  const [dialCode,    setDialCode]    = useState("+91");
  const [guests,      setGuests]      = useState<Guest[][]>([]);
  const [mode,        setMode]        = useState<"INSTANT" | "HOLD">("INSTANT");
  const [method,      setMethod]      = useState<"CARD" | "WALLET" | "UPI">("CARD");
  // UPI / netbanking via PhonePe, when Admin has enabled it (INR only).
  const paymentOptions = usePaymentOptions();
  const [wallet,      setWallet]      = useState<number | null>(null);
  const [accepted,    setAccepted]    = useState(false);

  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState("");

  // Auth state
  const [token,           setToken]           = useState("");
  const [savedPassengers, setSavedPassengers] = useState<SavedPassenger[]>([]);
  const [showLogin,     setShowLogin]     = useState(false);
  const [loginEmail,    setLoginEmail]    = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError,    setLoginError]    = useState("");
  const [loggingIn,     setLoggingIn]     = useState(false);

  const compliance = review?.option.compliance;
  const countryCode = (review?.hotel?.countryCode || hotel?.countryCode || "").toUpperCase();
  const rules = {
    nationality: hotel?.nationality ?? "IN", hotelCountryCode: countryCode,
    panRequired: Boolean(compliance?.panRequired) || panNeeded, passportRequired: Boolean(compliance?.passportRequired),
  };
  const indianGuests = rules.nationality.toUpperCase() === "IN";
  const overseas = Boolean(countryCode && countryCode !== "IN");
  const panRequiredNow = leadPanRequired(rules);

  useEffect(() => {
    const t = readCustomerToken();
    if (t) { setToken(t); fetchSavedPassengers(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchSavedPassengers(t: string) {
    try {
      const res = await fetch(`${apiUrl}/api/profile/passengers`, { headers: { "Authorization": `Bearer ${t}`, "x-tenant-slug": "tripcod" } });
      if (res.ok) {
        const d = await res.json() as { passengers: SavedPassenger[] };
        setSavedPassengers(d.passengers ?? []);
        const def = d.passengers.find((p) => p.isDefault);
        if (def) {
          setGuests((gs) => gs.map((room, ri) => ri !== 0 ? room : room.map((g, gi) => gi !== 0 || g.firstName ? g : {
            ...g, firstName: def.firstName, lastName: def.lastName,
          })));
        }
      }
    } catch { /* non-fatal */ }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setLoginError("");
    setLoggingIn(true);
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-tenant-slug": "tripcod" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const d = await res.json() as any;
      if (!res.ok) throw new Error(errorText(d.error, "Login failed"));
      document.cookie = `tripcod_token=${d.token}; Path=/; SameSite=Lax; Secure`;
      setToken(d.token);
      setShowLogin(false);
      await fetchSavedPassengers(d.token);
    } catch (x: any) {
      setLoginError(x?.message ?? "Login failed");
    } finally {
      setLoggingIn(false);
    }
  }

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const optionId = q.get("optionId") ?? "";
    if (!optionId) return;

    // Room-wise occupancy; older links carried rooms × adults.
    const legacyRooms = Math.max(1, parseInt(q.get("rooms") ?? "1") || 1);
    const legacyAdults = Math.max(1, parseInt(q.get("adults") ?? "1") || 1);
    const rooms = decodeOccupancy(q.get("occ")) ?? Array.from({ length: legacyRooms }, () => ({ adults: legacyAdults, childAges: [] }));
    const info: HotelInfo = {
      optionId,
      hid:           q.get("hid") ?? "",
      correlationId: q.get("sid") ?? "",
      reviewHash:    q.get("rh") ?? "",
      occ:           q.get("occ") ?? "",
      rooms,
      nationality:   (q.get("nat") ?? "IN").toUpperCase(),
      expiresAt:     q.get("exp") ?? "",
      name:        q.get("name")     ?? "",
      stars:       parseInt(q.get("stars")  ?? "0") || 0,
      price:       parseFloat(q.get("price") ?? "0") || 0,
      currency:    q.get("currency") ?? "INR",
      checkIn:     q.get("checkIn")  ?? "",
      checkOut:    q.get("checkOut") ?? "",
      nights:      parseInt(q.get("nights") ?? "1") || 1,
      roomType:    q.get("roomType") ?? "",
      mealPlan:    q.get("mealPlan") ?? "",
      isRefundable: q.get("ref") === "1",
      city:        q.get("city")    ?? "",
      address:     q.get("address") ?? "",
      countryCode: (q.get("cc") ?? "").toUpperCase(),
      image:       q.get("img") ?? "",
    };
    setHotel(info);
    setGuests(guestsFor(rooms));

    if (!info.hid || !info.correlationId) {
      setPrebookErr("This hotel link is from an older search. Please search again.");
      return;
    }
    if (info.expiresAt && Date.parse(info.expiresAt) < Date.now()) {
      setPrebookErr("Your search has expired. Please search again for live prices.");
      return;
    }

    // TripJack Review: re-validates availability + price and returns the booking ID.
    setPrebooking(true);
    fetch(`${apiUrl}/api/hotels/review`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "x-tenant-slug": "tripcod" },
      body: JSON.stringify({
        correlationId: info.correlationId, hid: info.hid, optionId, ...(info.reviewHash ? { reviewHash: info.reviewHash } : {}),
        checkIn: info.checkIn, checkOut: info.checkOut,
        rooms: toTripjackRooms(rooms),
        nationality: info.nationality, currency: info.currency,
      }),
    })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(errorText(d.error, "This room is no longer available"));
        return d as Review;
      })
      .then((d) => setReview(d))
      .catch((err) => setPrebookErr(err?.message ?? "Price check failed"))
      .finally(() => setPrebooking(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Wallet pays INR bookings in full when the signed-in customer's balance covers them.
  useEffect(() => {
    if (!token || !review) { setWallet(null); return; }
    fetch(`${apiUrl}/api/profile/wallet`, { headers: { "x-tenant-slug": "tripcod", Authorization: `Bearer ${token}` } })
      .then((r) => r.ok ? r.json() : null)
      .then((w: { balance?: number } | null) => setWallet(typeof w?.balance === "number" ? w.balance : null))
      .catch(() => setWallet(null));
  }, [token, review]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = review?.option.pricing.totalPrice ?? hotel?.price ?? 0;
  const currency = review?.option.pricing.currency || hotel?.currency || "INR";
  const walletCovers = wallet !== null && currency === "INR" && wallet >= total;
  useEffect(() => { if (!walletCovers && method === "WALLET") setMethod("CARD"); }, [walletCovers, method]);
  const upiAvailable = Boolean(paymentOptions?.gateways.PHONEPE) && currency === "INR";
  useEffect(() => { if (!upiAvailable && method === "UPI") setMethod("CARD"); }, [upiAvailable, method]);

  // Passport / ID scan → this guest's name (and passport number from a passport).
  const scanGuest = (room: number, i: number, t: ScannedTraveller) =>
    setGuests((gs) => gs.map((rm, ri) => ri !== room ? rm : rm.map((g, n) => n !== i ? g : {
      ...g,
      ...(t.firstName ? { firstName: t.firstName } : {}),
      ...(t.lastName ? { lastName: t.lastName } : {}),
      ...(g.type === "ADULT" && t.gender === "F" && g.title === "Mr" ? { title: "Ms" } : g.type === "ADULT" && t.gender === "M" && g.title !== "Mr" ? { title: "Mr" } : {}),
      ...(t.documentType === "PASSPORT" && t.documentNumber ? { passport: t.documentNumber } : {}),
    })));

  const updGuest = (room: number, i: number, k: keyof Guest, v: string) =>
    setGuests((gs) => gs.map((rm, ri) => ri !== room ? rm : rm.map((g, n) => n === i ? { ...g, [k]: v } : g)));

  function payload(): HotelGuestInput[][] {
    return guests.map((room) => room.map((g) => ({
      title: g.title, firstName: g.firstName.trim(), lastName: g.lastName.trim(), type: g.type,
      ...(PAN_PATTERN.test(g.pan.trim().toUpperCase()) ? { pan: g.pan.trim().toUpperCase() } : {}),
      ...(g.passport.trim().length >= 5 ? { passport: g.passport.trim().toUpperCase() } : {}),
    })));
  }

  function fail(message: string) {
    setError(message);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hotel || !review || submitting || prebooking) return;
    setError("");
    const badPan = guests.flat().find((g) => g.pan.trim() && !PAN_PATTERN.test(g.pan.trim().toUpperCase()));
    if (badPan) return fail(`PAN "${badPan.pan}" doesn't look right — it should be 10 characters like ABCDE1234F.`);
    const problems = guestErrors(hotel.rooms, payload(), rules);
    if (problems.length) return fail(problems[0]);
    if (!accepted) return fail("Please accept the cancellation policy and booking terms.");
    setSubmitting(true);
    let orderId = "";
    let key = "";
    try {
      const created = await orderApi<{ order: { id: string }; key: string }>("/orders", { body: {
        bookingId: review.bookingId, mode, contactEmail: email.trim(), contactPhone: phone.trim(), dialCode,
        rooms: payload().map((g) => ({ guests: g })),
      } }).catch((err: any) => {
        if (err?.data?.errorCode === "PAN_REQUIRED") setPanNeeded(true);
        // A hold the supplier refused still created the order (shows the reason there).
        if (err?.data?.order?.id && err?.data?.key) return { order: err.data.order, key: err.data.key, failed: err.message as string };
        throw err;
      });
      orderId = created.order.id;
      key = created.key;
      saveOrderKey(orderId, key);
      if ((created as { failed?: string }).failed) throw new Error((created as { failed?: string }).failed);
      if (mode === "INSTANT") {
        const paid = await orderApi<{ paymentUrl?: string; paid?: boolean }>(`/orders/${orderId}/pay`, { key, body: { method } });
        if (paid.paymentUrl) { window.location.href = paid.paymentUrl; return; }
      }
      window.location.href = `/hotels/booking/${orderId}#key=${key}`;
    } catch (x: any) {
      if (orderId) {
        // The order exists (e.g. payment couldn't open): continue on its page, where payment can be retried.
        window.location.href = `/hotels/booking/${orderId}#key=${key}&error=${encodeURIComponent(x?.message ?? "")}`;
        return;
      }
      fail(x?.message ?? "Booking failed");
      setSubmitting(false);
    }
  }

  const totals = hotel ? occupancyTotals(hotel.rooms) : null;
  const roomNames = review?.option.roomInfo.map((r) => r.name);

  return (
    <main className="ck"><style>{hotelCss}</style>
      <header>
        <button type="button" onClick={() => history.back()} aria-label="Back">‹</button>
        <div><b>Hotel checkout</b><span>{review?.hotel?.name || hotel?.name || "Loading…"}</span></div>
        <i aria-hidden="true">🔒</i>
      </header>
      <ol className="steps" aria-label="Booking steps"><li className="done">Search</li><li className="done">Room</li><li className="on">Guests &amp; payment</li><li>Confirmation</li></ol>

      {error && <div className="err" role="alert"><b>Couldn&apos;t continue</b><span>{error}</span></div>}

      {!token && !showLogin && (
        <div className="note note-info">Save time — <button type="button" style={{ background: "none", border: 0, color: "#1d4ed8", fontWeight: 700, textDecoration: "underline", cursor: "pointer", padding: 0, font: "inherit" }} onClick={() => setShowLogin(true)}>sign in</button> to auto-fill guests and pay from your wallet.</div>
      )}
      {showLogin && (
        <section className="card">
          <div className="title"><span>👤</span><div><h2>Sign in</h2><p>Auto-fill your saved guest details.</p></div></div>
          {loginError && <div className="err"><span>{loginError}</span></div>}
          <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="grid">
              <Input l="Email" t="email" v={loginEmail} c={setLoginEmail} r />
              <Input l="Password" t="password" v={loginPassword} c={setLoginPassword} r />
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="submit" className="btn" disabled={loggingIn}>{loggingIn ? "Signing in…" : "Sign in"}</button>
              <button type="button" className="btn btn-light" onClick={() => setShowLogin(false)}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {prebooking && <div className="note note-info" role="status"><span className="spinner" /> Verifying availability &amp; price with the hotel…</div>}
      {!prebooking && review && (
        <div className="note note-ok">✓ Available — price confirmed with the hotel
          {review.priceChanged && <b> · Price updated to {money(total, currency)}</b>}
          {review.optionChanged && <b> · Room option updated</b>}
        </div>
      )}
      {!prebooking && prebookErr && <div className="note note-warn">⚠ {prebookErr} <a href="/hotels" style={{ fontWeight: 700 }}>Search again</a></div>}

      <form onSubmit={submit}>
        <div className="cols">
          <div>
            {/* Hotel + room summary */}
            {hotel && (
              <section className="card">
                {(review?.hotel?.image || hotel.image) && /* eslint-disable-next-line @next/next/no-img-element */ <img className="himg" src={review?.hotel?.image || hotel.image} alt="" />}
                <div className="hh">
                  <div>
                    <b style={{ fontSize: 17 }}>{review?.hotel?.name || hotel.name}</b>
                    {hotel.stars > 0 && <span className="stars">{"★".repeat(Math.min(5, hotel.stars))}</span>}
                    {(review?.hotel?.address || hotel.address) && <small>{review?.hotel?.address || hotel.address}</small>}
                  </div>
                </div>
                <div className="hd">
                  <div><b>{dayLabel(hotel.checkIn)}</b><span>Check-in</span></div>
                  <div className="hd-nights">{hotel.nights} night{hotel.nights === 1 ? "" : "s"}</div>
                  <div className="hd-end"><b>{dayLabel(hotel.checkOut)}</b><span>Check-out</span></div>
                </div>
                {totals && <p style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{totals.rooms} room{totals.rooms === 1 ? "" : "s"} · {totals.adults} adult{totals.adults === 1 ? "" : "s"}{totals.children ? ` · ${totals.children} child${totals.children === 1 ? "" : "ren"}` : ""}{review ? ` · ${mealLabel(review.option.mealBasis)}` : ""}</p>}
                <OccupancyList rooms={hotel.rooms} roomNames={roomNames} />
              </section>
            )}

            {review && (
              <section className="card">
                <div className="title"><span>↺</span><div><h2>Cancellation policy</h2><p>From the hotel supplier for this room.</p></div></div>
                <CancellationPolicy policy={review.option.cancellation} currency={currency} />
                <HotelNotes items={[...review.option.inclusions, ...(review.option.bookingNotes ? [review.option.bookingNotes] : [])]} />
              </section>
            )}

            {/* Contact */}
            <section className="card">
              <div className="title"><span>☎</span><div><h2>Contact details</h2><p>Booking updates are sent here.</p></div></div>
              <div className="grid">
                <Input l="Full name" v={contactName} c={setContactName} r />
                <Input l="Email" t="email" v={email} c={setEmail} r />
                <label>Country code
                  <select value={dialCode} onChange={(e) => setDialCode(e.target.value)}>
                    {["+91", "+971", "+966", "+974", "+968", "+965", "+973", "+44", "+1", "+65", "+60", "+61"].map((d) => <option key={d}>{d}</option>)}
                  </select>
                </label>
                <Input l="Mobile" t="tel" v={phone} c={setPhone} r ph="98765 43210" />
              </div>
            </section>

            {/* Guests, room by room */}
            <section className="card">
              <div className="title"><span>👤</span><div><h2>Guest details</h2><p>Names exactly as on government ID, for every guest in every room.</p></div></div>
              {guests.map((room, ri) => (
                <div className="roomblock" key={ri}>
                  <h3>Room {ri + 1}{roomNames?.[ri] ? ` · ${roomNames[ri]}` : ""}<small>{hotel ? describeRoom(hotel.rooms[ri]) : ""}</small></h3>
                  {room.map((g, i) => {
                    const lead = ri === 0 && i === 0;
                    const adultNo = room.slice(0, i + 1).filter((x) => x.type === "ADULT").length;
                    const childNo = room.slice(0, i + 1).filter((x) => x.type === "CHILD").length;
                    // Every Indian guest can give a PAN (TripJack takes one per traveller; the same
                    // PAN may be reused across rooms / guests). Only the lead's is ever required.
                    const showPan = indianGuests;
                    const showPassport = Boolean(compliance?.passportRequired) || (lead && overseas);
                    return (
                      <div className="pax" key={i}>
                        <div className="pax-head">
                          <span className={g.type === "CHILD" ? "chip chip-child" : "chip"}>
                            {g.type === "CHILD" ? `Child ${childNo} · age ${g.age}` : i === 0 ? (lead ? "Lead guest" : "Room lead guest") : `Adult ${adultNo}`}
                          </span>
                          {savedPassengers.length > 0 && (
                            <select className="profileSelect" value="" aria-label="Use a saved traveller" style={{ height: 34, borderRadius: 9, border: "1px solid #d0d5dd" }}
                              onChange={(e) => {
                                const sp = savedPassengers.find((x) => x.id === e.target.value);
                                if (sp) { updGuest(ri, i, "firstName", sp.firstName); updGuest(ri, i, "lastName", sp.lastName); }
                              }}>
                              <option value="">Use saved traveller…</option>
                              {savedPassengers.map((x) => <option key={x.id} value={x.id}>{x.firstName} {x.lastName}{x.isDefault ? " ★" : ""}</option>)}
                            </select>
                          )}
                        </div>
                        {g.type === "ADULT" && <ScanDocument onScanned={(t) => scanGuest(ri, i, t)} />}
                        <div className="grid">
                          <label>Title
                            <select value={g.title} onChange={(e) => updGuest(ri, i, "title", e.target.value)}>
                              {guestTitles(g.type).map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </label>
                          <Input l="First name" v={g.firstName} c={(v) => updGuest(ri, i, "firstName", v)} r />
                          <Input l="Last name" v={g.lastName} c={(v) => updGuest(ri, i, "lastName", v)} r />
                          {showPan && (
                            <Input
                              l={lead && panRequiredNow ? (overseas && !compliance?.panRequired ? "PAN (required for stays outside India)" : "PAN (required by the hotel)") : "PAN (optional)"}
                              v={g.pan} c={(v) => updGuest(ri, i, "pan", v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                              r={lead && panRequiredNow} ph="ABCDE1234F" max={10} />
                          )}
                          {showPassport && (
                            <Input l={compliance?.passportRequired ? "Passport number" : "Passport number (optional)"}
                              v={g.passport} c={(v) => updGuest(ri, i, "passport", v.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                              r={Boolean(compliance?.passportRequired)} max={15} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          </div>

          <aside>
            {review && (
              <section className="card">
                <div className="title"><span>₹</span><div><h2>Price summary</h2><p>{hotel?.nights} night{hotel?.nights === 1 ? "" : "s"} · {hotel?.rooms.length} room{hotel?.rooms.length === 1 ? "" : "s"} · incl. taxes</p></div></div>
                <PriceBreakup pricing={{ ...review.option.pricing, currency }} />
              </section>
            )}

            {review && (
              <section className="card">
                <div className="title"><span>✓</span><div><h2>How do you want to book?</h2><p>Only options the hotel supplier allows for this room are shown.</p></div></div>
                <div className="choice" role="radiogroup" aria-label="Booking type">
                  <label>
                    <input type="radio" name="mode" checked={mode === "INSTANT"} onChange={() => setMode("INSTANT")} />
                    <span><b>Pay now &amp; confirm</b><small>We book with the hotel as soon as your payment succeeds. Confirmed once the hotel supplier confirms.</small></span>
                  </label>
                  {review.onholdAllowed ? (
                    <label>
                      <input type="radio" name="mode" checked={mode === "HOLD"} onChange={() => setMode("HOLD")} />
                      <span><b>Hold now, pay later</b><small>The supplier holds the room without payment until its hold deadline (shown after holding). The booking is <u>not confirmed</u> until you pay and the supplier confirms; an unpaid hold is released automatically.</small></span>
                    </label>
                  ) : (
                    <p style={{ fontSize: 12, color: "#667085", margin: 0 }}>Hold isn&apos;t offered for this room by the supplier.</p>
                  )}
                </div>
              </section>
            )}

            {review && mode === "INSTANT" && (
              <section className="card">
                <div className="title"><span>💳</span><div><h2>Payment method</h2><p>You are charged {money(total, currency)}.</p></div></div>
                <div className="choice" role="radiogroup" aria-label="Payment method">
                  <label>
                    <input type="radio" name="method" checked={method === "CARD"} onChange={() => setMethod("CARD")} />
                    <span><b>Card</b><small>Secure payment page from our payment partner (Nomod).</small></span>
                  </label>
                  {upiAvailable && (
                    <label>
                      <input type="radio" name="method" checked={method === "UPI"} onChange={() => setMethod("UPI")} />
                      <span><b>UPI / netbanking</b><small>PhonePe secure payment page{paymentOptions?.phonepeEnvironment === "UAT" ? " (test mode)" : ""}.</small></span>
                    </label>
                  )}
                  <label className={walletCovers ? "" : "disabled"}>
                    <input type="radio" name="method" disabled={!walletCovers} checked={method === "WALLET"} onChange={() => setMethod("WALLET")} />
                    <span><b>Tripcod wallet</b><small>{!token ? "Sign in to use your wallet balance." : currency !== "INR" ? "The wallet pays INR bookings only." : wallet === null ? "Wallet balance unavailable." : walletCovers ? `Balance ${money(wallet, "INR")} — covers this booking.` : `Balance ${money(wallet, "INR")} doesn't cover this booking.`}</small></span>
                  </label>
                </div>
              </section>
            )}

            {review && (
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, margin: "0 2px 14px", lineHeight: 1.5 }}>
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} style={{ width: 18, height: 18, marginTop: 2, accentColor: "#4B4D4F" }} />
                <span>I have read the cancellation policy{review.option.cancellation.isRefundable ? "" : " (this room is non-refundable)"} and confirm the guest details are correct.{review.reviewExpiresAt ? ` Price held until ${new Date(review.reviewExpiresAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.` : ""}</span>
              </label>
            )}
          </aside>
        </div>

        <div className="spacer" />
        <div className="pay">
          <div>
            <span>{mode === "HOLD" ? "Due before hold deadline" : "Total payable"}</span>
            <b>{money(total, currency)}</b>
          </div>
          <button disabled={!hotel || !review || submitting || prebooking}>
            {submitting ? (mode === "HOLD" ? "Holding…" : "Starting payment…")
              : mode === "HOLD" ? "Hold booking" : method === "WALLET" ? `Pay ${money(total, currency)} from wallet` : `Pay ${money(total, currency)}`}
          </button>
        </div>
      </form>
      {review?.option.cancellation.deadlineDateTime && <p style={{ fontSize: 11, color: "#98a2b3" }}>Supplier cancellation deadline: {istTime(review.option.cancellation.deadlineDateTime)}</p>}
    </main>
  );
}

function Input({ l, v, c, t = "text", r = false, ph, max }: {
  l: string; v: string; c: (v: string) => void; t?: string; r?: boolean; ph?: string; max?: number;
}) {
  return (
    <label>{l}
      <input type={t} value={v} onChange={(e) => c(e.target.value)} required={r} placeholder={ph} maxLength={max} />
    </label>
  );
}
