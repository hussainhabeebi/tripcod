# Existing-log PAN rejection investigation — 31 October 2026

No supplier requests or production writes were performed. Evidence was read from existing D1 orders and R2 exchanges; guest names and other PANs are omitted here.

| Evidence | Hold | Latest Instant |
| --- | --- | --- |
| TripJack booking ID | TJP200803296560 | TJP203903296996 |
| Recorded Book time (UTC) | 08:25:08 | 09:44:21 |
| Party | 1 adult, 1 room | 4 adults + 2 children, 1 room |
| Review PAN required | true | true |
| Lead guest name | Normalized name matches Instant | Normalized name matches Hold |
| Lead PAN | Documentation sample AAACA1111A | Same documentation sample |
| Additional PAN values | None | Five different additional values |
| Saved-to-outbound PAN mapping | Unchanged | All six unchanged, uppercase and trimmed |
| PAN JSON path | roomTravellerInfo[0].travellerInfo[0].pan | Same lead path; all six guests have pan |
| Book type | HOTEL, no paymentInfos | HOTEL, paymentInfos present |
| Supplier response | HTTP 200, success=true | HTTP 400, success=false, 1092: Please, enter valid PAN number. |

Both payload shapes and the sample lead PAN agree with the official v3 Book example at https://tripjack.com/page/api-doc. The two requests are not an isolated test of Hold versus Instant because the party and five PAN values changed. The same normalized lead name was also used on earlier successful single-adult Instant bookings with another PAN; therefore these logs do not support a claim that Instant always rejects PANs or that the lead name is mapped differently.

Earlier Instant TJP201103296983 (09:40:03 UTC) used the other documented sample on the lead adult, with no PAN on the remaining five guests; it also returned 1092. The latest Instant supplied all six PANs and still returned 1092. Two adult entries also have matching normalized names but different PAN values; the response does not say whether that is relevant. TripJack's generic response does not identify a guest/PAN, or explain whether a test-data, identity, entitlement or per-guest validation rule rejected it. That internal cause cannot be established from these logs. TripJack must confirm approved UAT guest/PAN combinations for this six-guest case. No PAN mapping or validation rules were changed based on an assumption.

## Confirmed Tripcod polling defect

The catch block called Booking Details before classifying a definite Book rejection. After 1092, the latest Instant generated two stored 2501 responses at 09:44:26 UTC even though Book had never created an order. Forced order reads could repeat this request.

The correction skips Details for definite rejected Book calls (including PAN 1092 in an HTTP-200 failure envelope), and stops forced refreshes for failed orders without a supplier status. Timeout, network and 5xx outcomes still reconcile because an order might exist. Conflicts and confirm-hold failures keep their existing reconciliation. Existing settlement/refund delegates are unchanged; tests mock them and no actual payment operation was executed.
