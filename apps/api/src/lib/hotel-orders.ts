// Website hotel orders on TripJack Hotel API v3.
//
//   Instant:  order (PAYMENT_PENDING) → customer pays → book with paymentInfos → poll → CONFIRMED / FAILED
//   Hold:     order → book without paymentInfos → poll → ON_HOLD (deadline from the supplier)
//             → customer pays → confirm-book → poll → CONFIRMED; an expired hold is cancelled
//               by TripJack and shows as CANCELLED.
//   Cancel:   CONFIRMED / ON_HOLD → cancel-booking → Booking Details → CANCELLED only when TripJack says so.
//
// Rules this module enforces:
//   • A booking is CONFIRMED only when TripJack's Booking Details status is SUCCESS —
//     never because a payment succeeded, never for a hold.
//   • Each TripJack book / confirm-book is sent at most once per order (atomic
//     claim on supplier_submitted_at / confirm_submitted_at). An unknown outcome
//     (timeout) is re-read from Booking Details, never re-submitted.
//   • One payment per order: the payment slot is claimed atomically and an open
//     Nomod link is reused, so a customer can't be charged twice.
//   • A failed booking after payment is refunded in full; a customer cancellation
//     records the policy refund for the team to settle.

import {
  HOTEL_TERMINAL_STATUSES, cancellationChargeAt, parseHotelBookingDetails,
  type HotelGuestInput, type HotelV3Option, type RoomOccupancy, type TripjackHotelV3Client,
} from "@tripcod/suppliers";

// One website hotel order (Cloudflare D1 table hotel_bookings — see
// apps/api/d1-migrations). tenantId / userId are Neon ids (tenants / users)
// kept as plain text: there is no cross-database foreign key.
export interface HotelOrder {
  id: string; tenantId: string; userId: string | null;
  supplierBookingId: string; mode: string; status: string; supplierStatus: string | null;
  confirmationNo: string | null; holdDeadline: string | null;
  hotel: unknown; occupancy: unknown; guests: unknown; option: unknown; nationality: string;
  amount: string; currency: "INR" | "AED" | "USD";
  contactEmail: string; contactPhone: string; dialCode: string;
  paymentStatus: string; paymentGateway: string | null; paymentOrderId: string | null; paymentRef: string | null;
  paymentUrl: string | null; paidAt: Date | null; refundAmount: string | null; refundNote: string | null;
  supplierSubmittedAt: Date | null; confirmSubmittedAt: Date | null;
  cancellation: unknown; accessKeyHash: string; lastError: string | null; lastCheckedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}
export type NewHotelOrder = Pick<HotelOrder, "tenantId" | "userId" | "supplierBookingId" | "mode" | "status" | "hotel" | "occupancy"
  | "guests" | "option" | "nationality" | "amount" | "currency" | "contactEmail" | "contactPhone" | "dialCode" | "accessKeyHash">;
export type HotelOrderPatch = Partial<Omit<HotelOrder, "id" | "tenantId" | "createdAt">>;

export interface OrderGuard {
  status?: string[];
  paymentStatus?: string[];
  supplierSubmittedAtNull?: boolean;
  confirmSubmittedAtNull?: boolean;
}

export interface HotelOrderStore {
  insert(row: NewHotelOrder): Promise<HotelOrder | null>;              // null when the TripJack booking already has an order
  get(id: string): Promise<HotelOrder | null>;
  bySupplierBooking(tenantId: string, supplierBookingId: string): Promise<HotelOrder | null>;
  byPaymentOrder(paymentOrderIds: string[]): Promise<HotelOrder | null>;
  listByUser(tenantId: string, userId: string): Promise<HotelOrder[]>;
  // Conditional update: returns the updated row, or null when the guard no longer holds.
  update(id: string, patch: HotelOrderPatch, guard?: OrderGuard): Promise<HotelOrder | null>;
}

export type HotelBookingClient = Pick<TripjackHotelV3Client, "book" | "confirmBook" | "bookingDetails" | "cancel">;

