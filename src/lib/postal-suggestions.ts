import "server-only";
import { z } from "zod";
import { postalLookupSchema, postalLookupCode, type PostalSuggestions } from "./postal-suggestion-types";
import { request } from "./carriers/transport";
const cache = new Map<string, { value: PostalSuggestions; expires: number }>();
const pending = new Map<string, Promise<PostalSuggestions>>();
const responseSchema = z.object({
  "country abbreviation": z.string(), "post code": z.string(),
  places: z.array(z.object({ "place name": z.string().max(200), "state abbreviation": z.string().regex(/^[A-Z]{2}$/) })).max(500),
});
export async function postalSuggestions(input: unknown): Promise<PostalSuggestions> {
  const parsed = postalLookupSchema.parse(input);
  const lookupCode = postalLookupCode(parsed.country, parsed.postalCode)!;
  const key = `${parsed.country}:${lookupCode}`;
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  const running = pending.get(key);
  if (running) return running;
  const work = (async () => {
    const result: PostalSuggestions = { country: parsed.country, lookupCode, precision: parsed.country === "CA" ? "area" : "postal", suggestions: [], message: null };
    try {
      const data = responseSchema.parse(JSON.parse(await request(`https://api.zippopotam.us/${parsed.country.toLowerCase()}/${lookupCode}`, { headers: { Accept: "application/json" } }, AbortSignal.timeout(6000), 1)));
      if (data["country abbreviation"] !== parsed.country || data["post code"].toUpperCase() !== lookupCode) throw new Error("Postal lookup mismatch");
      result.suggestions = [...new Map(data.places.map((place) => {
        const areaName = place["place name"].replace(/\s*\([^)]*\)/g, "").trim();
        // This Canadian FSA name includes the neighbourhood, rather than only the municipality.
        const city = parsed.country === "CA" && place["state abbreviation"] === "BC" && areaName === "Richmond Northeast" ? "Richmond" : areaName;
        const region = place["state abbreviation"];
        return [`${city.toLowerCase()}:${region}`, { city, region }] as const;
      }).filter(([, suggestion]) => suggestion.city)).values()].slice(0, 20);
      if (!result.suggestions.length) result.message = "No city suggestions found. Enter the city and province / state manually.";
    } catch {
      result.message = "City suggestions are unavailable for this postal code. You can enter the address manually.";
    }
    if (cache.size >= 1000) cache.delete(cache.keys().next().value!);
    cache.set(key, { value: result, expires: Date.now() + (result.suggestions.length ? 86400000 : 300000) });
    return result;
  })();
  pending.set(key, work);
  try { return await work; } finally { pending.delete(key); }
}
