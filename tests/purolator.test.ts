import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { purolator, purolatorRequest, parsePurolator } from "../src/lib/carriers/purolator";
import { shipmentSchema, carrierIds } from "../src/lib/schemas";
import { carrierDefinitions, defaultCarrierUrl } from "../src/lib/carrier-settings-schema";
import { type CarrierConfig, credentialsConfigured } from "../src/lib/config";
import { compare } from "../src/lib/quote-service";
import { formatEta } from "../src/lib/rate-table";
const shipment = () => shipmentSchema.parse({
  ship_from: { city: "Richmond", region: "BC", postal_code: "V6V2K9", address_line1: "123 Example St" },
  ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" },
  shipDate: "2026-10-15", packages: [{ weight: 1, weightUnit: "lb", length: 0, width: 0, height: 0, dimensionUnit: "in" }],
  carriers: ["purolator"], carrierMode: "sandbox", signatureRequired: true, coverageAmount: 500,
});
const rate = { serviceId: "PurolatorGround", lineOfBusiness: "Courier", unitOfMeasurement: "Imperial", shipmentDate: "2026-10-15", expectedDeliveryDate: "2026-10-19", estimatedTransitDays: 2,
  basePrice: 10, surcharges: [{ type: "Fuel", amount: 2 }], optionPrices: [], taxes: [{ type: "HST", amount: 1.56 }], subTotal: 12, totalPrice: 13.56 };