export interface HotelOrderDeps {
  store:   HotelOrderStore;
  client:  HotelBookingClient;
  // Wraps every supplier call (Admin → Supplier logs).
  call:    <T>(endpoint: string, summary: Record<string, unknown>, fn: () => Promise<T>) => Promise<T>;
  // Full refund of a captured payment; ok=false leaves it for the team (REFUND_PENDING).
  refund:  (order: HotelOrder, amount: number, reason: string) => Promise<{ ok: boolean; note: string }>;
  enqueue: (orderId: string) => Promise<void>;
  // Neon wallet ledger lookup by payment_id (the order lives in D1, the money in Neon).
  walletDebited?: (paymentRef: string) => Promise<boolean>;
  now?:    () => number;
  sleep?:  (ms: number) => Promise<void>;
  pollMs?: number;   // how long to wait for a terminal TripJack status
}

export type HotelDetails = ReturnType<typeof parseHotelBookingDetails>;

export class HotelOrderError extends Error {
  constructor(message: string, public status: 400 | 402 | 403 | 404 | 409 | 410 | 502 | 503, public code: string, public extra: Record<string, unknown> = {}) {
    super(message);
    this.name = "HotelOrderError";
  }
}

// ── Review snapshot (saved at /review, the only trusted source of price) ─────

export interface ReviewSnapshot {
  tenantId:      string;
  bookingId:     string;     // TripJack bookingId from Review
  hid:           string;
  correlationId: string;
  hotel: {
    hid: string; name: string; address: string; city: string; countryCode: string; stars: number;
    image?: string; checkIn: string; checkOut: string; nights: number;
  };
  occupancy:     RoomOccupancy[];
  nationality:   string;     // ISO2
  currency:      string;
  option:        HotelV3Option;
  onholdAllowed: boolean;
  reviewedAt:    string;
}

export const REVIEW_TTL_SECONDS = 30 * 60;
export const reviewKey = (tenantId: string, bookingId: string) => `hotel_review:${tenantId}:${bookingId}`;

// ── Access keys (guests keep the key; signed-in customers match by user) ─────

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function newAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function canAccess(order: HotelOrder, access: { userId?: string | null; key?: string | null }): Promise<boolean> {
  if (access.userId && order.userId && access.userId === order.userId) return true;
  if (!access.key) return false;
  const hash = await sha256Hex(access.key);
  // Fixed-length hex comparison without early exit.
  let diff = hash.length ^ order.accessKeyHash.length;
  for (let i = 0; i < Math.min(hash.length, order.accessKeyHash.length); i++) diff |= hash.charCodeAt(i) ^ order.accessKeyHash.charCodeAt(i);
  return diff === 0;
}

// ── Order creation ───────────────────────────────────────────────────────────

export function buildOrderRow(input: {
  review: ReviewSnapshot; mode: "INSTANT" | "HOLD"; userId: string | null; guests: HotelGuestInput[][];
  contactEmail: string; contactPhone: string; dialCode: string; accessKeyHash: string;
}): NewHotelOrder {
  const { review } = input;
  return {
    tenantId:          review.tenantId,
    userId:            input.userId,
    supplierBookingId: review.bookingId,
    mode:              input.mode,
    status:            input.mode === "HOLD" ? "PROCESSING" : "PAYMENT_PENDING",
    hotel:             review.hotel,
    occupancy:         review.occupancy,
    guests:            input.guests.map((room) => room.map((g) => ({
      title: g.title, firstName: g.firstName.trim(), lastName: g.lastName.trim(), type: g.type,
      ...(g.pan ? { pan: g.pan.trim().toUpperCase() } : {}), ...(g.passport ? { passport: g.passport.trim().toUpperCase() } : {}),
    }))),
    option:            review.option,
    nationality:       review.nationality,
    amount:            review.option.pricing.totalPrice.toFixed(2),
    currency:          review.currency as NewHotelOrder["currency"],
    contactEmail:      input.contactEmail.trim(),
    contactPhone:      input.contactPhone.replace(/\D/g, "").slice(-10),
    dialCode:          input.dialCode.startsWith("+") ? input.dialCode : `+${input.dialCode}`,
    accessKeyHash:     input.accessKeyHash,
  };
}

