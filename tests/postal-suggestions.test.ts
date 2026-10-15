import { afterEach, expect, it, vi } from "vitest";
import { postalLookupCode, canadianProvince, autoFillPostalAddress } from "../src/lib/postal-suggestion-types";
import { addressSchema, shipmentSchema } from "../src/lib/schemas";
import { postalSuggestions } from "../src/lib/postal-suggestions";
afterEach(() => vi.unstubAllGlobals());
it("uses Canadian postal areas and US ZIPs without guessing ambiguous Canadian territories", () => {
  expect(postalLookupCode("CA", "v6b 1a1")).toBe("V6B");
  expect(postalLookupCode("US", "98101-1234")).toBe("98101");
  expect(postalLookupCode("CA", "V6B")).toBeNull();
  expect(postalLookupCode("US", "9810")).toBeNull();
  expect(postalLookupCode("GB", "SW1A1AA")).toBeNull();
  expect(canadianProvince("V6B1A1")).toBe("BC");
  expect(canadianProvince("M5V2T6")).toBe("ON");
  expect(canadianProvince("X0A0H0")).toBeNull();
});
it("deduplicates city names and caches Canadian area results across complete postal codes", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ "country abbreviation": "CA", "post code": "V6B", places: [{ "place name": "Vancouver (Downtown)", "state abbreviation": "BC" }, { "place name": "Vancouver (Yaletown)", "state abbreviation": "BC" }] })));
  vi.stubGlobal("fetch", fetchMock);
  expect(await postalSuggestions({ country: "CA", postalCode: "V6B1A1" })).toMatchObject({ precision: "area", lookupCode: "V6B", suggestions: [{ city: "Vancouver", region: "BC" }] });
  await postalSuggestions({ country: "CA", postalCode: "V6B2B2" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("https://api.zippopotam.us/ca/V6B");
});
it("provides manual entry fallback when the provider is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
  expect(await postalSuggestions({ country: "CA", postalCode: "V7A1A1" })).toMatchObject({ suggestions: [], message: expect.stringContaining("manually") });
});
it("rejects provider results for a different country or postal area", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ "country abbreviation": "US", "post code": "M5V", places: [{ "place name": "Wrong city", "state abbreviation": "ON" }] }))));
  expect((await postalSuggestions({ country: "CA", postalCode: "M5V2T6" })).suggestions).toEqual([]);
});
it("validates requests before contacting the provider", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(postalSuggestions({ country: "CA", postalCode: "../../private" })).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("auto fills one city and province while preserving the entered postal code and other address edits", () => {
  const entered = shipmentSchema.parse({ ship_from: { city: "Wrong city", region: "ON", postal_code: "V6V2K9" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" }, shipDate: "2026-10-14", packages: [{ length: 1, width: 1, height: 1, dimensionUnit: "cm", weight: 1, weightUnit: "kg" }] }).ship_from;
  const result = { country: "CA" as const, lookupCode: "V6V", precision: "area" as const, suggestions: [{ city: "Richmond", region: "BC" }], message: null };
  expect(autoFillPostalAddress({ ...entered, address_line1: "New street" }, entered, result)).toMatchObject({ city: "Richmond", region: "BC", postal_code: "V6V2K9", address_line1: "New street" });
  expect(autoFillPostalAddress({ ...entered, city: "Manual city", region: "AB" }, entered, result)).toMatchObject({ city: "Manual city", region: "AB" });
  expect(autoFillPostalAddress({ ...entered, postal_code: "M5V2T6" }, entered, result).city).toBe("Wrong city");
  expect(autoFillPostalAddress(entered, entered, { ...result, lookupCode: "M5V" }).city).toBe("Wrong city");
  expect(autoFillPostalAddress(entered, entered, { ...result, suggestions: [{ city: "Richmond", region: "BC" }, { city: "Vancouver", region: "BC" }] })).toMatchObject({ city: "Wrong city", region: "BC" });
  expect(autoFillPostalAddress(entered, entered, { ...result, suggestions: [] })).toMatchObject({ city: "Wrong city", region: "BC" });
});

it("uses the Richmond municipality name instead of the postal-area neighbourhood name", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ "country abbreviation": "CA", "post code": "V6V", places: [{ "place name": "Richmond Northeast", "state abbreviation": "BC" }] }))));
  expect((await postalSuggestions({ country: "CA", postalCode: "V6V2K9" })).suggestions).toEqual([{ city: "Richmond", region: "BC" }]);
});
it("rejects a phone number in the city field while allowing numeric city names", () => {
  const address = { city: "6042449912", region: "BC", postal_code: "V6V2K9" };
  expect(addressSchema.safeParse(address).success).toBe(false);
  expect(addressSchema.safeParse({ ...address, city: "100 Mile House" }).success).toBe(true);
});
