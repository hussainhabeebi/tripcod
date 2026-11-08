-- PhonePe PG v2 next to Nomod, duplicate-charge guards and the Admin payment
-- ledger. Idempotent and additive (applied on every deploy); existing payment
-- rows are untouched. Hotel orders stay in D1 (apps/api/d1-migrations).
ALTER TYPE payment_gateway ADD VALUE IF NOT EXISTS 'PHONEPE';

ALTER TABLE payments ADD COLUMN IF NOT EXISTS environment text;   -- UAT | PRODUCTION (PhonePe)
-- One payments row per gateway order (a retried checkout can never create a twin).
CREATE UNIQUE INDEX IF NOT EXISTS payments_gateway_order_idx ON payments (gateway, gateway_order_id);
-- At most one captured card/UPI payment per booking: a second capture (two
-- tabs, an old link paid late) fails here and is refunded as a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_capture_per_booking_idx ON payments (booking_id)
  WHERE status = 'SUCCESS' AND gateway IN ('NOMOD', 'PHONEPE', 'RAZORPAY');
CREATE TABLE IF NOT EXISTS payment_events (
  id           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id    text,
  payment_id   text,
  product      text NOT NULL,
  reference_id text,
  gateway      payment_gateway NOT NULL,
  environment  text,
  event        text NOT NULL,
  status       text,
  amount       numeric(14, 2),
  currency     text,
  gateway_ref  text,
  message      text,
  raw          jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payment_events_created_idx ON payment_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_events_payment_idx ON payment_events (payment_id);
