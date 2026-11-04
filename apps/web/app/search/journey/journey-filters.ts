import { flightHour } from "../../lib/flight-clock";
import { rankRecommended } from "../../lib/flight-ranking";

type Segment = { origin: string; destination: string; departureTime: string; arrivalTime: string; duration: number; airlineName?: string };
type Fare = { id: string; airlineName: string; departureTime: string; arrivalTime: string; stops: number; duration: number; currency: string; totalFare: number; displayPrice?: number; isRefundable: boolean; baggage?: { checked?: string }; tripKey?: string; segments?: Segment[] };
type Leg = { origin: string; destination: string };

export function journeyLegSegments(fare: Fare, legs: Leg[]): Segment[][] {
  if (fare.tripKey !== "COMBO") return fare.segments?.length ? [fare.segments] : [];
  const groups: Segment[][] = [];
  let cursor = 0;
  for (const leg of legs) {
    const group: Segment[] = [];
    if (fare.segments?.[cursor]?.origin !== leg.origin) return [];
    while (cursor < (fare.segments?.length ?? 0)) {
      const segment = fare.segments![cursor++];
      group.push(segment);
      if (segment.destination === leg.destination) break;
    }
    if (group.at(-1)?.destination !== leg.destination) return [];
    groups.push(group);
  }
  return cursor === fare.segments?.length ? groups : [];
}

export function filterJourneyFares<T extends Fare>(fares: T[], query: URLSearchParams, legs: Leg[]): T[] {
  const carriers = (query.get("airlines") ?? "").split(",").filter(Boolean);
  const inBand = (value: string, band: string | null) => {
    if (!band) return true;
    const hour = flightHour(value);
    const [start, end] = band.split("–").map(Number);
    return hour !== null && hour >= start && hour < end;
  };
  const stop = query.get("stops");
  const filtered = fares.filter((fare) => {
    if (query.get("refundable") === "1" && !fare.isRefundable) return false;
    if (query.get("baggage") === "1" && !fare.baggage?.checked?.trim()) return false;
    const max = Number(query.get("maxPrice"));
    if (query.get("maxPrice") && Number.isFinite(max) && query.get("maxPriceCurrency") === fare.currency
      && (!query.get("currency") || query.get("currency") === fare.currency) && (fare.displayPrice ?? fare.totalFare) > max) return false;
    const groups = journeyLegSegments(fare, legs);
    const checks = fare.tripKey === "COMBO" ? groups.map((segments) => ({
      stops: segments.length - 1, departureTime: segments[0].departureTime,
      arrivalTime: segments.at(-1)!.arrivalTime, airlines: segments.map((s) => s.airlineName ?? fare.airlineName),
    })) : [{ ...fare, airlines: fare.segments?.length ? fare.segments.map((s) => s.airlineName ?? fare.airlineName) : [fare.airlineName] }];
    if (!checks.length && (stop === "0" || stop === "1" || query.get("depBand") || query.get("arrBand") || carriers.length)) return false;
    return checks.every((leg) => (!(stop === "0" || stop === "1") || leg.stops === Number(stop))
      && inBand(leg.departureTime, query.get("depBand")) && inBand(leg.arrivalTime, query.get("arrBand"))
      && (!carriers.length || leg.airlines.every((name) => carriers.includes(name))));
  });
  const duration = (f: T) => f.tripKey === "COMBO" && f.segments?.length ? f.segments.every((s) => Number.isFinite(s.duration) && s.duration > 0) ? f.segments.reduce((n, s) => n + s.duration, 0) : Infinity : f.duration;
  const metric = (f: T) => query.get("sort") === "duration" ? duration(f) : query.get("sort") === "departure" ? Date.parse(f.departureTime) : f.displayPrice ?? f.totalFare;
  if (!query.get("sort") || query.get("sort") === "best") {
    return rankRecommended(filtered.map((fare) => ({ ...fare, duration: duration(fare), original: fare }))).map((f) => f.original);
  }
  return [...filtered].sort((a, b) => metric(a) - metric(b));
}

export function visibleJourneyPicks<T extends { id: string; fareIdentifier?: string; sri?: string; msri?: string[] }>(saved: Record<string, T>, groups: Record<string, T[]>): Record<string, T> {
  const picked = Object.fromEntries(Object.entries(saved).filter(([key, fare]) => groups[key]?.some((f) => f.id === fare.id)));
  const onward = picked.ONWARD, back = picked.RETURN;
  if (back && (onward ? onward.fareIdentifier === "SPECIAL_RETURN"
    ? back.fareIdentifier !== "SPECIAL_RETURN" || !onward.sri || !back.msri?.includes(onward.sri)
    : back.fareIdentifier === "SPECIAL_RETURN" : back.fareIdentifier === "SPECIAL_RETURN")) delete picked.RETURN;
  return picked;
}
