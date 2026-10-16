import { describe, expect, it } from "vitest";
import { buildRateTable, buildApiResult, buildApiRequest, formatEta } from "../src/lib/rate-table";
import { shipmentSchema } from "../src/lib/schemas";
import type { RateRow } from "../src/lib/carriers/types";

const row: RateRow = {
  carrier: "fedex", mode: "sandbox", source: "mock",
  serviceCode: "PRIORITY_OVERNIGHT", serviceName: "FedEx Priority Overnight",
  variant: "YOUR_PACKAGING:ACCOUNT", currency: "CAD",
  eta: { kind: "transit_days", date: null, businessDays: 1 }, notices: [],
  signature: { requested: true, available: true, includedInQuote: true },
  withoutCoverage: { available: true, total: "42.75", taxIncluded: true, breakdown: [] },
  withCoverage: { available: true, total: "47.75", taxIncluded: true, breakdown: [], declaredValue: "500.00", status: "quoted" },
  coverageDifference: "5.00",
};
describe("formatted shipping table", () => {
  it("exports only the simple comparison columns in HTML and aligned plain text", () => {
    const table = buildRateTable([row], false);
    expect(table.html).toContain("<table");
    expect(table.html).toContain("border-collapse:collapse");
    expect(table.text).toContain("FedEx Priority Overnight");
    expect(table.text).toContain("1 business day");
    expect(table.text).toContain("$42.75 CAD");
    expect(table.text).toContain("Tax: included");
    expect(table.text).not.toContain("MOCK");
    expect(table.text).not.toContain("Status");
    expect(table.text).not.toContain("YOUR_PACKAGING");
    expect(table.text).not.toContain("With coverage");
  });
  it("escapes carrier text so pasting a quote cannot insert HTML", () => {
    const table = buildRateTable([{ ...row, serviceName: '<img src=x onerror="alert(1)">' }], false);
    expect(table.html).not.toContain("<img");
    expect(table.html).toContain("&lt;img");
    expect(table.html).toContain("&quot;");
  });
  it("copies both coverage totals without a difference column, and distinguishes unavailable coverage from zero", () => {
    const table = buildRateTable([row, { ...row, withCoverage: { ...row.withCoverage, available: false, total: null }, coverageDifference: null }], true);
    expect(table.text).toContain("Without coverage");
    expect(table.text).toContain("With coverage");
    expect(table.text).toContain("$47.75 CAD");
    expect(table.text).not.toContain("Declared value");
    expect(table.text).toContain("Unavailable");
    expect(table.text).not.toContain("Difference");
    expect(table.html).not.toContain("Difference");
  });
});

it("exports the selected tax basis", () => {
  const table = buildRateTable([{ ...row, withoutCoverage: { ...row.withoutCoverage, preTaxTotal: "40.00" } }], false, false);
  expect(table.text).toContain("$40.00");
  expect(table.text).toContain("Tax: excluded");
  expect(table.text).not.toContain("$42.75");
});

it("exports every displayed rate without quote details, statuses or carrier environment labels", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ ...row, mode: "production" as const, serviceCode: `SERVICE_${i}`, serviceName: `Service ${i}`, notices: ["Real quote terms"], withoutCoverage: { ...row.withoutCoverage, breakdown: [{ label: "Fuel", amount: "2.00" }] } }));
  const table = buildRateTable(rows, true);
  expect((table.html.match(/<tr>/g) ?? []).length).toBe(51);
  for (const value of ["Service 49", "$47.75 CAD"]) {
    expect(table.html).toContain(value);
    expect(table.text).toContain(value);
  }
  for (const value of ["Real quote terms", "Fuel", "Declared value", "Carrier API status", "Quote details", "Status", "PRODUCTION", "SANDBOX", "YOUR_PACKAGING"]) {
    expect(table.html).not.toContain(value);
    expect(table.text).not.toContain(value);
  }
});

it("copies the original per-service API values for both coverage requests", () => {
  const base = { serviceType: "GROUND", ratedShipmentDetails: [{ totalNetCharge: 42.75 }], unknownCarrierField: "preserve me" };
  const covered = { serviceType: "GROUND", ratedShipmentDetails: [{ totalNetCharge: 47.75 }] };
  const result = JSON.parse(buildApiResult({ ...row, apiResult: base, withCoverage: { ...row.withCoverage, apiResult: covered } }));
  expect(result).toEqual({ carrier: "FedEx", serviceCode: row.serviceCode, withoutCoverage: base, withCoverage: covered });
  expect(() => buildApiResult(row)).toThrow("fresh rates");
});