export function bookRequest(order: HotelOrder, withPayment: boolean): Parameters<HotelBookingClient["book"]>[0] {
  const guests = order.guests as HotelGuestInput[][];
  return {
    bookingId: order.supplierBookingId,
    roomTravellerInfo: guests.map((room) => ({
      travellerInfo: room.map((g) => ({
        ti: g.title, pt: g.type, fN: g.firstName, lN: g.lastName,
        ...(g.pan ? { pan: g.pan } : {}), ...(g.passport ? { pNum: g.passport } : {}),
      })),
    })),
    deliveryInfo: { emails: [order.contactEmail], contacts: [order.contactPhone], code: [order.dialCode] },
    // Omitting paymentInfos is TripJack's Hold booking.
    ...(withPayment ? { paymentInfos: [{ amount: Number(order.amount) }] } : {}),
  };
}

// Places the TripJack hold for a HOLD order (no payment is taken).
export async function placeHold(deps: HotelOrderDeps, order: HotelOrder): Promise<HotelOrder> {
  const claimed = await deps.store.update(order.id, { supplierSubmittedAt: new Date(deps.now?.() ?? Date.now()) },
    { status: ["PROCESSING"], supplierSubmittedAtNull: true });
  if (!claimed) return (await deps.store.get(order.id)) ?? order;
  return submitAndSettle(deps, claimed, "book", () => deps.client.book(bookRequest(claimed, false)));
}

// ── Supplier status → order ──────────────────────────────────────────────────

const FAILED = ["FAILED", "ABORTED"];

// Definite "TripJack did not accept this" (vs. an unknown outcome such as a timeout).
export function isDefiniteRejection(err: any): boolean {
  const code = String(err?.code ?? "");
  if (code === "NOT_CONFIGURED" || code === "INVALID_BOOKING_ID") return true;   // nothing was sent
  if (["TIMEOUT", "NETWORK_ERROR", "RESPONSE_READ_FAILED", "INVALID_RESPONSE"].includes(code)) return false;
  const status = Number(err?.statusCode);
  return status >= 400 && status < 500;
}

async function details(deps: HotelOrderDeps, order: HotelOrder, reason: string): Promise<HotelDetails | null> {
  try {
    return parseHotelBookingDetails(await deps.call("/oms/v3/hotel/booking-details", { bookingId: order.supplierBookingId, reason },
      () => deps.client.bookingDetails(order.supplierBookingId)));
  } catch {
    return null;
  }
}

async function poll(deps: HotelOrderDeps, order: HotelOrder, maxMs: number): Promise<HotelDetails | null> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const started = now();
  let last: HotelDetails | null = null;
  for (;;) {
    const d = await details(deps, order, "poll");
    if (d?.status) last = d;
    if (last && HOTEL_TERMINAL_STATUSES.includes(last.status)) return last;
    if (now() - started >= maxMs) return last;
    await sleep(5000);
  }
}

function supplierFields(d: HotelDetails): HotelOrderPatch {
  return {
    supplierStatus: d.status || null,
    ...(d.confirmationNo ? { confirmationNo: String(d.confirmationNo) } : {}),
    ...(d.holdDeadline ? { holdDeadline: String(d.holdDeadline) } : {}),
  };
}

