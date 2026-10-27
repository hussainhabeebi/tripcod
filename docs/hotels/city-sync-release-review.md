# PR #12: bounded city sync and early hotel search

Reviewed 2026-10-27. Continues96dee3e; latest fetched main e95d83f9e502eca585cb9e5d6528dfd53b684411. This supersedes the earlier full-source-parsing resource assessment.

## Decision

**Code corrections are implemented and locally verified; production release remains NO-GO until the access and release gates below are closed. Keep Draft; do not merge/deploy yet.** No production writes, credential changes, live supplier requests, bookings or payment operations were performed.

## Smallest targeted correction

- Keep the existing v2 manifest, sixteen hash buckets, conditional checkpoints and supplier pagination. Replace only legacy catalogue parsing with a streaming reader. It validates one city entry at a time, handles metadata before/after cities and UTF-8/escaped text across stream chunks, and never calls text()/json() on an entire legacy catalogue.
- Initialization scans without retaining city rows. Each subsequent invocation streams the immutable snapshot and retains only its target bucket. This deliberately uses seventeen streaming passes (initialization + sixteen buckets), preserving the existing migration format instead of introducing byte-offset/parser-state migration. Memory no longer grows with catalogue bytes; total read/CPU work still does. Oversized input stops safely rather than claiming completion.
- Bound a single key/value token to128 Ki UTF-16 code units; cap retained shard JSON and selected legacy city rows at2 MiB UTF-8. Reject an existing oversized shard before json(), and reject a new oversized shard before checkpoint publication. A limit error leaves saved supplier pages/cursor and source intact; a separately reviewed split strategy is needed if real data exceeds those guards. These are serialized-size/token bounds, not claims about exact JS heap size.
- Hotel Search reads committed partial data when the requested city is absent from a completed catalogue or none exists. During migration it streams the immutable snapshot; before initialization it can stream the original partial checkpoint. After migration it reads committed shards. Available cities proceed through the unchanged region → hotel mapping → listing flow; missing partial cities return CITY_NOT_SYNCED with Continue guidance. Never publish an incomplete catalogue as complete. Completed matches remain preferred.
- Completed v1 reading is also streamed. No catalogue format, customer-facing search fields, supplier endpoint, credential resolution, booking/payment logic or Flight settings changed. Admin help explains that saved cities are already searchable.

## Data and resume guarantees verified with fixtures

Original hotel-static/city-regions.json and hotel-static/city-regions.partial.json remain untouched. Immutable legacy snapshots and revisions are retained; no deletion/reset/cleanup is added. Tests assert original content/ETag preservation, completed-v1 availability during migration and completed-v2 availability during refresh.

A saved128-page/256,000-region checkpoint initializes and migrates in17 local calls, with ZERO supplier calls, then sends the exact saved next-page cursor on the next call. Page129 is correct only if the actual durable checkpoint is128; the code never hardcodes129 or resets to page1. Storage/stream/size/conflict failures preserve the last committed checkpoint. Terminal-publication retry makes no extra supplier request. A supplier page that never committed may need retry; an already committed page is not intentionally downloaded again.

## Measured local validation and resource boundary

| Synthetic fixture (256,000 regions) | Source | Largest shard | Max sampled Node heap | Max sampled Node CPU/call | Max local workerd wall time/call |
| --- | --- | --- | --- | --- | --- |
| 2,000 city names | 7.75 MiB | 0.59 MiB | 56 MiB | 925 ms | 1,999 ms |
| 256,000 city names | 13.95 MiB | 0.92 MiB | 27 MiB | 3,068 ms | 2,439 ms |

Both resource-probe child processes explicitly run with --max-old-space-size=64, including migration, synthetic terminal page/publication and lookup. This caps Node old space, not total process memory or hosted Worker memory. Sampled heap is not a guaranteed peak. Raw evidence: [Node](city-sync-resource-probe.json).

The separate Miniflare integration runs bundled production code in local workerd with a fully local persisted R2 bucket. Both fixtures verify17 migration calls, exactly one mocked next-page supplier call, early/final lookups and unchanged original ETags. It also runs four simultaneous city lookups during a migration invocation. Fixture buffering occurs only in the external Node seeder; the Worker receives streams. Raw evidence: [workerd](city-sync-worker-probe.json).

