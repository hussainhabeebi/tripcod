// Supplier timestamps carry airport-local clock values. Preserve those values;
// converting them to the server/browser timezone changes what the traveller sees.
export function flightClock(value?: string): string {
  return value?.match(/T(\d{2}:\d{2})/)?.[1] ?? "--:--";
}
export function flightHour(value?: string): number | null {
  const clock = flightClock(value);
  return clock === "--:--" ? null : Number(clock.slice(0, 2));
}
export function flightDay(value?: string): string {
  return value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}
