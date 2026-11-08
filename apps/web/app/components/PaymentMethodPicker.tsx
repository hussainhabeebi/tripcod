"use client";

// Card (Nomod) or UPI / cards / netbanking (PhonePe), as enabled in Admin.
// Renders nothing when only one gateway is available.

import { useEffect, useState } from "react";

export type OnlineGateway = "NOMOD" | "PHONEPE";
type Options = { gateways: Record<OnlineGateway, boolean>; phonepeEnvironment: string | null };

const API = process.env.NEXT_PUBLIC_API_URL ?? "https://api.tripcod.com";

export function usePaymentOptions(): Options | null {
  const [opts, setOpts] = useState<Options | null>(null);
  useEffect(() => {
    fetch(`${API}/api/checkout/payment-options`, { headers: { "x-tenant-slug": "tripcod" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setOpts(d ?? { gateways: { NOMOD: true, PHONEPE: false }, phonepeEnvironment: null }))
      .catch(() => setOpts({ gateways: { NOMOD: true, PHONEPE: false }, phonepeEnvironment: null }));
  }, []);
  return opts;
}

// PhonePe takes INR only.
export function availableGateways(opts: Options | null, currency: string): OnlineGateway[] {
  const g = opts?.gateways ?? { NOMOD: true, PHONEPE: false };
  return (["PHONEPE", "NOMOD"] as const).filter((k) => g[k] && (k !== "PHONEPE" || currency === "INR"));
}

export default function PaymentMethodPicker({ options, currency, value, onChange }: {
  options: Options | null; currency: string; value: OnlineGateway; onChange: (g: OnlineGateway) => void;
}) {
  const list = availableGateways(options, currency);
  useEffect(() => { if (list.length && !list.includes(value)) onChange(list[0]); }, [list.join(","), value]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list.length < 2) return null;
  const label: Record<OnlineGateway, { title: string; sub: string }> = {
    PHONEPE: { title: "UPI, cards & netbanking", sub: `PhonePe${options?.phonepeEnvironment === "UAT" ? " · test mode" : ""}` },
    NOMOD:   { title: "Card, Apple Pay & instalments", sub: "Nomod" },
  };
  return (
    <fieldset style={{ border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 12px", margin: "0 0 12px" }}>
      <legend style={{ fontSize: 13, fontWeight: 700, color: "#334155", padding: "0 4px" }}>Pay with</legend>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {list.map((g) => (
          <label key={g} style={{ flex: "1 1 180px", display: "flex", gap: 8, alignItems: "center", cursor: "pointer", border: `1.5px solid ${value === g ? "#4B4D4F" : "#e2e8f0"}`, borderRadius: 10, padding: "10px 12px", background: "#fff" }}>
            <input type="radio" name="payment-gateway" value={g} checked={value === g} onChange={() => onChange(g)} />
            <span><b style={{ display: "block", fontSize: 14 }}>{label[g].title}</b><small style={{ color: "#64748b" }}>{label[g].sub}</small></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