const reply = (estimates: unknown[] = [rate]) => JSON.stringify({ outboundShipmentEstimates: { shipmentEstimate: estimates } });
const auth = () => new Response(JSON.stringify({ token_type: "Bearer", access_token: "synthetic-token", expires_in: 3600 }));
function config(mode: "sandbox" | "production" = "sandbox", override = {}): CarrierConfig {
  const fields: Record<string, string> = { API_KEY: "synthetic-api-key", CLIENT_ID: randomUUID(), CLIENT_SECRET: "synthetic-password", SENDER_ACCOUNT: "sender-test", RECEIVER_ACCOUNT: "receiver-test", FREIGHT_ACCOUNT: "freight-test", ...override };
  return { base: defaultCarrierUrl("purolator", mode), get: key => fields[key] ?? "" };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Purolator REST courier estimates", () => {
  it("maps identical boxes to separate pieces and sums their rounded weights", () => {
    const s = shipment(); s.packages[0] = { ...s.packages[0], quantity: 3, weight: 2.001 };
    const info = purolatorRequest(s, false, "sender").outboundShipment.shipmentInformation;
    expect(info.totalPackages).toBe(3);
    expect(info.totalWeight).toBe(6.03);
    expect(info.packageInformation).toEqual([{ packageWeight: 2.01 }, { packageWeight: 2.01 }, { packageWeight: 2.01 }]);
    expect(info.totalWeight).toBeCloseTo(info.packageInformation.reduce((total, piece) => total + piece.packageWeight, 0));
  });
  it("validates box quantities as whole numbers from 1 to 100 while accepting older requests without quantity", () => {
    for (const quantity of [0, -1, 1.5, 101]) expect(() => shipmentSchema.parse({ ...shipment(), packages: [{ ...shipment().packages[0], quantity }] })).toThrow();
    expect(purolatorRequest(shipment(), false, "sender").outboundShipment.shipmentInformation.totalPackages).toBe(1);
    const max = shipmentSchema.parse({ ...shipment(), packages: [{ ...shipment().packages[0], quantity: 100 }] });
    expect(purolatorRequest(max, false, "sender").outboundShipment.shipmentInformation.packageInformation).toHaveLength(100);
  });
  it("does not return single-box rates from other carriers for a multiple-box request", async () => {
    vi.stubEnv("MOCK_CARRIERS", "true"); vi.stubEnv("APP_ENV", "development");
    const result = await compare(shipmentSchema.parse({ ...shipment(), carriers: ["canada_post", "fedex", "loomis"], packages: [{ ...shipment().packages[0], quantity: 2 }] }));
    expect(result.results).toEqual([]);
    expect(result.carrierStatuses).toHaveLength(3);
    for (const status of result.carrierStatuses) expect(status).toMatchObject({ status: "unavailable", message: expect.stringContaining("Multiple boxes") });
  });
  it("orders credentials to match the Purolator app credential JSON", () => {
    expect(carrierDefinitions.purolator.fields.map(field => field.key)).toEqual(["CLIENT_ID", "CLIENT_SECRET", "API_KEY", "SENDER_ACCOUNT", "RECEIVER_ACCOUNT", "FREIGHT_ACCOUNT"]);
  });
  it("parses actual UAT estimate arrays and nested tax, surcharge and option-price records", () => {
    const actual = { outboundShipmentEstimates: [{ shipmentEstimate: { ...rate,
      surcharges: [{ surcharge: { amount: 2, type: "Fuel", description: "Fuel Surcharge" } }],
      optionPrices: [{ optionPrice: { amount: 0, id: "DeclaredValue", description: "Declared value" } }],
      taxes: [{ tax: { amount: 1.56, type: "HST", description: "HST" } }],
    } }] };
    expect(parsePurolator(JSON.stringify(actual))[0]).toMatchObject({ total: "13.56", preTaxTotal: "12.00", breakdown: [
      { label: "Base rate", amount: "10.00" }, { label: "Fuel Surcharge", amount: "2.00" },
      { label: "Declared value", amount: "0.00" }, { label: "HST", amount: "1.56" },
    ] });
  });
  it("shows nested UAT validation codes and descriptions while redacting credentials and addresses", async () => {
    const c = config();
    const fetch = vi.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(JSON.stringify({ errors: [
      { error: { code: "9001-22", description: `Outbound: Invalid sender address: Maximum 3 lines and 40 characters per line. ${c.get("API_KEY")} ${c.get("CLIENT_ID")} ${c.get("CLIENT_SECRET")} ${c.get("SENDER_ACCOUNT")} 123 Example St synthetic-token` } },
    ] }), { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    let message = "";
    try { await purolator("sandbox", c).getRates(shipment(), { coverage: false, signal: new AbortController().signal }); }
    catch (error) { message = (error as Error).message; }
    expect(message).toContain("HTTP 400; 9001-22");
    expect(message).toContain("Invalid sender address: Maximum 3 lines and 40 characters per line.");
    for (const value of [c.get("API_KEY"), c.get("CLIENT_ID"), c.get("CLIENT_SECRET"), c.get("SENDER_ACCOUNT"), "123 Example St", "synthetic-token"]) expect(message).not.toContain(value);
  });
  it("identifies authentication failures separately from rate request failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid_scope", error_description: "Invalid scope" }), { status: 400 })));
    await expect(purolator("sandbox", config()).getRates(shipment(), { coverage: false, signal: new AbortController().signal })).rejects.toThrow("Authentication failed (HTTP 400; invalid_scope). Invalid scope");
  });
  it("supports four carriers and maps account billing, date and zero dimensions", () => {
    expect(shipmentSchema.parse({ ...shipment(), carriers: [...carrierIds] }).carriers).toHaveLength(4);
    const payload = purolatorRequest(shipment(), false, "sender-test");
    expect(payload).toMatchObject({ lineOfBusiness: "Courier", shipmentDate: "2026-10-15", outboundShipment: {
      billingInformation: { billingAccountNumber: "sender-test", displayPublishedRates: false },
      senderInformation: { streetAddress: ["123 Example St"], postalZipCode: "V6V2K9" },
      shipmentInformation: { serviceId: "PurolatorGround", showAlternativeServicesIndicator: true, totalPackages: 1, unitOfMeasurement: "Imperial", packageInformation: [{ packageWeight: 1 }], shipmentOptionsInformation: [{ optionId: "ResidentialSignatureDomestic", optionIdValue: "true" }] },
    } });
    expect(JSON.stringify(payload)).not.toContain("packageLength");
    expect(JSON.stringify(payload)).not.toContain("DeclaredValue");
    expect(purolatorRequest(shipment(), true, "sender-test").outboundShipment.shipmentInformation.shipmentOptionsInformation).toContainEqual({ optionId: "DeclaredValue", optionIdValue: "500.00" });
  });
  it("converts mixed dimensions into the weight's unit system and keeps positive rounded values", () => {
    const s = shipment(); s.packages[0] = { weight: 1.001, weightUnit: "kg", length: 1, width: 2, height: 3, dimensionUnit: "in" };
    expect(purolatorRequest(s, false, "sender").outboundShipment.shipmentInformation).toMatchObject({ unitOfMeasurement: "Metric", totalWeight: 1.01, packageInformation: [{ packageWeight: 1.01, packageLength: 2.54, packageWidth: 5.08, packageHeight: 7.62 }] });
  });
  it("selects international alternatives and rejects unsupported sender origins before sending credentials", async () => {
    const s = shipment(); s.ship_to.country_code = "US";
    expect(purolatorRequest(s, false, "sender").outboundShipment.shipmentInformation).toMatchObject({ serviceId: "PurolatorGroundU.S.", shipmentOptionsInformation: [{ optionId: "ResidentialSignatureIntl", optionIdValue: "true" }] });
    s.ship_from.country_code = "US";
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(purolator("sandbox", config()).getRates(s, { coverage: false, signal: new AbortController().signal })).rejects.toThrow("Canadian sender");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("preserves returned services, totals and transit information without adding taxes twice", () => {
    const quotes = parsePurolator(reply([rate, { ...rate, serviceId: "PurolatorExpress" }]));
    expect(quotes).toHaveLength(2);
    expect(quotes[0]).toMatchObject({ serviceCode: "PurolatorGround", serviceName: "Purolator Ground", total: "13.56", preTaxTotal: "12.00", currency: "CAD", taxIncluded: true, eta: { date: "2026-10-19", businessDays: 2 } });
    const noSubtotal = { ...rate, subTotal: undefined };
    expect(parsePurolator(JSON.stringify({ outboundShipmentEstimates: { shipmentEstimate: [noSubtotal] } }))[0].preTaxTotal).toBe("12.00");
    expect(parsePurolator(reply([]))).toEqual([]);
  });
  it("rejects errors and malformed or inconsistent money without exposing carrier descriptions", () => {
    expect(() => parsePurolator('{"errors":[{"code":"9001-10","description":"private account data"}]}')).toThrow("9001-10");
    try { parsePurolator('{"errors":[{"description":"private account data"}]}'); throw new Error("expected rejection"); }
    catch (error) { expect((error as Error).message).toContain("Purolator rejected"); expect((error as Error).message).not.toContain("private account data"); }
    for (const item of [{ ...rate, totalPrice: -1 }, { ...rate, totalPrice: "NaN" }, { ...rate, subTotal: 30 }, { ...rate, expectedDeliveryDate: "2026-02-30" }])
      expect(() => parsePurolator(JSON.stringify({ outboundShipmentEstimates: { shipmentEstimate: [item] } }))).toThrow();
    expect(() => parsePurolator('{}')).toThrow("no estimate data");
  });
  it.each(["sandbox", "production"] as const)("authenticates and quotes only the %s endpoint with separate API key and caches the token", async mode => {
    const c = config(mode), signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValueOnce(auth()).mockImplementation(async () => new Response(reply())); vi.stubGlobal("fetch", fetch);
    const adapter = purolator(mode, c);
    expect(adapter.isConfigured()).toBe(true);
    await adapter.getRates(shipment(), { coverage: false, signal });
    await adapter.getRates(shipment(), { coverage: true, signal });
    expect(fetch.mock.calls).toHaveLength(3);
    expect(fetch.mock.calls[0][0]).toBe(`${c.base}/auth/v1/token`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: `Basic ${Buffer.from(`${c.get("CLIENT_ID")}:${c.get("CLIENT_SECRET")}`).toString("base64")}` } });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ grant_type: "client_credentials", scope: "portal_api" });
    expect(fetch.mock.calls[1][0]).toBe(`${c.base}/rate/v1/shipment`);
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ Authorization: "Bearer synthetic-token", "x-api-key": "synthetic-api-key" });
    expect(fetch.mock.calls[1][1].body).not.toContain("receiver-test");
    expect(fetch.mock.calls[1][1].body).not.toContain("freight-test");
  });
  it("requires REST credentials, prevents sending credentials to the wrong host and does not require optional accounts", () => {
    expect(credentialsConfigured("purolator", "sandbox", config())).toBe(true);
    expect(credentialsConfigured("purolator", "sandbox", config("sandbox", { API_KEY: "" }))).toBe(true);
    expect(credentialsConfigured("purolator", "production", config("production", { API_KEY: "" }))).toBe(false);
    for (const field of ["CLIENT_ID", "CLIENT_SECRET", "SENDER_ACCOUNT"])
      expect(credentialsConfigured("purolator", "sandbox", config("sandbox", { [field]: "" }))).toBe(false);
    expect(credentialsConfigured("purolator", "sandbox", { ...config(), base: defaultCarrierUrl("purolator", "production") })).toBe(false);
    expect(credentialsConfigured("purolator", "sandbox", { ...config(), base: "https://example.invalid" })).toBe(false);
  });
  it("allows UAT credentials without an issued API key and omits the header instead of sending an empty value", async () => {
    const c = config("sandbox", { API_KEY: "" });
    const fetch = vi.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(reply()));
    vi.stubGlobal("fetch", fetch);
    const adapter = purolator("sandbox", c);
    expect(adapter.isConfigured()).toBe(true);
    await expect(adapter.getRates(shipment(), { coverage: false, signal: new AbortController().signal })).resolves.toHaveLength(1);
    expect(fetch.mock.calls[1][1].headers).not.toHaveProperty("x-api-key");
    expect(fetch.mock.calls[1][1].headers).toHaveProperty("Authorization", "Bearer synthetic-token");
  });
  it("blocks production estimates without an API key before making any request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(purolator("production", config("production", { API_KEY: "" })).getRates(shipment(), { coverage: false, signal: new AbortController().signal })).rejects.toThrow("REST API key");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("discards rejected tokens and retries authentication on the next estimate", async () => {
    const adapter = purolator("sandbox", config()), signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(reply())); vi.stubGlobal("fetch", fetch);
    await expect(adapter.getRates(shipment(), { coverage: false, signal })).rejects.toThrow("HTTP 401");
    await expect(adapter.getRates(shipment(), { coverage: false, signal })).resolves.toHaveLength(1);
    expect(fetch.mock.calls[2][0]).toContain("/auth/v1/token");
  });
  it("flows through the comparison service with coverage and the common ETA format", async () => {
    vi.stubEnv("MOCK_CARRIERS", "false"); vi.stubEnv("APP_ENV", "development");
    const c = config();
    for (const field of ["API_KEY", "CLIENT_ID", "CLIENT_SECRET", "SENDER_ACCOUNT"]) vi.stubEnv(`PUROLATOR_SANDBOX_${field}`, c.get(field));
    const covered = { ...rate, optionPrices: [{ id: "DeclaredValue", amount: 5 }], subTotal: 17, totalPrice: 19.21 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(auth()).mockResolvedValueOnce(new Response(reply())).mockResolvedValueOnce(new Response(reply([covered]))));
    const result = await compare(shipment());
    expect(result.carrierStatuses[0]).toMatchObject({ carrier: "purolator", status: "success" });
    expect(result.results[0]).toMatchObject({ withoutCoverage: { total: "13.56" }, withCoverage: { available: true, total: "19.21" }, coverageDifference: "5.65" });
    expect(formatEta(result.results[0])).toBe("2026-10-19 · 2 business days");
  });
});
