// TripJack Hotel API v3 — room occupancy, guest and cancellation rules shared
// by the API (request validation) and the website (search form / checkout).
//
// Occupancy is sent room by room: rooms: [{ adults, children, childAge: [...] }].
// Every child needs an age; childAge.length must equal children.

import type { HotelV3Penalty, HotelV3Room } from "./hotel-v3.js";

// Same bounds the /api/hotels schema has always enforced for TripJack.
export const HOTEL_OCCUPANCY_LIMITS = {
  maxRooms:           9,
  minAdultsPerRoom:   1,
  maxAdultsPerRoom:   9,
  maxChildrenPerRoom: 4,
  minChildAge:        0,
  maxChildAge:        17,
} as const;

export interface RoomOccupancy { adults: number; childAges: number[] }

const L = HOTEL_OCCUPANCY_LIMITS;
const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

// Returns readable problems; empty means TripJack-valid.
export function occupancyErrors(rooms: RoomOccupancy[]): string[] {
  const errors: string[] = [];
  if (!Array.isArray(rooms) || rooms.length < 1) return ["Add at least one room."];
  if (rooms.length > L.maxRooms) errors.push(`A booking can have at most ${L.maxRooms} rooms.`);
  rooms.forEach((r, i) => {
    const n = `Room ${i + 1}`;
    if (!isInt(r?.adults) || r.adults < L.minAdultsPerRoom) errors.push(`${n} needs at least ${L.minAdultsPerRoom} adult.`);
    else if (r.adults > L.maxAdultsPerRoom) errors.push(`${n} can have at most ${L.maxAdultsPerRoom} adults.`);
    const ages = Array.isArray(r?.childAges) ? r.childAges : [];
    if (ages.length > L.maxChildrenPerRoom) errors.push(`${n} can have at most ${L.maxChildrenPerRoom} children.`);
    ages.forEach((a, j) => {
      if (!isInt(a) || a < L.minChildAge || a > L.maxChildAge) {
        errors.push(`${n}: child ${j + 1} needs an age between ${L.minChildAge} and ${L.maxChildAge}.`);
      }
    });
  });
  return errors;
}

export function toTripjackRooms(rooms: RoomOccupancy[]): HotelV3Room[] {
  return rooms.map((r) => r.childAges.length
    ? { adults: r.adults, children: r.childAges.length, childAge: [...r.childAges] }
    : { adults: r.adults });
}

// URL form used by the website: rooms separated by "-", each room is
// "<adults>" followed by "_<childAge>" per child.  "2_5_8-3-2_1" =
// room 1: 2 adults + children aged 5 and 8; room 2: 3 adults; room 3: 2 adults + child aged 1.
export function encodeOccupancy(rooms: RoomOccupancy[]): string {
  return rooms.map((r) => [r.adults, ...r.childAges].join("_")).join("-");
}

export function decodeOccupancy(value: string | null | undefined): RoomOccupancy[] | null {
  if (!value || !/^\d+(_\d+)*(-\d+(_\d+)*)*$/.test(value)) return null;
  const rooms = value.split("-").map((room) => {
    const [adults, ...ages] = room.split("_").map(Number);
    return { adults, childAges: ages };
  });
  return occupancyErrors(rooms).length ? null : rooms;
}

export function occupancyTotals(rooms: RoomOccupancy[]) {
  return {
    rooms:    rooms.length,
    adults:   rooms.reduce((n, r) => n + r.adults, 0),
    children: rooms.reduce((n, r) => n + r.childAges.length, 0),
  };
}

export function describeRoom(r: RoomOccupancy): string {
  const a = `${r.adults} adult${r.adults === 1 ? "" : "s"}`;
  if (!r.childAges.length) return a;
  return `${a}, ${r.childAges.length} child${r.childAges.length === 1 ? "" : "ren"} (age ${r.childAges.join(", ")})`;
}

// ── Guests ───────────────────────────────────────────────────────────────────

export interface HotelGuestInput {
  title:     string;
  firstName: string;
  lastName:  string;
  type:      "ADULT" | "CHILD";
  pan?:      string;
  passport?: string;
}

export const PAN_PATTERN = /^[A-Z]{5}\d{4}[A-Z]$/;
const ADULT_TITLES = ["Mr", "Ms", "Mrs", "Miss"];
const CHILD_TITLES = ["Master", "Miss"];
export const guestTitles = (type: "ADULT" | "CHILD") => type === "CHILD" ? CHILD_TITLES : ADULT_TITLES;

export interface GuestRules {
  nationality:       string;    // ISO2 of the guests
  hotelCountryCode?: string;    // ISO2 of the hotel ("" when unknown)
  panRequired:       boolean;   // option.compliance.panRequired from Review
  passportRequired:  boolean;   // option.compliance.passportRequired from Review
}

