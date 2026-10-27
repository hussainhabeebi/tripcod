# Hotel city sync investigation and correction

Date: 2026-10-27. Branch: codex/hotel-city-sync-resume. Baseline: e95d83f.

## Evidence boundary / root cause

The reported live symptom is 128 pages / 256,000 regions followed by browser “Failed to fetch”. There is **no 128-page cap** in repository code. The previous Admin loop allows 200 requests, each up to eight supplier pages. The specific live trigger is **not verified**: production Supplier Logs, Worker exception logs, deployment settings and R2 checkpoint contents were not accessible. Read-only navigation to admin.tripcod.com redirected to /login; no sign-in, sync, reset, secret edit or supplier request was performed.

Actual failed supplier HTTP status, supplier code, gateway request ID and failing page are unknown. Page 129 is only the next page *if* 128 is the last durable checkpoint; the old eight-page batch could have fetched further pages before failure. A browser fetch failure by itself establishes neither a supplier 403 nor a timeout or memory exception.

Confirmed code defects / failure modes:

- The entire growing partial city dictionary is parsed and serialized on every Admin batch. The final customer lookup also reads that entire object. Work and memory increase with catalogue size. This is a plausible resource-pressure cause, **not a measured Cloudflare memory/CPU failure**.
- Progress is persisted only after an eight-page batch. A failure on a later page or on persistence discards the successful earlier pages in that batch from the durable checkpoint, requiring their download again.
- If final publication fails, the terminal state is not checkpointed separately. Resume can repeat work and cannot reliably distinguish finalization from fetching.
- Cursor advancement is not validated, concurrent writers can overwrite progress, and the Admin starts a restart when status is not yet loaded.
- Sync errors do not preserve the gateway response request ID or exact page/storage phase. A client-side fetch error is misleadingly described as having TripJack's full response in Supplier Logs.

## Routing, authentication, timeout and rate-limit audit

- City list: GET /hms/v3/content/fetch-city-regionIds, limit=2000, opaque cursor encoded through URLSearchParams. Gateway already permits GET and forwards its query string to HMS; no route or hostname change is required by the source audit.
- Hotel key source is saved Admin integration key first, then Worker TRIPJACK_API_KEY; if no header is supplied, the gateway can use its own optional key fallback. Hotel construction does not use tenant supplier DB credentials. Actual winning deployed key, entitlement and validity are unverified. Historical progress does not establish that the current key is valid.
- Worker gateway base and proxy key come from TRIPJACK_API_BASE_URL / TRIPJACK_PROXY_KEY. The deployed gateway chooses HMS through TRIPJACK_HMS_UPSTREAM; repository default is apitest-hms.tripjack.com. Admin UAT/Production selection does not prove that actual HMS routing agrees. No setting was changed.
- Client city call timeout: 45 seconds. Gateway default request timeout: 45 seconds. Gateway default rate limit: 120/minute per client IP, circuit threshold five failures, cooldown 30 seconds. These are code defaults, not verified runtime values. Any may contribute to failures, but none proves the live cause.
- Previous partial data is stored under hotel-static/city-regions.partial.json, completed index under hotel-static/city-regions.json. Current private object existence/contents and storage errors could not be read.

## Correction

1. Process at most one supplier page per Admin request and checkpoint it before replying. An acknowledged page or a lost reply after checkpoint is resumed from its saved cursor, not downloaded again. An uncommitted page after storage failure may necessarily be fetched again; completed pages remain intact.
2. Use 16 city-name hash shards and a small progress manifest with conditional ETag writes. Shard revisions are immutable; the manifest publishes all changes for one page atomically. Concurrent stale writers stop with SYNC_CONFLICT rather than regress the cursor. Partial writes remain unreferenced, without corrupting committed data.
3. Migrate a legacy partial checkpoint one shard per request without supplier calls. An immutable copy freezes its source even if an older deployment still has an in-flight batch. Its existing pages/count/cursor are preserved. The original file remains untouched; no reset is necessary. Migration still reads the legacy checkpoint to extract each bucket; deployment resource limits must be verified for that one-time legacy parsing work.
4. Save the terminal-page checkpoint before final publication. Retry finalization without requesting the last supplier page again. Refuse malformed/non-advancing/cyclic cursors, missing saved cursors, empty catalogues and missing referenced shards.
5. Publish to hotel-static/city-regions.v2.json; retain the original completed index and partial checkpoint. Readers support both formats and load only requested city shards for v2. Existing customers can keep using the old completed list while a refresh is incomplete. No existing data deletion or cleanup is performed. Immutable revisions consume additional R2 storage; retention/cleanup is a separate reviewed maintenance task.
6. Preserve response HTTP status separately from supplier upstream status and carry the gateway request ID into errors. Supplier Logs and Admin responses include page, saved pages and supplier/persistence/publication phase. No raw success pages, API keys, internal proxy secrets or cursors are added to diagnostic responses.
7. Pace Admin calls by one second, stop on the first failure, and pause after 200 invocations with an explicit Continue message. No automatic error retries. Disable sync until status is loaded, refuse restart over in-progress data, and reject malformed Admin responses.

## Regression / validation

- Original patch validation: 13/13 hotel sync + existing hotel validation tests passed. Final review adds two preservation tests (15/15); see [release review](city-sync-release-review.md). Includes a synthetic legacy checkpoint with exactly 128 pages and 256,000 regions; one initialization and 16 local migration calls make zero supplier calls, then resume at its saved page-129 cursor. Tests also cover 429 checkpoint preservation, write failure/deduplication, failed final publication, cursor faults, concurrent manifest writes, legacy fallback and correlated Admin/log diagnostics.
- Supplier + gateway suites: 36/36 tests passed, including opaque cursor encoding, unchanged authentication headers, HTTP 403 diagnostics, interrupted response body and HTTP-200 supplier errors. All exchanges use mocks; there were no real supplier calls.
- API TypeScript / API build (tsc --noEmit) and Admin/web Next builds passed. No Cloudflare dry-run/deploy, production merge or production data write performed.
- The existing hotel-ID integration test's data-URL loader was updated to resolve the newly extracted module; its business assertions remain intact.

## Remaining evidence and completion steps

1. An authorized Admin must inspect/export the failed Supplier Log summary (redacted), including timestamp, local request ID, endpoint, HTTP status/code and error snippet. Also check Worker exception/CPU/memory logs and gateway request logs around that timestamp. Do not share keys or raw credentials. A hard Worker termination may have no Supplier Log row.
2. Inspect the actual saved checkpoint's cursor presence and page/count, R2 errors, effective hotel key source and actual HMS upstream. Confirm Hotel v3 entitlement and allowlisting through the authorized hosting/TripJack interfaces; do not replace any shared Flight/TripSafe key.
3. Review this storage-format correction and its legacy migration/resource requirements. No deploy is authorized here. After separately authorized release, use **Continue sync**, not restart; migration reports the same 128 pages until all legacy buckets are copied, then downloads only the next unsaved page.
4. If it stops, record the new diagnostic page / phase / request IDs and investigate that cause before another controlled continuation. Finish only when ready=true and the completed index is published. Then verify a city lookup and an explicitly authorized read-only hotel search. No booking/payment test is needed to complete the city index.
5. Rollback retains original legacy files. Older code cannot consume a new v2-only catalogue; if no completed legacy list existed, rolling back will again require a compatible reader. Do not delete/restart either checkpoint as a rollback shortcut.