// Applies TripJack's Booking Details to the order. Money follows the supplier:
// a paid order that TripJack failed / released is refunded in full.
export async function applySupplierStatus(deps: HotelOrderDeps, order: HotelOrder, d: HotelDetails | null): Promise<HotelOrder> {
  const checked = { lastCheckedAt: new Date(deps.now?.() ?? Date.now()) };
  if (!d?.status) return (await deps.store.update(order.id, checked)) ?? order;
  const s = d.status;
  const cancelling = order.status === "CANCELLATION_PENDING";
  let status = order.status;
  if (s === "SUCCESS") status = cancelling ? status : "CONFIRMED";
  else if (s === "ON_HOLD") status = cancelling ? status : "ON_HOLD";
  else if (s === "CANCELLED") status = "CANCELLED";
  else if (FAILED.includes(s)) status = "FAILED";
  else if (!cancelling && (order.supplierSubmittedAt || order.confirmSubmittedAt)) status = "PROCESSING";

  // A hold that was paid but never confirmed is still a hold.
  if (status === "ON_HOLD" && order.paymentStatus === "PAID" && order.confirmSubmittedAt) status = "PROCESSING";

  let updated = (await deps.store.update(order.id, { ...supplierFields(d), ...checked, status })) ?? order;

  const paid = updated.paymentStatus === "PAID";
  const customerCancelled = Boolean(updated.cancellation);
  const wasConfirmed = order.status === "CONFIRMED" || order.status === "CANCELLATION_PENDING";
  if (paid && (status === "FAILED" || (status === "CANCELLED" && !customerCancelled && !wasConfirmed))) {
    // Paid but never confirmed by TripJack: the whole payment goes back.
    updated = await refundInFull(deps, updated, status === "FAILED"
      ? `TripJack booking ${s}` : "Hold released by the supplier before confirmation");
  } else if (paid && status === "CANCELLED" && !customerCancelled) {
    // A confirmed booking cancelled outside the website (Admin / supplier): the team settles the refund.
    updated = (await deps.store.update(updated.id, {
      paymentStatus: "REFUND_PENDING",
      refundNote: "Cancelled by Tripcod or the supplier. Our team will contact you about the refund.",
    }, { paymentStatus: ["PAID"] })) ?? updated;
  } else if (paid && status === "CANCELLED" && customerCancelled && !updated.refundNote) {
    const refund = Number((updated.cancellation as { refund?: number } | null)?.refund ?? 0);
    updated = (await deps.store.update(updated.id, refund > 0
      ? { paymentStatus: "REFUND_PENDING", refundAmount: refund.toFixed(2),
          refundNote: "Cancelled with the hotel. The refund under the cancellation policy is being processed to the original payment method." }
      : { refundAmount: "0.00", refundNote: "Cancelled with the hotel. No refund applies under the cancellation policy." },
    { paymentStatus: ["PAID"] })) ?? updated;
  }
  return updated;
}

async function refundInFull(deps: HotelOrderDeps, order: HotelOrder, reason: string): Promise<HotelOrder> {
  // Claim the refund so two pollers can't refund twice.
  const claimed = await deps.store.update(order.id, { paymentStatus: "REFUND_PENDING", refundAmount: order.amount, refundNote: reason },
    { paymentStatus: ["PAID"] });
  if (!claimed) return (await deps.store.get(order.id)) ?? order;
  let outcome: { ok: boolean; note: string };
  try { outcome = await deps.refund(claimed, Number(claimed.amount), reason); }
  catch (err) { outcome = { ok: false, note: `Automatic refund failed: ${err instanceof Error ? err.message : String(err)}` }; }
  return (await deps.store.update(claimed.id, outcome.ok
    ? { paymentStatus: "REFUNDED", refundNote: `${reason}. ${outcome.note}` }
    : { refundNote: `${reason}. ${outcome.note}` })) ?? claimed;
}

async function submitAndSettle(deps: HotelOrderDeps, order: HotelOrder, endpoint: "book" | "confirm-book", submit: () => Promise<unknown>): Promise<HotelOrder> {
  try {
    await deps.call(`/oms/v3/hotel/${endpoint}`, {
      bookingId: order.supplierBookingId, mode: order.mode, amount: Number(order.amount), rooms: (order.occupancy as RoomOccupancy[]).length,
    }, submit);
  } catch (err: any) {
    // Even a rejected call is checked against Booking Details before deciding.
    const d = await details(deps, order, `${endpoint} error`);
    if (d?.status && (d.status !== "ON_HOLD" || endpoint === "book")) return applySupplierStatus(deps, order, d);
    if (!isDefiniteRejection(err)) {
      // Unknown outcome: never re-submit; Booking Details decides later.
      return (await deps.store.update(order.id, { status: "PROCESSING", lastError: String(err?.message ?? err).slice(0, 500) })) ?? order;
    }
    const message = String(err?.message ?? err).slice(0, 500);
    if (endpoint === "confirm-book") {
      // TripJack refused to confirm: the hold stays (if it still exists) and the payment goes back.
      const back = (await deps.store.update(order.id, { status: d?.status === "ON_HOLD" ? "ON_HOLD" : "FAILED", lastError: message, confirmSubmittedAt: null })) ?? order;
      return back.paymentStatus === "PAID" ? refundInFull(deps, back, "TripJack could not confirm the held booking") : back;
    }
    const failed = (await deps.store.update(order.id, { status: "FAILED", lastError: message })) ?? order;
    if (failed.paymentStatus === "PAID") return refundInFull(deps, failed, "TripJack rejected the booking");
    throw Object.assign(err instanceof Error ? err : new Error(message), { order: failed });
  }
  return applySupplierStatus(deps, order, await poll(deps, order, deps.pollMs ?? 25_000));
}

