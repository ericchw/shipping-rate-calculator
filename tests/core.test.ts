import { describe, it, expect, afterEach, vi } from "vitest";
import { convert, nextBusinessDay } from "../src/lib/units";
import { addressSchema, shipmentSchema } from "../src/lib/schemas";
import { difference, compare } from "../src/lib/quote-service";
import {
  allowedModes,
  assertMode,
  carrierConfig,
  configured,
} from "../src/lib/config";
import { xml } from "../src/lib/carriers/transport";
import {
  canadaPostRequest,
  parseCanadaPost,
} from "../src/lib/carriers/canada-post";
import { fedexRequest, parseFedex } from "../src/lib/carriers/fedex";
import { unavailableEta, type Quote } from "../src/lib/carriers/types";
const address = {
  city: "Vancouver",
  region: "BC",
  postal_code: "V6B 1A1",
  country_code: "CA",
};
export const shipment = () =>
  shipmentSchema.parse({
    ship_from: address,
    ship_to: {
      ...address,
      city: "Toronto",
      region: "ON",
      postal_code: "M5V 2T6",
    },
    shipDate: "2026-10-13",
    packages: [
      {
        length: 30,
        width: 20,
        height: 15,
        dimensionUnit: "cm",
        weight: 2.5,
        weightUnit: "kg",
      },
    ],
    coverageAmount: 500,
    signatureRequired: true,
  });
