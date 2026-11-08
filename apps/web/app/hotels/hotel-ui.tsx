// Shared pieces of the hotel room selection, checkout and booking pages.

import { describeRoom, freeCancellationUntil, type RoomOccupancy } from "@tripcod/suppliers/hotel-occupancy";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.tripcod.com";

export type Pricing = { totalPrice: number; basePrice: number; discount: number; taxes: number; mf: number; mft: number; currency: string; strikethrough?: number };
export type Penalty = { from: string; to: string; amount: number };
export type HotelOption = {
  optionId: string; optionType?: string; mealBasis: string; bookingNotes?: string; inclusions: string[];
  roomInfo: { id?: string; name: string }[];
  pricing: Pricing;
  compliance: { gstType: string; panRequired: boolean; passportRequired: boolean };
  cancellation: { isRefundable: boolean; penalties: Penalty[]; deadlineDateTime?: string };
};

export function money(amount: number, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-IN")}`;
  }
}

// TripJack times are India wall-clock times ("2026-11-20T23:59").
export function istTime(value?: string | null) {
  if (!value) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value);
  if (!m) return value;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
  return m[4] ? `${date}, ${m[4]}:${m[5]} IST` : date;
}

export function dayLabel(value?: string | null) {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const MEAL_LABEL: Record<string, string> = { CP: "Breakfast included", MAP: "Half board", AP: "Full board", EP: "Room only" };
export const mealLabel = (m: string) => MEAL_LABEL[m] ?? m;

export function Row({ l, v, strong }: { l: string; v: React.ReactNode; strong?: boolean }) {
  return <div className={strong ? "row row-strong" : "row"}><span>{l}</span><b>{v}</b></div>;
}

export function OccupancyList({ rooms, roomNames }: { rooms: RoomOccupancy[]; roomNames?: string[] }) {
  return (
    <ul className="occ">
      {rooms.map((r, i) => (
        <li key={i}>
          <b>Room {i + 1}</b>
          {roomNames?.[i] && <span className="occ-room">{roomNames[i]}</span>}
          <span>{describeRoom(r)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CancellationPolicy({ policy, currency }: { policy: HotelOption["cancellation"]; currency: string }) {
  const free = policy.isRefundable ? freeCancellationUntil(policy) : null;
  return (
    <div className="policy">
      <p className={policy.isRefundable ? "policy-head ok" : "policy-head no"}>
        {policy.isRefundable ? (free ? `Free cancellation until ${istTime(free)}` : "Refundable") : "Non-refundable — the full amount is charged on cancellation"}
      </p>
      {policy.penalties.length > 0 && (
        <table>
          <thead><tr><th>If cancelled between</th><th>Charge</th></tr></thead>
          <tbody>
            {policy.penalties.map((p, i) => (
              <tr key={i}><td>{istTime(p.from)} – {istTime(p.to)}</td><td>{p.amount > 0 ? money(p.amount, currency) : "No charge"}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="policy-note">Charges and times are the hotel supplier&apos;s policy. Refunds go back to the original payment method.</p>
    </div>
  );
}

// Hotel notes arrive as plain inclusions ("Free WiFi") or as JSON objects
// ({"know_before_you_go": "..."}, {"Mandatory": "..."}), sometimes several in
// one string. Turn them into readable sections.
type NoteSection = { title: string; text: string; important: boolean };
const NOTE_TITLES: Record<string, string> = {
  know_before_you_go: "Know before you go", special_instructions: "Special instructions", instructions: "Check-in instructions",
  optional: "Optional fees (paid at the hotel if used)", mandatory: "Fees payable at the hotel", fees: "Fees",
};
function noteTitle(key: string) {
  const k = key.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return NOTE_TITLES[k] ?? key.replace(/_/g, " ").replace(/^\w/, (m) => m.toUpperCase());
}
// "...property policyGovernment-issued ID..." → separate lines.
const tidy = (t: string) => t.replace(/\s+"?\s*$/, "").replace(/([a-z0-9.)%])([A-Z](?:[a-z]|\s))/g, "$1\n$2").trim();

function parseHotelNotes(items: string[]): { inclusions: string[]; sections: NoteSection[] } {
  const inclusions: string[] = [];
  const sections: NoteSection[] = [];
  for (const raw of items) {
    const text = String(raw ?? "").trim();
    if (!text) continue;
    let objects: unknown[] | null = null;
    for (const candidate of [text, `[${text}]`]) {
      try { const v = JSON.parse(candidate); objects = Array.isArray(v) ? v : [v]; break; } catch { /* not JSON */ }
    }
    if (!objects || !objects.every((o) => o && typeof o === "object")) { inclusions.push(text); continue; }
    for (const o of objects as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(o)) {
        const body = tidy(String(value ?? ""));
        if (!body) continue;
        sections.push({ title: noteTitle(key), text: body, important: /mandatory/i.test(key) });
      }
    }
  }
  return { inclusions, sections };
}

export function HotelNotes({ items }: { items: string[] }) {
  const { inclusions, sections } = parseHotelNotes(items);
  if (!inclusions.length && !sections.length) return null;
  return (
    <div className="hnotes">
      {inclusions.length > 0 && <p className="hnotes-inc"><b>Includes:</b> {inclusions.join(" · ")}</p>}
      {sections.map((s, i) => (
        <details key={i} className={s.important ? "hnote hnote-important" : "hnote"} open={s.important}>
          <summary>{s.title}</summary>
          <p>{s.text}</p>
        </details>
      ))}
    </div>
  );
}

export function PriceBreakup({ pricing }: { pricing: Pricing }) {
  const c = pricing.currency;
  const taxes = pricing.taxes + pricing.mf + pricing.mft;
  return (
    <div className="receipt">
      <Row l="Room charges" v={money(pricing.basePrice, c)} />
      {pricing.discount > 0 && <Row l="Discount" v={`− ${money(pricing.discount, c)}`} />}
      <Row l="Taxes & fees" v={money(taxes, c)} />
      <Row l="Total payable" v={money(pricing.totalPrice, c)} strong />
    </div>
  );
}

// Order access key: kept in this browser (and in the booking link's #fragment, never sent to servers in URLs).
const KEY_PREFIX = "tripcod_hotel_order:";
export function saveOrderKey(id: string, key: string) { try { localStorage.setItem(KEY_PREFIX + id, key); } catch { /* private mode */ } }
export function readOrderKey(id: string): string {
  try {
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (fromHash) { saveOrderKey(id, fromHash); return fromHash; }
    return localStorage.getItem(KEY_PREFIX + id) ?? "";
  } catch { return ""; }
}

export function readCustomerToken(): string {
  try {
    const m = document.cookie.match(/(?:^|;\s*)tripcod_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  } catch { return ""; }
}

export async function orderApi<T = any>(path: string, opts: { key?: string; method?: string; body?: unknown } = {}): Promise<T> {
  const token = readCustomerToken();
  const res = await fetch(`${API_URL}/api/hotels${path}`, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json", "x-tenant-slug": "tripcod",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.key ? { "X-Hotel-Order-Key": opts.key } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(typeof data?.error === "string" ? data.error : `Something went wrong (${res.status})`), { status: res.status, data });
  return data as T;
}

export const hotelCss = `body{background:#f5f7fb}.ck{max-width:980px;margin:auto;min-height:100vh;padding:0 16px 32px;color:#101828}
.ck header{position:sticky;top:0;z-index:30;margin:0 -16px;padding:12px 16px;background:#fff;display:flex;gap:12px;align-items:center;border-bottom:1px solid #eaecf0}
.ck header button,.ck header a.back{width:44px;height:44px;border:0;border-radius:14px;background:#f2f4f7;font-size:28px;display:grid;place-items:center;text-decoration:none;color:#101828;flex-shrink:0;cursor:pointer}
.ck header div{display:flex;flex-direction:column;min-width:0}.ck header div b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ck header div span{font-size:11px;color:#667085;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ck header i{margin-left:auto;font-style:normal}
.steps{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 4px;padding:0;list-style:none;font-size:11px;font-weight:700;color:#98a2b3}.steps li{padding:5px 10px;border-radius:99px;background:#fff;border:1px solid #eaecf0}.steps li.on{background:#4B4D4F;color:#fff;border-color:#4B4D4F}.steps li.done{color:#15803d;border-color:#bbf7d0;background:#f0fdf4}
.err{display:flex;flex-direction:column;gap:4px;background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;padding:13px;border-radius:14px;margin:14px 0}
.note{padding:11px 14px;border-radius:12px;font-size:13px;font-weight:650;margin:14px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.note-info{background:#f0f9ff;border:1px solid #bae6fd;color:#0369a1}.note-ok{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}.note-warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}.note-bad{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.spinner{display:inline-block;width:14px;height:14px;border:2px solid #bae6fd;border-top-color:#0369a1;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}@keyframes spin{to{transform:rotate(360deg)}}
.card{background:#fff;border:1px solid #eaecf0;border-radius:18px;padding:16px;margin-bottom:14px;min-width:0}
.title{display:flex;gap:10px;align-items:flex-start}.title>span{width:30px;height:30px;border-radius:9px;background:#FFF7E0;display:grid;place-items:center;flex-shrink:0;font-weight:800}.title h2{font-size:17px;margin:0}.title p{font-size:12px;color:#667085;margin:3px 0 14px}
.hh{display:flex;justify-content:space-between;gap:12px}.hh>div{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}.hh small{font-size:12px;color:#667085}.hh strong{font-size:20px;color:#4B4D4F;flex-shrink:0}.stars{color:#f59e0b;font-size:12px}
.himg{width:100%;aspect-ratio:16/7;object-fit:cover;border-radius:12px;margin-bottom:12px;background:#eef2f6}
.hd{display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:center;margin:14px 0 10px}.hd>div{display:flex;flex-direction:column}.hd>div b{font-size:14px}.hd>div span{font-size:11px;color:#667085}.hd-nights{background:#f0f9ff;border-radius:99px;padding:5px 12px;font-size:12px;font-weight:800;color:#0369a1;border:1px solid #bae6fd}.hd-end{text-align:right;align-items:flex-end}
.occ{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:6px}.occ li{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:13px;padding:8px 10px;border-radius:10px;background:#f9fafb;border:1px solid #f2f4f7}.occ b{font-size:12px}.occ-room{font-weight:650;color:#344054}.occ li span:last-child{color:#667085}
.receipt{background:#fff;border:1px solid #eaecf0;border-radius:14px;margin:0;text-align:left}.row{display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border-bottom:1px solid #f2f4f7;font-size:14px}.row:last-child{border-bottom:0}.row span{color:#475467}.row-strong b{font-size:17px}
.policy{margin-top:4px}.policy-head{font-size:13px;font-weight:800;margin:0 0 8px}.policy-head.ok{color:#15803d}.policy-head.no{color:#b42318}.policy table{width:100%;border-collapse:collapse;font-size:12px}.policy th{text-align:left;color:#667085;font-weight:700;padding:6px 8px;border-bottom:1px solid #eaecf0}.policy td{padding:7px 8px;border-bottom:1px solid #f2f4f7;vertical-align:top}.policy td:last-child,.policy th:last-child{text-align:right;white-space:nowrap}.policy-note{font-size:11px;color:#98a2b3;margin:8px 0 0}
.hnotes{margin-top:10px;display:flex;flex-direction:column;gap:8px}.hnotes-inc{font-size:12px;color:#475467;margin:0}.hnote{border:1px solid #eaecf0;border-radius:10px;background:#f9fafb;padding:8px 12px}.hnote summary{cursor:pointer;font-size:13px;font-weight:700;color:#344054}.hnote p{margin:6px 0 2px;font-size:12px;line-height:1.55;color:#475467;white-space:pre-line}.hnote-important{background:#fffbeb;border-color:#fde68a}.hnote-important summary{color:#92400e}
.grid{display:grid;grid-template-columns:1fr;gap:12px}.grid label{display:flex;flex-direction:column;gap:6px;font-size:12px;font-weight:700;color:#344054;min-width:0}.grid input,.grid select{height:48px;border:1px solid #d0d5dd;border-radius:12px;padding:0 13px;background:#fff;font-size:16px;min-width:0;width:100%;box-sizing:border-box}.grid input:focus,.grid select:focus{outline:none;border-color:#4B4D4F;box-shadow:0 0 0 3px rgba(75,77,79,.08)}
.chip{display:inline-block;background:#eff6ff;color:#1d4ed8;padding:6px 10px;border-radius:99px;font-size:11px;font-weight:800}.chip-child{background:#fdf4ff;color:#a21caf}
.pax{padding-top:2px}.pax+.pax{border-top:1px solid #f2f4f7;margin-top:16px;padding-top:16px}.pax-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.roomblock+.roomblock{margin-top:18px;padding-top:16px;border-top:2px solid #f2f4f7}.roomblock h3{font-size:14px;margin:0 0 10px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline}.roomblock h3 small{font-weight:600;color:#667085;font-size:12px}
.choice{display:grid;gap:10px}.choice label{display:flex;gap:12px;align-items:flex-start;padding:13px;border:1.5px solid #eaecf0;border-radius:14px;cursor:pointer;background:#fff}.choice label:has(input:checked){border-color:#4B4D4F;background:#fafafa}.choice input{margin-top:3px;width:18px;height:18px;accent-color:#4B4D4F;flex-shrink:0}.choice b{display:block;font-size:14px}.choice small{display:block;color:#667085;font-size:12px;margin-top:2px;line-height:1.45}.choice label.disabled{opacity:.55;cursor:not-allowed}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 18px;border:0;border-radius:12px;background:#4B4D4F;color:#fff;font-size:15px;font-weight:800;cursor:pointer;text-decoration:none}.btn:disabled{opacity:.55;cursor:not-allowed}.btn-light{background:#fff;color:#344054;border:1px solid #d0d5dd}.btn-danger{background:#b42318}
.spacer{height:96px}.pay{position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:1px solid #eaecf0;padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;gap:12px;align-items:center}.pay>div{display:flex;flex-direction:column;min-width:110px}.pay span{font-size:11px;color:#667085}.pay b{font-size:18px}.pay button{flex:1;height:52px;border:0;border-radius:14px;background:#4B4D4F;color:#fff;font-size:16px;font-weight:800;cursor:pointer}.pay button:disabled{opacity:.55}
.status{display:flex;gap:14px;align-items:center}.status-icon{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;font-size:26px;flex-shrink:0}.status h1{font-size:22px;margin:0 0 4px}.status p{margin:0;color:#667085;font-size:14px}
.s-ok .status-icon{background:#dcfce7;color:#15803d}.s-hold .status-icon{background:#fef3c7;color:#b45309}.s-wait .status-icon{background:#e0f2fe;color:#0369a1}.s-bad .status-icon{background:#fee2e2;color:#b91c1c}.s-pay .status-icon{background:#f2f4f7;color:#344054}
.modal{position:fixed;inset:0;z-index:100;background:rgba(16,24,40,.5);display:grid;place-items:center;padding:16px}.modal>div{background:#fff;border-radius:18px;max-width:520px;width:100%;max-height:90vh;overflow:auto;padding:20px}.modal h2{margin:0 0 6px;font-size:19px}.modal .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap}
.cols{display:grid;grid-template-columns:1fr;gap:0 14px}
@media(min-width:640px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.pay{left:50%;transform:translateX(-50%);max-width:980px;border-radius:18px 18px 0 0}}
@media(min-width:900px){.cols{grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)}.cols>aside{position:sticky;top:84px;align-self:start}}`;