// ── Payment ──────────────────────────────────────────────────────────────────

export function payable(order: HotelOrder, now = Date.now()): { ok: true } | { ok: false; reason: string; code: string } {
  if (["PAID", "REFUND_PENDING"].includes(order.paymentStatus)) return { ok: false, reason: "This booking is already paid.", code: "ALREADY_PAID" };
  if (order.mode === "INSTANT" && order.status !== "PAYMENT_PENDING") return { ok: false, reason: `This booking is ${order.status.toLowerCase().replace(/_/g, " ")}.`, code: "NOT_PAYABLE" };
  if (order.mode === "HOLD") {
    if (order.status !== "ON_HOLD" || order.supplierStatus !== "ON_HOLD") return { ok: false, reason: "Only a booking that TripJack still holds can be paid and confirmed.", code: "NOT_ON_HOLD" };
    if (order.holdDeadline && deadlinePassed(order.holdDeadline, now)) return { ok: false, reason: "The hold deadline has passed. The hotel releases this room automatically.", code: "HOLD_EXPIRED" };
  }
  return { ok: true };
}

export function deadlinePassed(deadline: string, now = Date.now()): boolean {
  const t = /[zZ]|[+-]\d\d:?\d\d$/.test(deadline) ? Date.parse(deadline) : Date.parse(`${deadline}+05:30`);
  return Number.isFinite(t) && t <= now;
}

// Claims the single payment slot: UNPAID / REFUNDED → PENDING for this gateway.
export async function claimPayment(store: HotelOrderStore, order: HotelOrder, gateway: "NOMOD" | "WALLET", paymentOrderId: string | null) {
  return store.update(order.id, {
    paymentStatus: "PENDING", paymentGateway: gateway, paymentOrderId, paymentRef: null, paymentUrl: null, refundAmount: null, refundNote: null,
  }, { paymentStatus: ["UNPAID", "REFUNDED"] });
}

export async function releasePayment(store: HotelOrderStore, order: HotelOrder) {
  return store.update(order.id, { paymentStatus: "UNPAID", paymentGateway: null, paymentOrderId: null, paymentUrl: null }, { paymentStatus: ["PENDING"] });
}

// Payment captured (Nomod webhook / wallet debit): mark PAID once, then queue the supplier step.
export async function recordPaid(deps: Pick<HotelOrderDeps, "store" | "enqueue" | "now">, order: HotelOrder, paymentRef: string): Promise<HotelOrder | null> {
  const paid = await deps.store.update(order.id, {
    paymentStatus: "PAID", paymentRef, paidAt: new Date(deps.now?.() ?? Date.now()), paymentUrl: null,
  }, { paymentStatus: ["PENDING"] });
  if (paid) await deps.enqueue(paid.id);
  return paid;
}

