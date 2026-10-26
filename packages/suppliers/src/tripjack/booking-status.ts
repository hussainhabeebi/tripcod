import type { BookResult } from "../base.js";

// API acceptance, a held PNR and ticket issuance are different supplier outcomes.
export function tripjackBookingResult(raw: unknown, sessionId: string): BookResult {
  const root = raw as any;
  const data = root?.data ?? root?.result ?? root;
  const text = (v: unknown) => typeof v === "string" ? v.trim() : "";
  const order = data?.order ?? data;
  const state = text(order?.status).toUpperCase() || text(data?.bookingStatus).toUpperCase();
  const api = data?.status ?? root?.status;
  const ref = text(order?.bookingId) || text(data?.bookingId) || text(root?.bookingId);
  if (!state && api?.success == null && !ref) throw new Error("Booking response did not establish an outcome");
  const failed = ["FAILED", "CANCELLED", "REJECTED", "ABORTED"].includes(state)
    || root?.errors?.length || data?.errors?.length || api?.success === false;
  const accepted = !failed && (!!ref || ["SUCCESS", "ON_HOLD", "CONFIRMED", "PENDING"].includes(state)
    || api?.success === true || api?.success === "true");
  const travellers = data?.itemInfos?.AIR?.travellerInfos ?? data?.travellerInfos ?? [];
  const firstValue = (v: unknown) => v && typeof v === "object" ? Object.values(v).find((x) => typeof x === "string" && x.trim()) as string | undefined : undefined;
  const pnr = (Array.isArray(travellers) ? travellers.map((t: any) => firstValue(t.pnrDetails)).find(Boolean) : "") || text(data?.pnr);
  const tickets: string[] = Array.isArray(travellers) ? travellers.flatMap((t: any) => Object.values(t.ticketNumberDetails ?? {}).filter((v): v is string => typeof v === "string" && !!v.trim())) : [];
  const allTicketed = Array.isArray(travellers) && travellers.length > 0 && travellers.every((t: any) => firstValue(t.ticketNumberDetails));
  return {
    success: !!accepted, bookingRef: ref || (accepted ? sessionId : ""), pnr: pnr || "", ticketNumbers: state === "SUCCESS" ? tickets : [],
    status: !accepted ? "FAILED" : state === "ON_HOLD" ? "HELD"
      : state === "SUCCESS" && pnr && allTicketed ? "TICKETED"
      : ["SUCCESS", "CONFIRMED"].includes(state) && pnr ? "CONFIRMED" : "PENDING",
    raw,
  };
}
