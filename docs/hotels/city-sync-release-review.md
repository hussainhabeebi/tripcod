# PR #12 final review and release runbook

Reviewed 2026-10-27 against main e95d83f9e502eca585cb9e5d6528dfd53b684411 and PR head 53e684e2b71a169e0e005627fe81eafd3ce0d8a4, plus the review corrections committed alongside this document.

## Decision: NO-GO pending resource and operational gates

No merge, deployment, production data access/write, credential change or live supplier request was performed. Keep the PR Draft. Code/fixture compatibility is verified; actual production object contents, hosting limits, logs, key validity and supplier quota remain unverified. The original failure HTTP status, supplier code, request ID and precise failing page are still unknown. Admin requires authentication; the available browser session reached login only.

Legacy migration still parses the full immutable legacy JSON for each bucket. Returning immediately after initialization removes the duplicate initial parse; using head for the publication lease avoids opening an unused object body. These reduce resource use but do not bound it. Shards also have no hard byte ceiling. A shared API isolate may serve unrelated customer requests concurrently. Before release, implement bounded migration or validate an actual production-sized copy in an isolated Worker with the deployed limits and sufficient concurrent-load headroom. A standalone Node pass is insufficient.

## Preservation and resume findings

- Existing completed hotel-static/city-regions.json and partial hotel-static/city-regions.partial.json are never overwritten/deleted by this patch. New tests assert byte preservation throughout migration/publication and old completed v2 availability during refresh.
- Readers prefer completed v2, otherwise completed v1. An incomplete refresh never replaces the completed pointer. Existing completed cities therefore remain readable in fixtures; no claim is made about private production objects. Partial-only data was never a ready catalogue and remains unavailable until publication.
- Continue with restart=false preserves pages/count/cursor. A 128-page, 256,000-region fixture takes one initialization plus 16 migration calls with zero supplier calls, then fetches the saved next-page cursor. Normal requests checkpoint one supplier page; a lost reply after checkpoint does not repeat it. A page fetched but not committed can necessarily be retried.
- Immutable shard revisions precede conditional manifest publication. Concurrent stale writers stop; they do not regress progress. Terminal checkpoint precedes publication, so failed publication retries without fetching the terminal page again.
- No Flight, TripSafe, payment, booking or authentication business logic changed. Shared hotel diagnostics preserve upstream HTTP status/request IDs without adding credentials or raw success pages to logs.

## Storage migration and capacity

No SQL migration, database schema change, KV migration, new bucket, namespace, binding or secret is required. There IS an additive R2 format migration, initiated only by an authorized Continue action. Existing DOCUMENTS_R2 binding points to tripcod-documents in repository configuration; verify deployed binding before release.

New keys: hotel-static/city-regions.v2.json (completed pointer), hotel-static/city-regions.sync-v2.json (progress), hotel-static/city-sync/<run>/legacy-base.json (immutable source) and immutable revision/bucket JSON objects. Sixteen hash buckets hold city-name mappings. Originals and old revisions are retained; failed writes can leave unreferenced objects. No cleanup is part of release.

Budget storage for original completed and partial files, one full legacy snapshot per migration run, initial shard set roughly the source data size, and every rewritten affected shard thereafter. Growth is the sum of revised shard bytes per page, not just the final index size. Exact capacity/cost requires actual object sizes and page/bucket distribution; retention cleanup needs separate review.

R2 operation counts from the probe: initialization 5; each migration 4; a page affecting u buckets approximately 2+2u, up to34; terminal publication adds4 (38 observed). Add gateway fetch, tenant/auth/KV/DB/log operations and redirects when evaluating total invocation budgets. Lookup reads manifest plus requested shards. KV lookup TTL30 days and hotel-ID TTL1 day remain unchanged: a warm-cache lookup alone does not prove the new reader was exercised. Do not purge production KV.

## Resource evidence

