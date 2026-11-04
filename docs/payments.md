# Payments: Nomod and PhonePe for Flights and Hotels

## How a payment becomes a booking

### Flights (Neon `bookings` / `payments`)

1. **Checkout** (`POST /api/payments/checkout`, `gateway: NOMOD | PHONEPE`) prices from the server-side booking row.
   - If the booking is already paid, it returns 409.
   - A second click within 15 minutes gets the same open checkout back.
   - PhonePe takes INR only. Nomod can also charge AED at the Admin rate.
2. **Confirmation**
   - Nomod: the Svix-signed webhook `charge.completed` at `/webhooks/nomod`.
   - PhonePe: the webhook at `/webhooks/phonepe` (Authorization = SHA256(username:password)) only triggers a
     server-to-server **order status** call. The return page (`GET /api/payments/:bookingId`) does the same check.
     A webhook payload is never trusted for money.
3. **Capture** (`lib/payment-core.ts`) checks the amount and currency. PhonePe is checked exactly, in paise.
   For Nomod only under-payment or a different currency blocks the capture. The row is then claimed once.
   - Booking already paid: this charge is a duplicate and is refunded. A partial unique index also allows only
     one captured card/UPI payment per booking.
   - Booking cancelled or failed: this is a late payment and is refunded.
   - Otherwise the existing `PAYMENT_CAPTURED` queue flow tickets the booking.
   - If the queue send fails, the capture is undone so the gateway's webhook retry captures it again.
4. **Refunds** go through the original gateway, one in flight per payment:
   - automatic when ticketing fails;
   - on cancellations (`settleRefund`, now also PhonePe);
   - manually from Admin → Transactions (full or partial).
   PhonePe refunds settle through `pg.refund.*` webhooks and only use the credentials of the environment
   the charge was taken in (`payments.environment`).

### Hotels (Cloudflare D1 `hotel_bookings`, see docs/hotels/booking-uat.md)

The existing pay-first order flow is unchanged. PhonePe is added as the **UPI** method
(`POST /api/hotels/orders/:id/pay {"method":"UPI"}`):
- It takes the order's single atomic payment slot. An open PhonePe page is reused.
- The payment is marked PAID only when PhonePe's status API reports the exact amount. That check runs on the
  webhook and on every order read. A failed or expired PhonePe order frees the slot.
- TripJack is then booked once from the queue (existing flow). If TripJack fails, the payment is refunded through PhonePe.
- The merchant order id carries the environment (`TCHU_…` UAT, `TCHP_…` Production), so refunds never cross environments.
- Nomod hotel captures now also refuse under-payment or a different currency.

Every step of both products is written to the Neon `payment_events` ledger. Hotel rows use the D1 order id as
the reference. Admin → **Transactions** shows flight payments, the ledger (alerts in red), hotel orders with
their payment state, and the refund and re-check actions.

## Configuration

| What | Where |
| --- | --- |
| Nomod API key, AED rate, Tabby/Tamara | Admin → Settings → Payments (existing) |
| `NOMOD_WEBHOOK_SECRET` (`whsec_…`) | Worker secret; Nomod webhook URL `https://api.tripcod.com/webhooks/nomod` |
| PhonePe on/off | Admin → Settings → Payments → *Enable PhonePe* (stays off until all secrets below exist) |
| `PHONEPE_ENV` | Worker var/secret: `UAT` (default) or `PRODUCTION` |
| `PHONEPE_UAT_CLIENT_ID / _CLIENT_SECRET / _CLIENT_VERSION` | PhonePe UAT (sandbox) dashboard |
| `PHONEPE_UAT_WEBHOOK_USERNAME / _WEBHOOK_PASSWORD` | The webhook user you create on the PhonePe UAT dashboard |
| `PHONEPE_PROD_*` (same five) | PhonePe production dashboard, only after UAT sign-off |
| `PUBLIC_WEB_URL` (optional) | Customer site for return URLs; defaults to `https://tripcod.com` |

UAT and Production are separate:
- Production credentials are used only when the Worker has `ENVIRONMENT=production` **and** `PHONEPE_ENV=PRODUCTION`.
- There is never a fallback from one environment's credentials to the other's.
- A charge remembers its environment, so it is only ever refunded with the same credentials.
- PhonePe hosts: UAT `api-preprod.phonepe.com/apis/pg-sandbox`; Production `api.phonepe.com/apis/identity-manager`
  (token) and `api.phonepe.com/apis/pg`.

## Go-live checklist

1. Apply the Neon migration `0012_payment_gateways.sql` (additive, idempotent; the deploy workflow applies it).
   Hotel orders also need the D1 migration (docs/hotels/booking-uat.md).
2. Set the `PHONEPE_UAT_*` secrets and leave `PHONEPE_ENV` unset. Register the UAT webhook
   `https://api.tripcod.com/webhooks/phonepe` with the same username and password.
3. Admin → Settings → Payments: enable PhonePe. The checkout labels it "test mode" while on UAT.
   Run the sandbox flows and watch Admin → Transactions:
   - flight: success, failure, refund;
   - hotel (UPI): instant booking, hold + pay, refund after a TripJack failure.
4. Set the `PHONEPE_PROD_*` secrets and `PHONEPE_ENV=PRODUCTION`, then register the production webhook.
5. Nomod: confirm the first live `charge.completed` in the ledger shows `CAPTURED`, not `AMOUNT_MISMATCH`.

## Tests

- `apps/api/test/phonepe.test.ts`: PG v2 client, environment separation, webhook auth.
- `apps/api/test/hotel-orders.test.ts` (also runs on D1 through `hotel-orders-d1.test.ts`): hotel UPI scenarios.
- `apps/api/test/payments-integration.test.ts`: end-to-end flight flows on a real Postgres, with gateways mocked. Run with `TEST_DATABASE_URL=… TEST_PG_MODULE=<path to pg> tsx --test test/payments-integration.test.ts`.
