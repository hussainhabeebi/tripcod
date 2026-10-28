import { pgTable, text, decimal, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenant.js";
import { users } from "./user.js";
import { currencyEnum } from "./enums.js";

// TripJack Hotel API v3 bookings made on the website. Kept apart from the
// flight-shaped `bookings` table so flight payment / recovery code never sees them.
//
// status (Tripcod view, always derived from the supplier where it matters):
//   PAYMENT_PENDING  instant booking waiting for the customer's payment
//   ON_HOLD          TripJack confirmed the hold (ON_HOLD) — not confirmed, not paid
//   PROCESSING       payment captured; TripJack book / confirm-book submitted or about to be
//   CONFIRMED        TripJack booking status SUCCESS
//   FAILED           TripJack FAILED / ABORTED (any payment is refunded)
//   CANCELLATION_PENDING  cancel accepted by TripJack, status not yet CANCELLED
//   CANCELLED        TripJack status CANCELLED (customer cancel or expired hold)
export const hotelBookings = pgTable("hotel_bookings", {
  id:       text("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: text("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId:   text("user_id").references(() => users.id, { onDelete: "set null" }),

  // TripJack bookingId from Review — one Tripcod order per TripJack booking.
  supplierBookingId: text("supplier_booking_id").notNull(),
  mode:              text("mode").notNull(),                       // INSTANT | HOLD
  status:            text("status").notNull(),
  supplierStatus:    text("supplier_status"),                      // raw order.status from Booking Details
  confirmationNo:    text("confirmation_no"),
  holdDeadline:      text("hold_deadline"),                        // supplier ddt (IST wall clock)

  hotel:      jsonb("hotel").notNull(),       // hid, name, address, city, countryCode, stars, checkIn/out, nights
  occupancy:  jsonb("occupancy").notNull(),   // [{ adults, childAges }]
  guests:     jsonb("guests").notNull(),      // per room, lead guest first
  option:     jsonb("option").notNull(),      // reviewed TripJack option (pricing, cancellation, compliance)
  nationality: text("nationality").notNull(),

  amount:   decimal("amount", { precision: 14, scale: 2 }).notNull(),
  currency: currencyEnum("currency").notNull(),

  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  dialCode:     text("dial_code").notNull(),

  // Payment (one successful payment per booking)
  paymentStatus:  text("payment_status").notNull().default("UNPAID"),  // UNPAID | PENDING | PAID | REFUND_PENDING | REFUNDED
  paymentGateway: text("payment_gateway"),                              // NOMOD | WALLET
  paymentOrderId: text("payment_order_id"),                             // Nomod link id / wallet ref
  paymentRef:     text("payment_ref"),                                  // Nomod charge id
  paymentUrl:     text("payment_url"),                                  // open Nomod link, reused until paid / failed
  paidAt:         timestamp("paid_at", { withTimezone: true }),
  refundAmount:   decimal("refund_amount", { precision: 14, scale: 2 }),
  refundNote:     text("refund_note"),

  // Set once, atomically, before the paid booking is sent to TripJack.
  supplierSubmittedAt: timestamp("supplier_submitted_at", { withTimezone: true }),
  // Set once, atomically, before a paid hold is sent to TripJack confirm-book.
  confirmSubmittedAt:  timestamp("confirm_submitted_at", { withTimezone: true }),

  cancellation: jsonb("cancellation"),   // { requestedAt, charge, refund, basis, supplierResponse }
  accessKeyHash: text("access_key_hash").notNull(),
  lastError:     text("last_error"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  supplierIdx: uniqueIndex("hotel_bookings_tenant_supplier_idx").on(t.tenantId, t.supplierBookingId),
  paymentIdx:  uniqueIndex("hotel_bookings_payment_order_idx").on(t.paymentOrderId),
  userIdx:     index("hotel_bookings_user_idx").on(t.userId, t.createdAt),
}));
