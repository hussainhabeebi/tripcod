-- Cloudflare D1 (SQLite): website hotel orders on TripJack Hotel API v3.
-- Instant / hold bookings, payment references, cancellation records.
-- tenant_id and user_id hold Neon ids (tenants.id / users.id) as plain text —
-- D1 cannot reference Neon, so there are no foreign keys across databases.
-- JSON columns are TEXT (JSON), timestamps ISO-8601 TEXT (UTC), money decimal TEXT.
CREATE TABLE IF NOT EXISTS hotel_bookings (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  user_id               TEXT,
  supplier_booking_id   TEXT NOT NULL,
  mode                  TEXT NOT NULL CHECK (mode IN ('INSTANT', 'HOLD')),
  status                TEXT NOT NULL,          -- PAYMENT_PENDING | ON_HOLD | PROCESSING | CONFIRMED | FAILED | CANCELLATION_PENDING | CANCELLED
  supplier_status       TEXT,
  confirmation_no       TEXT,
  hold_deadline         TEXT,
  hotel                 TEXT NOT NULL CHECK (json_valid(hotel)),
  occupancy             TEXT NOT NULL CHECK (json_valid(occupancy)),
  guests                TEXT NOT NULL CHECK (json_valid(guests)),
  option                TEXT NOT NULL CHECK (json_valid(option)),
  nationality           TEXT NOT NULL,
  amount                TEXT NOT NULL,
  currency              TEXT NOT NULL CHECK (currency IN ('INR', 'AED', 'USD')),
  contact_email         TEXT NOT NULL,
  contact_phone         TEXT NOT NULL,
  dial_code             TEXT NOT NULL,
  payment_status        TEXT NOT NULL DEFAULT 'UNPAID',   -- UNPAID | PENDING | PAID | REFUND_PENDING | REFUNDED
  payment_gateway       TEXT,                             -- NOMOD | WALLET
  payment_order_id      TEXT,                             -- Nomod link id / wallet debit ref (Neon wallet_transactions.payment_id)
  payment_ref           TEXT,                             -- Nomod charge id
  payment_url           TEXT,
  paid_at               TEXT,
  refund_amount         TEXT,
  refund_note           TEXT,
  supplier_submitted_at TEXT,
  confirm_submitted_at  TEXT,
  cancellation          TEXT CHECK (cancellation IS NULL OR json_valid(cancellation)),
  access_key_hash       TEXT NOT NULL,
  last_error            TEXT,
  last_checked_at       TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_tenant_supplier_idx ON hotel_bookings (tenant_id, supplier_booking_id);
CREATE UNIQUE INDEX IF NOT EXISTS hotel_bookings_payment_order_idx ON hotel_bookings (payment_order_id);
CREATE INDEX IF NOT EXISTS hotel_bookings_user_idx ON hotel_bookings (tenant_id, user_id, created_at);
