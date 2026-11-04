import { drizzle } from "drizzle-orm/d1";
import * as d1Schema from "./schema.js";

// Minimal shape of the Workers D1 binding, so this package does not need
// @cloudflare/workers-types.
type D1Binding = Parameters<typeof drizzle>[0];

// Primary database: Cloudflare D1 (bound as `HOTEL_DB` in apps/api/wrangler.toml).
// Neon (see ../client.ts) is the secondary database for tables not yet moved.
export function createD1Db(binding: D1Binding) {
  return drizzle(binding, { schema: d1Schema });
}

export type D1Db = ReturnType<typeof createD1Db>;
export { d1Schema };