const quote: Quote = {
  serviceCode: "TEST",
  serviceName: "Test",
  variant: "test",
  total: "0.10",
  currency: "CAD",
  taxIncluded: true,
  eta: unavailableEta,
  breakdown: [],
  notices: [],
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("shipment normalization", () => {
  it("converts exact units and round trips", () => {
    expect(convert(1, "in", "cm")).toBe(2.54);
    expect(convert(1, "lb", "kg")).toBe(0.45359237);
    expect(convert(convert(2.5, "kg", "lb"), "lb", "kg")).toBeCloseTo(2.5, 12);
  });
  it("uses Vancouver weekdays across UTC boundary", () => {
    expect(nextBusinessDay(new Date("2026-10-10T02:00:00Z"))).toBe(
      "2026-10-12",
    );
  });
  it("normalizes postal codes and preserves ZIP zeros", () => {
    expect(addressSchema.parse(address).postal_code).toBe("V6B1A1");
    expect(
      addressSchema.parse({
        ...address,
        country_code: "US",
        postal_code: "00501",
      }).postal_code,
    ).toBe("00501");
    expect(
      addressSchema.safeParse({ ...address, postal_code: "D1D1D1" }).success,
    ).toBe(false);
  });
  it("rejects nonfinite weight, impossible dates, unknown fields, and multiple packages", () => {
    const s = shipment();
    expect(
      shipmentSchema.safeParse({ ...s, shipDate: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      shipmentSchema.safeParse({
        ...s,
        packages: [s.packages[0], s.packages[0]],
      }).success,
    ).toBe(false);
    expect(
      shipmentSchema.safeParse({
        ...s,
        packages: [{ ...s.packages[0], weight: Infinity }],
      }).success,
    ).toBe(false);
    expect(
      shipmentSchema.safeParse({ ...s, user_id: "injected" }).success,
    ).toBe(false);
  });
});
describe("coverage matching", () => {
  it("subtracts decimal values safely", () =>
    expect(difference(quote, { ...quote, total: "0.30" })).toBe("0.20"));
  it("refuses currency and tax mismatches", () => {
    expect(difference(quote, { ...quote, currency: "USD" })).toBeNull();
    expect(difference(quote, { ...quote, taxIncluded: false })).toBeNull();
    expect(difference(quote)).toBeNull();
  });
  it("returns explicitly marked fixtures across carriers", async () => {
    vi.stubEnv("MOCK_CARRIERS", "true");
    vi.stubEnv("APP_ENV", "development");
    const result = await compare(shipment());
    expect(result.results).toHaveLength(12);
    for (const carrier of ["canada_post", "loomis", "fedex"])
      expect(result.results.filter((row) => row.carrier === carrier)).toHaveLength(4);
    expect(
      result.results.every(
        (r) =>
          r.source === "mock" &&
          r.mode === "sandbox" &&
          r.signature.requested &&
          r.withCoverage.available,
      ),
    ).toBe(true);
    expect(result.results[0].coverageDifference).toBe("4.00");
  });
  it("uses destination-specific mock services for US and international shipments", async () => {
    vi.stubEnv("MOCK_CARRIERS", "true");
    vi.stubEnv("APP_ENV", "development");
    const s = shipment();
    const us = await compare({ ...s, ship_to: { ...s.ship_to, country_code: "US", postal_code: "98101" } });
    expect(us.results.some((row) => row.serviceName === "Xpresspost – USA")).toBe(true);
    expect(us.results.some((row) => row.serviceName === "FedEx International Ground")).toBe(true);
    expect(us.results.some((row) => row.serviceCode.startsWith("DOM."))).toBe(false);
    const international = await compare({ ...s, ship_to: { ...s.ship_to, country_code: "GB", postal_code: "SW1A1AA" } });
    expect(international.results.some((row) => row.serviceName === "Xpresspost – International")).toBe(true);
    expect(international.results.some((row) => row.serviceName === "FedEx International Ground")).toBe(false);
  });
  it("quotes only the carriers selected in the request, independent of old environment toggles", async () => {
    vi.stubEnv("MOCK_CARRIERS", "true");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("FEDEX_ENABLED", "false");
    const result = await compare({ ...shipment(), carriers: ["fedex"] });
    expect(result.results).toHaveLength(4);
    expect(result.results.every((row) => row.carrier === "fedex")).toBe(true);
    expect(result.carrierStatuses.map((status) => status.carrier)).toEqual(["fedex"]);
  });
  it("does not fall back to sandbox credentials", async () => {
    vi.stubEnv("MOCK_CARRIERS", "false");
    vi.stubEnv("CANADA_POST_SANDBOX_API_KEY", "secret");
    vi.stubEnv("CANADA_POST_SANDBOX_API_SECRET", "secret");
    expect(configured("canada_post", "production")).toBe("unconfigured");
    const result = await compare({ ...shipment(), carrierMode: "production" });
    expect(result.results).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
describe("account mode access", () => {
  it("allows signed-in accounts to use their separate production and sandbox settings", () => {
    for (const environment of ["development", "uat", "production"]) {
      vi.stubEnv("APP_ENV", environment);
      const user = { id: "id", email: "user@example.test", role: "user" as const };
      expect(allowedModes(user)).toEqual(["production", "sandbox"]);
      expect(() => assertMode("production", user)).not.toThrow();
      expect(() => assertMode("sandbox", user)).not.toThrow();
    }
  });
  it("requires authentication for both modes", () => {
    expect(allowedModes(null)).toEqual([]);
    expect(() => assertMode("production", null)).toThrow();
    expect(() => assertMode("sandbox", null)).toThrow();
  });
  it("rejects custom carrier URLs", () => {
    vi.stubEnv("FEDEX_SANDBOX_BASE_URL", "https://example.com");
    expect(() => carrierConfig("fedex", "sandbox")).toThrow();
  });
});
describe("carrier contracts", () => {
  it("builds v4 XML with documented options and escapes values", () => {
    const s = shipment();
    const request = canadaPostRequest(s, true, "1&2");
    expect(request).toContain("rate-v4");
    expect(request).toContain("<option-code>SO</option-code>");
    expect(request).toContain("<option-code>COV</option-code>");
    expect(request).toContain("1&amp;2");
    expect(canadaPostRequest(s, false)).not.toContain("<option-code>COV");
  });
  it("reads due total and preserves missing ETA", () => {
    const quotes = parseCanadaPost(
      "<price-quotes><price-quote><service-code>TEST</service-code><service-name>Fixture</service-name><price-details><base>10.00</base><due>12.35</due></price-details></price-quote></price-quotes>",
    );
    expect(quotes[0].total).toBe("12.35");
    expect(quotes[0].eta.kind).toBe("unavailable");
  });
  it("rejects DTD, entities, malformed XML", () => {
    expect(() =>
      xml('<!DOCTYPE x [<!ENTITY x SYSTEM "file:///secret">]><x>&x;</x>'),
    ).toThrow();
    expect(() => xml("<x><y></x>")).toThrow();
  });
  it("requests all FedEx services and keeps signature in both scenarios", () => {
    const s = shipment();
    const base = fedexRequest(s, false, "fixture-account");
    const covered = fedexRequest(s, true, "fixture-account");
    expect(base.requestedShipment).not.toHaveProperty("serviceType");
    expect(base.rateRequestControlParameters.returnTransitTimes).toBe(true);
    expect(
      covered.requestedShipment.requestedPackageLineItems[0],
    ).toHaveProperty("declaredValue");
    expect(
      base.requestedShipment.requestedPackageLineItems[0]
        .packageSpecialServices,
    ).toEqual(
      covered.requestedShipment.requestedPackageLineItems[0]
        .packageSpecialServices,
    );
  });
  it("prefers FedEx account rates over list rates for the same service", () => {
    const q = parseFedex(
      JSON.stringify({
        output: {
          rateReplyDetails: [
            {
              serviceType: "FIXTURE",
              ratedShipmentDetails: [
                {
                  rateType: "ACCOUNT",
                  currency: "CAD",
                  totalNetChargeWithDutiesAndTaxes: "12.00",
                },
                { rateType: "LIST", currency: "USD", totalNetCharge: "15.00" },
              ],
            },
          ],
        },
      }),
    );
    expect(q).toHaveLength(1);
    expect(q[0].variant).toContain("ACCOUNT");
    expect(q[0].taxIncluded).toBe(true);

  });
});