// PAN applies to Indian guests only: when TripJack's Review says the option
// needs it, and for hotels outside India (TCS on overseas stays).
export function leadPanRequired(rules: GuestRules): boolean {
  const indian = rules.nationality.toUpperCase() === "IN";
  const overseas = Boolean(rules.hotelCountryCode && rules.hotelCountryCode.toUpperCase() !== "IN");
  return indian && (rules.panRequired || overseas);
}

// Guests must match the reviewed occupancy room by room: one entry per adult
// (lead guest first) and per child, in that order.
export function guestErrors(rooms: RoomOccupancy[], guests: HotelGuestInput[][], rules: GuestRules): string[] {
  const errors: string[] = [];
  if (guests.length !== rooms.length) return [`Guest details are needed for ${rooms.length} room${rooms.length === 1 ? "" : "s"}.`];
  const panLead = leadPanRequired(rules);
  rooms.forEach((room, i) => {
    const list = guests[i] ?? [];
    const adults = list.filter((g) => g.type === "ADULT");
    const children = list.filter((g) => g.type === "CHILD");
    const n = `Room ${i + 1}`;
    if (adults.length !== room.adults || children.length !== room.childAges.length) {
      errors.push(`${n} needs ${describeRoom(room)} — got ${adults.length} adult(s) and ${children.length} child(ren).`);
      return;
    }
    if (list[0]?.type !== "ADULT") errors.push(`${n}: the first guest must be an adult (lead guest).`);
    list.forEach((g, j) => {
      const who = `${n}, guest ${j + 1}`;
      if (!g.firstName?.trim() || !g.lastName?.trim()) errors.push(`${who}: first and last name are required.`);
      if (!guestTitles(g.type).includes(g.title)) errors.push(`${who}: title must be one of ${guestTitles(g.type).join(", ")}.`);
      const pan = g.pan?.trim().toUpperCase();
      if (pan && !PAN_PATTERN.test(pan)) errors.push(`${who}: PAN must look like ABCDE1234F.`);
      if (rules.passportRequired && !(g.passport && g.passport.trim().length >= 5)) errors.push(`${who}: passport number is required by this hotel.`);
    });
    if (i === 0 && panLead && !list[0]?.pan?.trim()) errors.push("The lead guest's PAN is required for this booking.");
  });
  return errors;
}

// ── Cancellation ─────────────────────────────────────────────────────────────

// TripJack penalties are IST wall-clock times without an offset.
export function penaltyTime(value: string): number {
  if (!value) return NaN;
  return /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? Date.parse(value) : Date.parse(`${value}+05:30`);
}

// The charge that applies if the booking is cancelled at `now`, from the
// supplier's own penalty windows. Non-refundable → the full amount. Outside every
// window: before the first one is free, after the last one is the full amount.
export function cancellationChargeAt(
  policy: { isRefundable: boolean; penalties: HotelV3Penalty[] }, total: number, now = Date.now(),
): { charge: number; refund: number; window: HotelV3Penalty | null; basis: "POLICY_WINDOW" | "BEFORE_PENALTIES" | "AFTER_PENALTIES" | "NON_REFUNDABLE" | "NO_POLICY" } {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (!policy.isRefundable && !policy.penalties.length) return { charge: round(total), refund: 0, window: null, basis: "NON_REFUNDABLE" };
  const windows = policy.penalties
    .map((p) => ({ p, from: penaltyTime(p.from), to: penaltyTime(p.to) }))
    .filter((w) => Number.isFinite(w.from) && Number.isFinite(w.to))
    .sort((a, b) => a.from - b.from);
  if (!windows.length) {
    return policy.isRefundable ? { charge: 0, refund: round(total), window: null, basis: "NO_POLICY" }
      : { charge: round(total), refund: 0, window: null, basis: "NON_REFUNDABLE" };
  }
  const hit = windows.find((w) => now >= w.from && now <= w.to);
  if (hit) {
    const charge = Math.min(total, Math.max(0, hit.p.amount));
    return { charge: round(charge), refund: round(total - charge), window: hit.p, basis: "POLICY_WINDOW" };
  }
  if (now < windows[0].from) return { charge: 0, refund: round(total), window: null, basis: "BEFORE_PENALTIES" };
  return { charge: round(total), refund: 0, window: null, basis: "AFTER_PENALTIES" };
}

// Free-cancellation deadline: end of the last zero-charge window, else the
// supplier's deadlineDateTime.
export function freeCancellationUntil(policy: { penalties: HotelV3Penalty[]; deadlineDateTime?: string }): string | null {
  const free = policy.penalties.filter((p) => p.amount <= 0).map((p) => p.to).filter(Boolean);
  return free.sort((a, b) => penaltyTime(b) - penaltyTime(a))[0] ?? policy.deadlineDateTime ?? null;
}