Local workerd does NOT enforce hosted CPU/memory quotas. These results establish streaming correctness and bounded local operation, not a production load certification. Cloudflare documents128 MB per isolate shared across concurrent requests; Free CPU10 ms and Paid HTTP default30 seconds. The deployed plan/CPU configuration remains unknown. Confirm Paid CPU allowance/headroom and test a production-sized copy in isolated hosted bindings before claiming hosted safety. Do not attach previews to production KV (repository preview IDs reuse normal IDs).

Sources: https://developers.cloudflare.com/workers/platform/limits/ ; https://developers.cloudflare.com/workers/local-development/ (reviewed2026-10-27).

Reproduce locally, with repository dependencies installed:

    node apps/api/test/hotel-city-sync-resources.cjs
    node apps/api/test/hotel-city-sync-worker.cjs

## R2/KV/database resource requirements

No SQL/schema/KV migration, new bucket, namespace, binding or secret is needed. Additive R2 format migration uses existing DOCUMENTS_R2 (repository bucket tripcod-documents; deployed binding must be verified).

Retain both original legacy files, one immutable source snapshot, initial sixteen shard objects, small progress/completed manifests and every immutable rewritten shard. Storage is originals + snapshot + all shard revisions, not just final index size. Failed conditional writes may leave unreferenced objects. No retention cleanup is authorized. Source is read in full seventeen times during migration, but streamed; lookup fallback also streams a legacy source until migrated. Existing KV cache reduces repeat city lookups.

Probe operation counts: initialization5 R2 operations; each migration4; normal supplier page roughly2+2u for u affected buckets (up to34); terminal publication adds4 (38 observed). Add ordinary auth/tenant/KV/DB/log operations and gateway fetch when checking invocation budgets. Partial lookup uses up to4 catalogue-object reads in the no-completed-index path; completed v2 normally reads manifest + selected shard(s). Existing30-day region and1-day hotel-ID KV TTLs are unchanged. No purge is required; a warm-cache result alone cannot verify new R2 reading.

Gateway source defaults remain45-second timeout,120 requests/minute per client IP, circuit after5 failures/30-second cooldown. Admin pacing is one-second delay, stop on first error and pause after200 invocations. Progress writes are spaced by at least one second, including multiple writes inside initialization/publication, to respect the R2 per-key write limit. Source: https://developers.cloudflare.com/r2/platform/limits/ . Actual TripJack quota and deployed gateway limits are unknown; one tab is not an aggregate rate limiter. Confirm quota, use one operator and stop on429.

## Credential/access findings and remaining gates

1. **Production checkpoint/log evidence unavailable.** Current read-only browser check of https://admin.tripcod.com redirects to /login. No secure Admin session or Cloudflare runtime connector/token is available. Therefore actual pages/cursor/object sizes, prior failed page, supplier HTTP/code/request ID and Worker exception remain unverified. The original browser Failed to fetch is not proof of a supplier403 or memory termination.
2. **Effective credentials/routing unverified.** Source resolution remains Admin-saved TripJack integration key → Worker TRIPJACK_API_KEY → optional gateway fallback when no apikey is supplied. Hotel helper does not use tenant supplier DB credentials. Worker TRIPJACK_API_BASE_URL/TRIPJACK_PROXY_KEY and gateway TRIPJACK_HMS_UPSTREAM determine actual routing; source default HMS is https://apitest-hms.tripjack.com. Actual winning key, hostname, entitlement, whitelist and quota require authorized secure hosting/Admin/TripJack access. Do not change shared Flight/TripSafe keys. A real staging hotel search was NOT executed; no secure staging credentials/routing evidence is available.
3. **Hosted resource/capacity gate.** Read actual object metadata privately, check entry/shard sizes against guards, verify deployed limits, then use separate isolated bindings for copied data with no supplier calls. After secure staging routing is confirmed, perform only a controlled read-only mapping/search, not bookings/payments.
4. **Targeted deployment gate.** Existing main-push workflow runs SQL migrations and deploys API/web/portal/Admin. No workflow/settings were changed here. Before release, authorize a separate pinned API/Admin-only manual procedure, verify other connected build triggers and avoid triggering the broad workflow. Do not merge merely to make deployment convenient.
5. **Exact rollback version IDs unavailable.** An authorized Cloudflare operator must privately record current tripcod-api and tripcod-admin version IDs, compatible bindings/build settings and the approved rollback artifact before release. Git commit IDs are not Worker version IDs; this report intentionally provides no invented values. GitHub connector workflow lookup on main returned no PR-triggered runs, which does not establish production deployment history.

