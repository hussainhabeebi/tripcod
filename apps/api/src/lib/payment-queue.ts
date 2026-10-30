import type { Env } from "../types.js";
import type { CaptureDeps } from "./payment-core.js";

// How a confirmed payment reaches the supplier: the booking queue (retried,
// one supplier booking per booking via the booking lock / hotel status claim).
export function captureDeps(env: Env): CaptureDeps {
  return {
    enqueueFlight: async (msg) => { await env.BOOKING_QUEUE.send(msg); },
  };
}
