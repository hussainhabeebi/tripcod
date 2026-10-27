"use client";

import { navigateSearch } from "../lib/search-navigation";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  origin: string;
  destination: string;
  departureDate: string;
  fares?: any[];
  journey?: boolean;
  onQueryChange?: (query: string) => void;
};

const AIRPORT_GROUPS = [
  [
    { code: "COK", city: "Kochi" },
    { code: "CCJ", city: "Kozhikode" },
    { code: "CNN", city: "Kannur" },
    { code: "TRV", city: "Thiruvananthapuram" },
  ],
  [
    { code: "DXB", city: "Dubai International" },
    { code: "DWC", city: "Dubai Al Maktoum" },
    { code: "SHJ", city: "Sharjah" },
    { code: "AUH", city: "Abu Dhabi" },
    { code: "RKT", city: "Ras Al Khaimah" },
    { code: "FJR", city: "Fujairah" },
    { code: "AAN", city: "Al Ain" },
  ],
];

function airportOptions(code: string) {
  return AIRPORT_GROUPS.find((group) => group.some((a) => a.code === code)) ?? [{ code, city: code }];
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function moveDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return isoDate(new Date());
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

const RESULT_FILTER_KEYS = ["stops", "depBand", "arrBand", "maxPrice", "maxPriceCurrency", "refundable", "baggage", "airlines"] as const;

const TIME_BANDS = [
  { label: "Early morning", range: "00–06", sub: "12am–6am" },
  { label: "Morning",       range: "06–12", sub: "6am–12pm" },
  { label: "Afternoon",     range: "12–18", sub: "12pm–6pm" },
  { label: "Evening",       range: "18–24", sub: "6pm–12am" },
];

export function ChangeDatesAction() {
  function focusDateControls() {
    if (window.matchMedia("(max-width: 900px)").matches) {
      window.dispatchEvent(new Event("tripcod:open-date-filters"));
    } else {
      document.querySelector<HTMLButtonElement>("#flight-filter-panel .date-switcher button.active, #flight-filter-panel .date-switcher button")?.focus();
    }
  }

  return <button type="button" className="no-results-secondary" onClick={focusDateControls}>Change dates</button>;
}

export default function SearchResultControls({ origin, destination, departureDate, fares = [], journey = false, onQueryChange }: Props) {
  const current = useSearchParams();
  const panelRef = useRef<HTMLElement>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const currentQuery = current.toString();
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const isPending = !mobileOpen && pendingQuery !== null;
  const visible = useMemo(() => new URLSearchParams(pendingQuery ?? currentQuery), [pendingQuery, currentQuery]);
  const today = isoDate(new Date()); // Same UTC day boundary as the homepage search date input.
  const [windowStart, setWindowStart] = useState(() => {
    const centered = moveDate(departureDate, -2);
    return centered < isoDate(new Date()) ? isoDate(new Date()) : centered;
  });

  useEffect(() => { setPendingQuery(null); }, [currentQuery]);
  useEffect(() => {
    setWindowStart((start) => {
      if (departureDate >= start && departureDate <= moveDate(start, 4)) return start;
      const centered = moveDate(departureDate, -2);
      return centered < today ? today : centered;
    });
  }, [departureDate, today]);

  useEffect(() => {
    const openDates = () => setMobileOpen(true);
    window.addEventListener("tripcod:open-date-filters", openDates);
    return () => window.removeEventListener("tripcod:open-date-filters", openDates);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLButtonElement>(".filter-close")?.focus();
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setMobileOpen(false); setPendingQuery(null); }
      if (e.key !== "Tab") return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? []).filter((el) => el.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    };
    const resize = () => { if (window.innerWidth > 900) setMobileOpen(false); };
    document.addEventListener("keydown", close); window.addEventListener("resize", resize);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", close); window.removeEventListener("resize", resize); previous?.focus(); };
  }, [mobileOpen]);

  function navigate(query: string) {
    if (onQueryChange) onQueryChange(query);
    else navigateSearch(`/search?${query}`);
  }

  function update(updates: Record<string, string | null>) {
    const next = new URLSearchParams(pendingQuery ?? currentQuery);
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    });
    next.delete("all");
    setPendingQuery(next.toString());
    if (!mobileOpen) navigate(next.toString());
  }

  function closeFilters() { setMobileOpen(false); setPendingQuery(null); }

  function resetFilters() {
    if (RESULT_FILTER_KEYS.some((key) => visible.has(key))) {
      update(Object.fromEntries(RESULT_FILTER_KEYS.map((key) => [key, null])));
    }
  }

  const dates = [0, 1, 2, 3, 4].map((offset) => new Date(`${moveDate(windowStart, offset)}T12:00:00Z`));

  const stops       = visible.get("stops");
  const refundable  = visible.get("refundable") === "1";
  const baggage     = visible.get("baggage") === "1";
  const depBand     = visible.get("depBand");
  const arrBand = visible.get("arrBand");
  const fareCurrencies = [...new Set(fares.map((f) => f.currency))];
  const prices = fares.map((f) => Number(f.displayPrice ?? f.totalFare)).filter((n) => Number.isFinite(n) && n > 0);
  const priceCurrency = fareCurrencies.length === 1 ? fareCurrencies[0] : null;
  const priceFilterSupported = priceCurrency && prices.length > 0 && (!visible.get("currency") || visible.get("currency") === priceCurrency);
  const maxPrice = visible.get("maxPrice") ?? "";
  const airlines    = (visible.get("airlines") ?? "").split(",").filter(Boolean);

  // Derive unique airlines from fares
  const uniqueAirlines = useMemo(() => {
    const seen = new Map<string, { name: string; count: number }>();
    for (const f of fares) {
      const names = journey ? [...new Set([f.airlineName, ...(f.segments ?? []).map((s: any) => s.airlineName)].filter(Boolean))] : [f.airlineName].filter(Boolean);
      for (const name of names) {
        const existing = seen.get(name);
        if (existing) existing.count++;
        else seen.set(name, { name, count: 1 });
      }
    }
    return [...seen.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  }, [fares, journey]);

  function toggleAirline(name: string) {
    const next = airlines.includes(name) ? airlines.filter((a) => a !== name) : [...airlines, name];
    update({ airlines: next.length ? next.join(",") : null });
  }

  return (
    <>
    <button type="button" className="mobile-filter-toggle" aria-expanded={mobileOpen} aria-controls="flight-filter-panel" onClick={() => setMobileOpen(true)}>
      <span aria-hidden="true">☷</span> Filters
    </button>
    {mobileOpen && <button type="button" className="filter-backdrop" aria-label="Close filters" onClick={closeFilters} />}
    <aside ref={panelRef} role={mobileOpen ? "dialog" : undefined} aria-modal={mobileOpen ? true : undefined} id="flight-filter-panel" className={`filter-sidebar${mobileOpen ? " open" : ""}`} aria-label="Flight filters">
      <div className="mobile-sort-options filter-section"><div className="filter-section-label">Sort flights</div><div className="stops-btn-row">
        {[['best','Recommended'],['price','Cheapest'],['duration','Fastest']].map(([value,label]) => <button key={value} type="button" className={`stops-btn${(visible.get("sort") ?? "best") === value ? " active" : ""}`} aria-pressed={(visible.get("sort") ?? "best") === value} onClick={() => update({sort:value})}>{label}</button>)}
      </div></div>
      {/* Date strip */}
      <div className="filter-sidebar-title">
        <span>Filters</span>
        <div className="filter-sidebar-actions">
          <a href="#" onClick={(e) => { e.preventDefault(); resetFilters(); }}>Reset all</a>
          <button type="button" className="filter-close" aria-label="Close filters" onClick={closeFilters}>×</button>
        </div>
      </div>

      {isPending && <div className="result-refresh" role="status"><span /> Updating flights…</div>}
      {journey && <p style={{ fontSize: 12, lineHeight: 1.5, color: "#667085" }}>Stops, times and airlines apply to each leg. Price limits apply per leg, or to the whole combined fare. <a href="/">Change journey dates &amp; airports</a></p>}
      {!journey && <>
      <div className="filter-section-label">Travel dates</div>
      <div className="date-navigation">
        <button type="button" className="date-range-arrow" aria-label="Previous travel dates" disabled={windowStart <= today} onClick={() => setWindowStart(moveDate(windowStart, -1))}>‹</button>
        <div className="date-switcher" aria-label="Choose departure date">
          {dates.map((date) => {
            const value = isoDate(date);
            const active = value === (visible.get("departureDate") ?? departureDate);
            return (
              <button key={value} type="button" className={active ? "active" : ""} aria-pressed={active} disabled={value < today} onClick={() => !active && update({ departureDate: value })}>
                <span>{date.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" })}</span>
                <strong>{date.toLocaleDateString("en", { day: "numeric", month: "short", timeZone: "UTC" })}</strong>
              </button>
            );
          })}
        </div>
        <button type="button" className="date-range-arrow" aria-label="Next travel dates" onClick={() => setWindowStart(moveDate(windowStart, 1))}>›</button>
      </div>

      {/* Nearby airports */}
      <div className="filter-section">
        <div className="filter-section-label">Airports</div>
        <div className="result-tool-row" style={{ marginTop: 0 }}>
          <label className="airport-select">
            <span>From</span>
            <select value={origin} onChange={(e) => update({ origin: e.target.value })}>
              {airportOptions(origin).map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
            </select>
          </label>
          <button className="result-swap" type="button" aria-label="Swap airports" onClick={() => update({ origin: destination, destination: origin })}>⇄</button>
          <label className="airport-select">
            <span>To</span>
            <select value={destination} onChange={(e) => update({ destination: e.target.value })}>
              {airportOptions(destination).map((a) => <option key={a.code} value={a.code}>{a.city} ({a.code})</option>)}
            </select>
          </label>
        </div>
      </div>

      </>}

      {/* Stops */}
      <div className="filter-section">
        <div className="filter-section-label">Stops</div>
        <div className="stops-btn-row">
          {([{ label: "Any", val: null }, { label: "Nonstop", val: "0" }, { label: "1 stop", val: "1" }] as const).map(({ label, val }) => (
            <button
              key={label} type="button"
              aria-pressed={stops === val || (val === null && !stops)} className={`stops-btn${stops === val || (val === null && !stops) ? " active" : ""}`}
              onClick={() => update({ stops: val })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Departure time */}
      <div className="filter-section">
        <div className="filter-section-label">Departure time</div>
        <div className="time-bands">
          {TIME_BANDS.map((band) => (
            <button
              key={band.range} type="button"
              aria-pressed={depBand === band.range} className={`time-band${depBand === band.range ? " active" : ""}`}
              onClick={() => update({ depBand: depBand === band.range ? null : band.range })}
            >
              <span className="time-band-title">{band.label}</span>
              {band.sub}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-section"><div className="filter-section-label">Arrival time</div><div className="time-bands">
        {TIME_BANDS.map((band) => <button key={band.range} type="button" className={`time-band${arrBand === band.range ? " active" : ""}`} aria-pressed={arrBand === band.range} onClick={() => update({arrBand:arrBand === band.range ? null : band.range})}><span className="time-band-title">{band.label}</span>{band.sub}</button>)}
      </div></div>
      {priceFilterSupported && <div className="filter-section"><label className="filter-section-label" htmlFor="flight-max-price">Maximum total · {priceCurrency}</label><select id="flight-max-price" className="search-input" value={maxPrice} onChange={(e) => update({maxPrice:e.target.value || null, maxPriceCurrency:e.target.value ? priceCurrency : null})}><option value="">Any price</option>{[...new Set(prices)].sort((a,b)=>a-b).map((amount) => <option key={amount} value={amount}>Up to {amount.toLocaleString()} {priceCurrency}</option>)}</select></div>}
      {/* Fare options */}
      <div className="filter-section">
        <div className="filter-section-label">Fare options</div>
        <label className="filter-option">
          <input type="checkbox" checked={refundable} onChange={() => update({ refundable: refundable ? null : "1" })} />
          Refundable only
        </label>
        <label className="filter-option">
          <input type="checkbox" checked={baggage} onChange={() => update({ baggage: baggage ? null : "1" })} />
          Includes checked baggage
        </label>
      </div>

      {/* Airlines */}
      {uniqueAirlines.length > 0 && (
        <div className="filter-section">
          <div className="filter-section-label">Airlines</div>
          {uniqueAirlines.map(({ name, count }) => (
            <label key={name} className="filter-option">
              <input type="checkbox" checked={airlines.includes(name)} onChange={() => toggleAirline(name)} />
              {name}
              <span className="filter-option-badge">{count}</span>
            </label>
          ))}
        </div>
      )}

      <button type="button" className="filter-apply" onClick={() => { if (pendingQuery !== null) { setMobileOpen(false); navigate(pendingQuery); } else closeFilters(); }}>Show flights</button>
    </aside>
    </>
  );
}