// Sends a paid order to TripJack: book (instant) or confirm-book (hold). Safe to
// call repeatedly (queue retries, recovery): only the first call submits.
export async function processPaidOrder(deps: HotelOrderDeps, orderId: string): Promise<HotelOrder | null> {
  const order = await deps.store.get(orderId);
  if (!order || order.paymentStatus !== "PAID") return order;
  const now = new Date(deps.now?.() ?? Date.now());

  if (order.mode === "INSTANT") {
    const claimed = await deps.store.update(order.id, { status: "PROCESSING", supplierSubmittedAt: now },
      { status: ["PAYMENT_PENDING"], paymentStatus: ["PAID"], supplierSubmittedAtNull: true });
    if (!claimed) return refreshOrder(deps, order, true);
    return submitAndSettle(deps, claimed, "book", () => deps.client.book(bookRequest(claimed, true)));
  }

  // HOLD: confirm only what TripJack still holds.
  if (order.confirmSubmittedAt) return refreshOrder(deps, order, true);
  const d = await details(deps, order, "pre-confirm check");
  if (d?.status && d.status !== "ON_HOLD") return applySupplierStatus(deps, order, d);
  const claimed = await deps.store.update(order.id, { status: "PROCESSING", confirmSubmittedAt: now },
    { status: ["ON_HOLD"], paymentStatus: ["PAID"], confirmSubmittedAtNull: true });
  if (!claimed) return deps.store.get(order.id);
  return submitAndSettle(deps, claimed, "confirm-book", () => deps.client.confirmBook(claimed.supplierBookingId, Number(claimed.amount)));
}

// ── Refresh (customer page polling / recovery) ───────────────────────────────

const SETTLED = ["CONFIRMED", "FAILED", "CANCELLED", "PAYMENT_PENDING"];

// A wallet payment is two writes in two databases: claim in D1 (with the debit
// ref), debit in Neon, then PAID in D1. If the last step never happened, the
// Neon ledger decides: debited → PAID (and booked); not debited → slot released.
export async function reconcileWalletPayment(deps: HotelOrderDeps, order: HotelOrder): Promise<HotelOrder> {
  const now = deps.now?.() ?? Date.now();
  if (order.paymentStatus !== "PENDING" || order.paymentGateway !== "WALLET" || !order.paymentOrderId || !deps.walletDebited) return order;
  if (now - order.updatedAt.getTime() < 60_000) return order;   // the paying request may still be running
  if (await deps.walletDebited(order.paymentOrderId)) return (await recordPaid(deps, order, order.paymentOrderId)) ?? order;
  return (await releasePayment(deps.store, order)) ?? order;
}

export async function refreshOrder(deps: HotelOrderDeps, order: HotelOrder, force = false): Promise<HotelOrder> {
  order = await reconcileWalletPayment(deps, order);
  const now = deps.now?.() ?? Date.now();
  // Paid but never sent (queue message lost): recover after a minute.
  if (order.paymentStatus === "PAID" && order.paidAt && now - order.paidAt.getTime() > 60_000
      && ((order.mode === "INSTANT" && !order.supplierSubmittedAt) || (order.mode === "HOLD" && order.status === "ON_HOLD" && !order.confirmSubmittedAt))) {
    await deps.enqueue(order.id);
  }
  if (!order.supplierSubmittedAt) return order;              // nothing at TripJack yet
  // A confirmed booking is re-read only on demand; holds and in-flight orders every 20 s.
  if (!force && (SETTLED.includes(order.status) || (order.lastCheckedAt && now - order.lastCheckedAt.getTime() < 20_000))) return order;
  return applySupplierStatus(deps, order, await details(deps, order, "refresh"));
}

// ── Cancellation ─────────────────────────────────────────────────────────────

export function cancelQuote(order: HotelOrder, now = Date.now()) {
  const eligible = ["CONFIRMED", "ON_HOLD"].includes(order.status);
  const paid = order.paymentStatus === "PAID";
  const amount = Number(order.amount);
  const opt = order.option as HotelV3Option;
  // Releasing an unpaid hold costs nothing; a booking follows the supplier's penalty windows.
  const policy = cancellationChargeAt(opt.cancellation, amount, now);
  const quote = order.status === "ON_HOLD" && !paid ? { charge: 0, refund: 0, basis: "UNPAID_HOLD" as string }
    : { charge: policy.charge, refund: paid ? policy.refund : 0, basis: policy.basis as string };
  return {
    eligible, reason: eligible ? null : `A ${order.status.toLowerCase().replace(/_/g, " ")} booking can't be cancelled here.`,
    paid, amount, currency: order.currency, charge: quote.charge, refund: quote.refund, basis: quote.basis,
    penalties: opt.cancellation.penalties, isRefundable: opt.cancellation.isRefundable,
  };
}

