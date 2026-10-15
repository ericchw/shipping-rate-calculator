import { z } from "zod";
import type { Address } from "./schemas";
export const normalizePostalCode = (value: string) => value.trim().replace(/\s/g, "").toUpperCase();
export function postalLookupCode(country: string, postalCode: string) {
  const code = normalizePostalCode(postalCode);
  if (country === "CA" && /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/.test(code)) return code.slice(0, 3);
  if (country === "US" && /^\d{5}(-\d{4})?$/.test(code)) return code.slice(0, 5);
  return null;
}
export const postalLookupSchema = z.object({
  country: z.enum(["CA", "US"]),
  postalCode: z.string().max(20),
}).strict().superRefine((input, context) => {
  if (!postalLookupCode(input.country, input.postalCode)) context.addIssue({ code: "custom", path: ["postalCode"], message: "Enter a complete Canadian postal code or US ZIP code" });
});
export type PostalSuggestion = { city: string; region: string };
export type PostalSuggestions = {
  country: "CA" | "US";
  lookupCode: string;
  precision: "area" | "postal";
  suggestions: PostalSuggestion[];
  message: string | null;
};
// Canada Post FSA first-character mapping. X spans NT and NU, so do not guess it.
export function canadianProvince(postalCode: string) {
  const provinces: Record<string, string> = { A: "NL", B: "NS", C: "PE", E: "NB", G: "QC", H: "QC", J: "QC", K: "ON", L: "ON", M: "ON", N: "ON", P: "ON", R: "MB", S: "SK", T: "AB", V: "BC", Y: "YT" };
  return postalLookupCode("CA", postalCode) ? provinces[normalizePostalCode(postalCode)[0]] ?? null : null;
}

export function autoFillPostalAddress(current: Address, entered: Address, result: PostalSuggestions) {
  if (current.country_code !== entered.country_code || normalizePostalCode(current.postal_code) !== normalizePostalCode(entered.postal_code) || result.country !== current.country_code || result.lookupCode !== postalLookupCode(current.country_code, current.postal_code)) return current;
  const city = result.suggestions.length === 1 ? result.suggestions[0].city : null;
  const regions = [...new Set(result.suggestions.map((suggestion) => suggestion.region))];
  const region = regions.length === 1 ? regions[0] : current.country_code === "CA" ? canadianProvince(current.postal_code) : null;
  return { ...current,
    city: city && current.city === entered.city ? city : current.city,
    region: region && current.region === entered.region ? region : current.region,
  };
}