Reproduce without network: node apps/api/test/hotel-city-sync-resources.cjs. Raw synthetic measurements: [city-sync-resource-probe.json](city-sync-resource-probe.json). Node v24.22.1, disk-backed R2 mock, isolated process per fixture, sampled JS heap rather than process peak/Worker memory. Both fixtures contain256,000 regions, then one mocked2,000-record terminal page.

| Fixture | Legacy size | Largest shard | Init CPU / sampled heap | Migration max CPU / heap | Terminal CPU / heap | Lookup CPU / heap |
| --- | --- | --- | --- | --- | --- | --- |
| 2,000 city names | 7.75 MiB | 0.59 MiB | 184 ms / 50 MiB | 78 ms / 51 MiB | 88 ms / 57 MiB | 5 ms / 9 MiB |
| 256,000 city names | 13.95 MiB | 0.92 MiB | 412 ms / 100 MiB | 361 ms / 103 MiB | 321 ms / 89 MiB | 9 ms / 13 MiB |

These are not production-size claims, Cloudflare measurements or safety guarantees. Before the initialization correction the high-cardinality fixture sampled153 MiB. Current code still has unbounded source parsing.

Cloudflare documentation states128 MB memory per isolate shared by concurrent requests; Free CPU10 ms, Paid HTTP default30 seconds/configurable up to5 minutes. Current subrequest limits distinguish external from internal operations: Free external50/internal1000; Paid default10,000 configurable. Six outbound connections may await headers concurrently. Actual plan and CPU configuration are unknown. Source: https://developers.cloudflare.com/workers/platform/limits/ (reviewed2026-10-27).

Supplier/gateway source defaults: city client45-second timeout; gateway45 seconds,120 requests/minute per client IP, circuit opens after5 failures for30 seconds. These are not verified deployed values or TripJack account quota. Admin one-second delay means at most about60 requests/minute per tab plus latency; multiple tabs/other traffic aggregate. Confirm account quota and one operator; stop on429 rather than bypassing limits.

## Regression results

- Targeted hotel sync and validation:15/15 passed.
- Supplier and gateway suites:36/36 passed; only mocks.
- Full API:105 tests,101 passed,4 failures. Baseline:92 tests,88 passed, same4 failures. Baseline API/supplier sources are identical to latest main (git diff c757f8e origin/main -- apps/api packages/suppliers is empty).
- Existing failures: explicit rejected booking is not success; lost submit response is unknown and does not retry; accepted booking survives local save failure; enclosing confirm route distinguishes review, submission and persistence failures. They remain outside this hotel patch.
- API TypeScript/build (tsc --noEmit), Admin Next build and web Next build passed. git diff --check passed.
- Merge-tree against latest fetched main is clean. Recheck immediately before any future release.

## Required pre-release gates (no execution authorized here)

1. Close the resource gate above using bounded migration or a production-sized sanitized copy in an isolated Worker with actual plan, CPU settings and concurrent-load measurements. Separate all staging R2/KV/D1 bindings: repository preview KV IDs reuse normal IDs, so a preview is not automatically isolated.
2. Authorized operators obtain sanitized supplier/gateway/Worker logs for the original failure and verify deployed HMS routing, effective hotel credential source, Hotel v3 entitlement and supplier quota without replacing shared credentials. Hotel key resolution is Admin saved key, then Worker key, then optional gateway fallback; actual winner remains unknown.
3. Record current API/Admin Worker version IDs, build settings, routes, compatibility configuration and binding identities privately. Capture R2 object size/ETag/checksum/page/count/cursor presence for v1/v2/progress and secure backups. Version IDs and production sizes are currently unavailable; do not substitute invented values.
4. Establish a reader-compatible rollback artifact if no completed v1 catalogue exists and uninterrupted hotel availability is required. Old API versions cannot read v2-only data.
5. Approve a pinned API/Admin-only release procedure. Current .github/workflows/deploy.yml runs on push to main, executes all SQL migrations and deploys API/web/portal/Admin. Do not trigger it as an unreviewed hotel-only release. Inventory other connected build triggers too; do not change workflow/settings without separate approval.

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
