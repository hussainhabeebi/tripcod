-- TripJack Hotel API v3 website bookings (instant / hold, payment, cancellation).
-- Additive only: a new table, no change to existing tables or data.
-- Idempotent (applied on every deploy).
CREATE TABLE IF NOT EXISTS hotel_bookings (
  id                    text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id             text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id               text REFERENCES users(id) ON DELETE SET NULL,
  supplier_booking_id   text NOT NULL,
  mode                  text NOT NULL,              -- INSTANT | HOLD
  status                text NOT NULL,              -- PAYMENT_PENDING | ON_HOLD | PROCESSING | CONFIRMED | FAILED | CANCELLATION_PENDING | CANCELLED
  supplier_status       text,
  confirmation_no       text,
  hold_deadline         text,
  hotel                 jsonb NOT NULL,
  occupancy             jsonb NOT NULL,
  guests                jsonb NOT NULL,
  option                jsonb NOT NULL,
  nationality           text NOT NULL,
  amount                numeric(14,2) NOT NULL,
  currency              currency NOT NULL,
  contact_email         text NOT NULL,
  contact_phone         text NOT NULL,
  dial_code             text NOT NULL,
  payment_status        text NOT NULL DEFAULT 'UNPAID', -- UNPAID | PENDING | PAID | REFUND_PENDING | REFUNDED
  payment_gateway       text,
  payment_order_id      text,
  payment_ref           text,
  payment_url           text,
  paid_at               timestamptz,
  refund_amount         numeric(14,2),
  refund_note           text,
  supplier_submitted_at timestamptz,
  confirm_submitted_at  timestamptz,
  cancellation          jsonb,
  access_key_hash       text NOT NULL,
  last_error            text,
  last_checked_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_tenant_supplier_idx ON hotel_bookings (tenant_id, supplier_booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_payment_order_idx ON hotel_bookings (payment_order_id);
CREATE INDEX IF NOT EXISTS hotel_bookings_user_idx ON hotel_bookings (user_id, created_at);