## Essential regressions

Targeted hotel sync/validation/search:24 tests. Supplier/gateway:36 tests. Full API:114 tests,110 passed, same4 baseline booking failures (baseline92/88). API TypeScript/build and Admin/web Next builds pass. All supplier exchanges are mocked. Existing failures remain explicit rejected booking is not success; lost submit response is unknown and does not retry; accepted booking survives local save failure; and their enclosing confirm-route test. No unrelated fixes were made.

The hotel-ID test loader now resolves the small new streaming module; business assertions remain intact. Latest-main merge-tree conflict check and git diff --check passed before publishing this review commit.

## Exact ordered release and verification plan (separate approval required)

1. Pin the approved final PR commit, re-fetch main and rerun conflict/regression checks. Confirm all gates above and exact rollback version IDs/artifacts. No reset, data deletion, secret edits or SQL migration.
2. Quiesce every existing Admin sync tab/job and wait for in-flight old batches to finish. Old batches can include8 supplier requests of up to45 seconds each plus persistence; confirm writes have stopped rather than assuming an instant cutover. Snapshot after quiescence so later old writes cannot cause re-download from a stale cursor.
3. Through the approved existing Cloudflare release mechanism, deploy the pinned API artifact to tripcod-api, preserving deployed bindings/config/secrets, and then the pinned Admin artifact to tripcod-admin with NEXT_PUBLIC_API_URL=https://api.tripcod.com. Confirm both versions/routes. Do not deploy gateway/web/portal, change SQL, or change Flights/TripSafe/payment settings. Do not start sync while old clients remain active.
4. One authorized operator issues one POST /api/admin/hotels/city-index/sync with JSON {"restart":false} per step through the secure Admin session. For a legacy checkpoint, initialization plus16 bucket steps use no supplier requests and preserve saved page/count. Verify each durable checkpoint and unchanged originals. Stop on storage/conflict/resource errors.
5. After migration, authorize one controlled next unsaved supplier page (129 only if saved pages=128), correlate response HTTP/provider code/gateway request ID and phase, verify saved cursor/count advance exactly once. On429/auth/1102/persistence errors stop and investigate; no reset or uncontrolled retry.
6. Only after that succeeds, use Continue with one operator at the account-approved pace. Admin pauses after200 invocations. Resume without restart until ready=true/complete=true and all referenced shards exist/read. Verify original object checksums unchanged and counts/cursor progress consistent.
7. Verify a direct manifest/shard lookup and an uncached city; warm KV is not sufficient. Perform a read-only hotel search only with separate authorization. Smoke-test existing Flights/MyTrips/hotel UI without supplier bookings or payment transactions. Compare integration configuration unchanged.
8. Observe Worker CPU/memory outcomes (including exceededCpu/exceededMemory), gateway429/timeouts, request phases, persistence errors and customer lookup availability during continuation. Stop if headroom or availability gates fail. Record actual results; no live checks have passed yet.

## Rollback plan (separate approval required)

1. Stop all sync clients/jobs and quiesce writes. Record failure IDs/checkpoint metadata; preserve every original, v2 manifest, snapshot and shard. No R2/KV/DB purge or credential rotation.
2. Restore the exact pre-recorded API/Admin Worker versions through the authorized release mechanism, retaining compatible bindings and configuration. A code rollback does not undo R2 writes.
3. If completed v1 exists, the old reader can serve it. If only v2 is completed, old code restores the original unavailable-hotel state; use the separately reviewed reader-compatible rollback artifact if availability must continue. This artifact is not currently provided.
4. Never Continue on rolled-back old API: it only sees the stale original partial checkpoint and can download pages already committed in v2. Keep sync paused until a forward fix/compatible resume is approved.
5. Verify legacy city availability, routes and unrelated customer journeys without transactions. Any future pointer restoration is a separately approved conditional-write operation, never deletion/reset. Retain new data for forward recovery.