export async function cancelOrder(deps: HotelOrderDeps, order: HotelOrder, expectedCharge: number): Promise<HotelOrder> {
  const now = deps.now?.() ?? Date.now();
  const quote = cancelQuote(order, now);
  if (!quote.eligible) throw new HotelOrderError(quote.reason ?? "Not cancellable", 409, "NOT_CANCELLABLE");
  if (Math.abs(quote.charge - expectedCharge) > 0.01) {
    throw new HotelOrderError("The cancellation charge has changed. Please review it and confirm again.", 409, "CHARGE_CHANGED", { quote });
  }
  // One cancellation request at a time.
  const claimed = await deps.store.update(order.id, {
    status: "CANCELLATION_PENDING",
    cancellation: { requestedAt: new Date(now).toISOString(), charge: quote.charge, refund: quote.refund, basis: quote.basis, previousStatus: order.status },
  }, { status: [order.status] });
  if (!claimed) throw new HotelOrderError("This booking changed while you were cancelling. Please reload.", 409, "STATE_CHANGED");
  try {
    await deps.call("/oms/v3/hotel/cancel-booking", { bookingId: order.supplierBookingId, previousStatus: order.status, charge: quote.charge },
      () => deps.client.cancel(order.supplierBookingId));
  } catch (err: any) {
    const d = await details(deps, claimed, "cancel error");
    if (d?.status === "CANCELLED") return applySupplierStatus(deps, claimed, d);
    if (isDefiniteRejection(err)) {
      // TripJack refused: nothing changed at the hotel.
      await deps.store.update(order.id, { status: order.status, cancellation: null, lastError: String(err?.message ?? err).slice(0, 500) });
      throw new HotelOrderError(`The hotel supplier did not accept the cancellation: ${err?.message ?? err}`, 502, "CANCEL_REJECTED");
    }
    return (await deps.store.update(order.id, { lastError: String(err?.message ?? err).slice(0, 500) })) ?? claimed;
  }
  // Status changes only on TripJack's word.
  return applySupplierStatus(deps, claimed, await poll(deps, claimed, Math.min(deps.pollMs ?? 25_000, 15_000)));
}

// ── Browser view ─────────────────────────────────────────────────────────────

export const STATUS_TEXT: Record<string, string> = {
  PAYMENT_PENDING:      "Awaiting payment",
  ON_HOLD:              "On hold — not confirmed",
  PROCESSING:           "Confirming with the hotel",
  CONFIRMED:            "Confirmed",
  FAILED:               "Booking failed",
  CANCELLATION_PENDING: "Cancellation requested",
  CANCELLED:            "Cancelled",
};

export function publicOrder(order: HotelOrder, now = Date.now()) {
  const pay = payable(order, now);
  const quote = cancelQuote(order, now);
  return {
    id:                order.id,
    supplierBookingId: order.supplierBookingId,
    mode:              order.mode,
    status:            order.status,
    statusText:        STATUS_TEXT[order.status] ?? order.status,
    supplierStatus:    order.supplierStatus,
    confirmationNo:    order.confirmationNo,
    holdDeadline:      order.holdDeadline,
    holdExpired:       order.mode === "HOLD" && order.status === "ON_HOLD" && Boolean(order.holdDeadline && deadlinePassed(order.holdDeadline, now)),
    hotel:             order.hotel,
    occupancy:         order.occupancy,
    guests:            order.guests,
    option:            order.option,
    nationality:       order.nationality,
    amount:            Number(order.amount),
    currency:          order.currency,
    contactEmail:      order.contactEmail,
    payment: {
      status: order.paymentStatus, gateway: order.paymentGateway, paidAt: order.paidAt,
      refundAmount: order.refundAmount === null ? null : Number(order.refundAmount), refundNote: order.refundNote,
      payable: pay.ok, payableReason: pay.ok ? null : pay.reason,
    },
    cancellation:      order.cancellation,
    canCancel:         quote.eligible,
    pending:           order.status === "PROCESSING" || order.status === "CANCELLATION_PENDING",
    createdAt:         order.createdAt,
  };
}
