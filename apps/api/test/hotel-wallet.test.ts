// Hotel wallet payment end-to-end cases (hotel-wallet.cases.ts) replace the
// customer-wallet module with an in-memory ledger, which needs Node's module
// mocks:  node --experimental-test-module-mocks --import <tsx> --test apps/api/test/hotel-wallet.test.ts
import test, { mock } from "node:test";

if (typeof (mock as { module?: unknown }).module === "function") await import("./hotel-wallet.cases.js");
else test("hotel wallet payment cases", { skip: "run with node --experimental-test-module-mocks" }, () => {});
