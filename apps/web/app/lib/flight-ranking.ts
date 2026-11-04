type RankableFare = { id?: string; displayPrice?: number; totalFare?: number; duration?: number; stops?: number };
// UI comparison only. Does not alter prices or supplier booking eligibility.
export function rankRecommended<T extends RankableFare>(fares: T[]): T[] {
  const price = (f: T) => Number(f.displayPrice ?? f.totalFare);
  const duration = (f: T) => Number(f.duration);
  const prices = fares.map(price).filter(Number.isFinite);
  const durations = fares.map(duration).filter(Number.isFinite);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const minD = Math.min(...durations), maxD = Math.max(...durations);
  const relative = (n: number, min: number, max: number) => Number.isFinite(n) ? (n - min) / Math.max(1, max - min) : 1;
  const score = (f: T) => relative(price(f), minP, maxP) * .62 + relative(duration(f), minD, maxD) * .28 + (Number.isFinite(f.stops) ? Math.max(0, f.stops!) : 1) * .1;
  return [...fares].sort((a, b) => score(a) - score(b));
}
