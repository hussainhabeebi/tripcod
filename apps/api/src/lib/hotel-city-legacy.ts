// Bounded streaming reader for the existing { cities, pages, count, cursor } JSON.
// Metadata may precede or follow cities. Never call json()/text() on the catalogue.
export const CITY_SHARD_MAX_BYTES = 2 * 1024 * 1024;
const TOKEN_MAX = 128 * 1024;
const invalid = (message: string) => Object.assign(new Error(message), { code: "SYNC_CHECKPOINT_INVALID" });
export async function scanLegacyCities(
  object: { body: ReadableStream<Uint8Array> },
  onCity: (name: string, rows: [number, string][]) => void,
) {
  const reader = object.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const metadata: Record<string, unknown> = {};
  let scope: "root" | "cities" = "root";
  let stage: "start" | "key" | "colon" | "value" | "delimiter" | "end" = "start";
  let key = "", token = "", quoted = false, escaped = false, depth = 0, collecting = false;
  let cityCount = 0, sawCities = false, allowClose = true;
  function finishValue() {
    const value: unknown = JSON.parse(token);
    if (scope === "cities") {
      if (!Array.isArray(value) || !value.every((row) => Array.isArray(row) && row.length === 2 && Number.isSafeInteger(row[0]) && row[0] > 0 && typeof row[1] === "string")) throw invalid("Invalid saved city rows; original checkpoint retained.");
      onCity(key, value as [number, string][]); cityCount++;
    } else {
      if (!["pages", "count", "cursor", "builtAt"].includes(key)) throw invalid("Unknown legacy checkpoint field; inspect without resetting.");
      if (Object.hasOwn(metadata, key)) throw invalid("Duplicate checkpoint metadata.");
      metadata[key] = value;
    }
    token = ""; collecting = false; stage = "delimiter";
  }
  function consume(text: string) {
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (stage === "end") { if (!/\s/.test(c)) throw invalid("Trailing checkpoint data."); continue; }
      if (stage === "start") { if (/\s/.test(c)) continue; if (c !== "{") throw invalid("Invalid checkpoint object."); stage = "key"; continue; }
      if (stage === "key") {
        if (!collecting) {
          if (/\s/.test(c)) continue;
          if (c === "}" && allowClose) {
            if (scope === "cities") { scope = "root"; stage = "delimiter"; } else stage = "end";
            continue;
          }
          if (c !== '"') throw invalid("Invalid checkpoint key.");
          collecting = true; token = c; escaped = false; continue;
        }
        token += c;
        if (token.length > TOKEN_MAX) throw invalid("Saved city name exceeds the safe limit.");
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') { key = JSON.parse(token); token = ""; collecting = false; stage = "colon"; }
        continue;
      }
      if (stage === "colon") { if (/\s/.test(c)) continue; if (c !== ":") throw invalid("Invalid checkpoint separator."); stage = "value"; continue; }
      if (stage === "delimiter") {
        if (/\s/.test(c)) continue;
        if (c === ",") { stage = "key"; allowClose = false; continue; }
        if (c === "}") { if (scope === "cities") { scope = "root"; } else stage = "end"; continue; }
        throw invalid("Invalid checkpoint delimiter.");
      }
      if (!collecting) {
        if (/\s/.test(c)) continue;
        if (scope === "root" && key === "cities") {
          if (sawCities || c !== "{") throw invalid("Invalid cities object.");
          sawCities = true; scope = "cities"; stage = "key"; allowClose = true; continue;
        }
        collecting = true; quoted = false; escaped = false; depth = 0;
      }
      // Scalar metadata ends before its delimiter; nested city arrays end at ].
      if (!quoted && depth === 0 && token && (c === "," || c === "}" || /\s/.test(c))) { finishValue(); i--; continue; }
      token += c;
      if (token.length > TOKEN_MAX) throw invalid("A saved city entry exceeds the safe streaming limit; checkpoint retained.");
      if (quoted) { if (escaped) escaped = false; else if (c === "\\") escaped = true; else if (c === '"') quoted = false; }
      else if (c === '"') quoted = true;
      else if (c === "[" || c === "{") depth++;
      else if (c === "]" || c === "}") { if (--depth < 0) throw invalid("Invalid checkpoint nesting."); }
      if (!quoted && depth === 0 && (c === "]" || c === "}" || c === '"')) finishValue();
    }
  }
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; consume(decoder.decode(chunk.value, { stream: true })); }
    consume(decoder.decode());
    if ((stage as string) !== "end" || !sawCities) throw invalid("Truncated legacy checkpoint; original retained.");
    return { ...metadata, cityCount } as { pages?: number; count?: number; cursor?: string; cityCount: number };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