it("aligns raw text columns with borders instead of depending on tab stops", () => {
  const table = buildRateTable([row, { ...row, serviceName: "A service with a long name that wraps across multiple lines" }], true);
  expect(table.text).not.toContain("\t");
  const lines = table.text.split("\n").filter((line) => line.startsWith("| ") || line.startsWith("+"));
  expect(new Set(lines.map((line) => line.length)).size).toBe(1);
  expect(table.html).toContain("text-align:right");
});


it("shows Canada Post delivery date before business days in the web and copied tables", () => {
  const canadaPost: RateRow = { ...row, carrier: "canada_post", eta: { kind: "estimated_date", date: "2026-10-16", businessDays: 3 } };
  expect(formatEta(canadaPost)).toBe("2026-10-16 · 3 business days");
  const table = buildRateTable([canadaPost], false);
  expect(table.html).toContain("2026-10-16 · 3 business days");
  expect(table.text).toContain("2026-10-16 · 3 business days");
  expect(formatEta({ ...canadaPost, eta: { ...canadaPost.eta, businessDays: null } })).toBe("2026-10-16");
  expect(formatEta({ ...canadaPost, eta: { ...canadaPost.eta, date: null, businessDays: 1 } })).toBe("1 business day");
});

it("puts requested signature in the heading without a signature column", () => {
  const table = buildRateTable([row], false);
  expect(table.text).toContain("Signature: Required");
  expect(table.html).toContain("Signature: Required");
  expect(table.text).not.toContain("✓");
  expect(table.html).not.toMatch(/<th[^>]*>Signature<\/th>/);
  expect(buildRateTable([{ ...row, signature: { ...row.signature, requested: false } }], false).text).toContain("Signature: Not required");
});

it("copies shipment details, selected tax basis and coverage as separate heading lines", () => {
  const table = buildRateTable([row], true, false, 2100, {
    signatureRequired: true,
    shipDate: "2026-10-14",
    origin: { region: "BC", city: "Richmond", postal_code: "V6V2K9" },
    destination: { region: "ON", city: "Barrie", postal_code: "L4N9R3" },
    parcel: { quantity: 3, weight: 3.1, weightUnit: "lb", length: 6, width: 4, height: 2, dimensionUnit: "in" },
  });
  const heading = ["Ship From: BC · Richmond · V6V2K9", "Ship To: ON · Barrie · L4N9R3", "Ship Date: 2026-10-14", "Package: 3 boxes · 3.1 lb each · Total weight 9.30 lb · 6 × 4 × 2 in", "Signature: Required", "Tax: excluded", "Coverage $2,100.00 CAD"];
  expect(table.text.split("\n").slice(0, 7)).toEqual(heading);
  expect(table.html).toContain(`<p>${heading.join("<br>")}</p>`);
  expect(buildRateTable([row], false, true, 0).text).toMatch(/^Signature: Required\nTax: included\nCoverage \$0.00 CAD/);
});

it.each(["loomis", "fedex", "canada_post"] as const)("shows %s delivery date before transit days everywhere", carrier => {
  const quote: RateRow = { ...row, carrier, eta: { kind: "estimated_date", date: "2026-10-16", businessDays: 2 } };
  expect(formatEta(quote)).toBe("2026-10-16 · 2 business days");
  const table = buildRateTable([quote], false);
  expect(table.html).toContain("2026-10-16 · 2 business days");
  expect(table.text).toContain("2026-10-16 · 2 business days");
});

it("copies the submitted shipment for one carrier without mutating the saved comparison request", () => {
  const shipment = shipmentSchema.parse({
    ship_from: { city:"Richmond",region:"BC",postal_code:"V6V2K9" },
    ship_to: { city:"Toronto",region:"ON",postal_code:"M5V2T6" }, shipDate:"2026-10-15",
    packages:[{quantity:3,weight:2,weightUnit:"lb",length:0,width:0,height:0,dimensionUnit:"in"}],
    carriers:["fedex","purolator"],carrierMode:"sandbox",coverageAmount:500,signatureRequired:true,
  });
  const saved = JSON.stringify(shipment);
  const request = JSON.parse(buildApiRequest(shipment,"purolator"));
  expect(request).toEqual({...shipment,carriers:["purolator"]});
  expect(JSON.stringify(shipment)).toBe(saved);
  expect(JSON.parse(buildApiRequest(shipment))).toEqual(shipment);
  expect(() => buildApiRequest(shipment,"loomis")).toThrow("unavailable");
});
