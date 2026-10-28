# Hotel booking — TripJack Hotel API v3 UAT readiness

Flow: **Search (room-wise guests) → Results → Room selection → Checkout (guests, policy, Instant / Hold, payment) → Booking details (status, pay / confirm hold, cancel) → My Trips**.

## What changed

| Area | Change |
| --- | --- |
| Search | Rooms & guests picker: per-room adults (1–9), children (0–4) with an age (0–17) for every child, up to 9 rooms. URL `occ=2_4_9-3_7-2_1`; older `rooms`/`adults` links still work. Sent to TripJack as `rooms: [{ adults, children, childAge }]`. API rejects a child without an age. |
| Room selection | New `/hotels/hotel` page: every `/hms/v3/hotel/pricing` option for the occupancy, room names per room, meal, PAN / passport flags, full cancellation policy. |
| Checkout | `/hotels/book`: Review (live price + TripJack bookingId), room-wise guest forms (adults + children), PAN (Indian guests: lead guest when the option needs it or the hotel is outside India), passport when required, cancellation policy, taxes and total, Instant or Hold (Hold only when Review returns `onholdAllowed`), Card (existing Nomod) or Wallet (existing INR customer wallet, full cover only). No UPI / app option: the active gateway has none (Razorpay is switched off). |
| Orders API | `/api/hotels/orders*` (see `apps/api/src/routes/hotel.ts`). Price, hotel and occupancy come from a server-side Review snapshot (KV, 30 min), never the browser. The old public `POST /api/hotels/book` (instant booking with no customer payment) is removed. |
| Booking details | `/hotels/booking/[id]`: live status from Booking Details, hold deadline (`ddt`), payment / refund state, pay or confirm a held booking, cancel with the policy charge and an explicit confirmation. |
| My Trips | "Hotel stays" list for signed-in customers. |
| Admin | Existing confirm / cancel routes also update the matching website order. |

## Status rules (enforced in `apps/api/src/lib/hotel-orders.ts`)

- `CONFIRMED` only when TripJack Booking Details says `SUCCESS` — never because a payment succeeded, never for a hold.
- Instant: nothing is sent to TripJack until payment is captured (Nomod webhook / wallet debit) → queue → `book` with `paymentInfos` → poll.
- Hold: `book` without `paymentInfos` → `ON_HOLD` + deadline. Paying sends `confirm-book` only if TripJack still reports `ON_HOLD`; a supplier-released hold shows `CANCELLED` and a payment on it is refunded.
- `book` / `confirm-book` are sent at most once per order (atomic claim). A timeout is resolved from Booking Details, never re-submitted.
- One payment per order (atomic slot; an open Nomod link is reused). Failed booking after payment → automatic full refund (wallet credit / Nomod refund; anything else is flagged for the team).
- Cancel: `CONFIRMED` / `ON_HOLD` only; charge from the supplier's penalty windows; status becomes `CANCELLED` only when Booking Details says so (otherwise `CANCELLATION_PENDING`). Policy refunds are recorded as `REFUND_PENDING` for the team to settle.

## UAT scenario coverage (`apps/api/test/hotel-orders.test.ts`, mocked TripJack)

Domestic + international instant booking · hold and confirm · hold cancellation · expired hold auto-cancelled by supplier · paid hold released before confirm (refund) · cancellation within and outside the deadline · cancel accepted but still SUCCESS · rejected cancellation · multiple rooms with different adults/children (2+2, 3+1, 2+1) · PAN rules · duplicate payment / webhook / queue retry · timeout without resubmission.

## Release gates (not done in this change)

1. **Migration** `packages/db/drizzle/migrations/0012_hotel_bookings.sql` (new table only) must be applied before the API is released; order routes fail without it.
2. **Deployment** is pending. A push to `main` normally runs the broad `deploy.yml` (all migrations + API, web, portal, admin). Release only API + web + this migration through an approved, targeted procedure.
3. **Live UAT** has not been run: no TripJack, Nomod or wallet request was made. Run the scenarios above against TripJack UAT with UAT credentials; check child traveller titles (`Master` / `Miss`) and PAN handling against TripJack's responses.
4. The Nomod webhook must keep reaching `/webhooks/nomod`; hotel orders are matched by the stored link id.
