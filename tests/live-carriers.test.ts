import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLoomis, loomisRequest, loomis } from "../src/lib/carriers/loomis";
import { parseFedex } from "../src/lib/carriers/fedex";
import { parseCanadaPost, canadaPostRequest } from "../src/lib/carriers/canada-post";
import { request } from "../src/lib/carriers/transport";
import { compare } from "../src/lib/quote-service";
import { shipmentSchema } from "../src/lib/schemas";

const shipment = () => shipmentSchema.parse({
  ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1", country_code: "CA", address_line1: "1 Test St", contact_name: "Sender", phone: "6045550100" },
  ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6", country_code: "CA", address_line1: "2 Test St", contact_name: "Recipient", phone: "4165550100" },
  shipDate: "2026-10-13", packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }],
  carriers: ["canada_post"], coverageAmount: 0,
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const envelope = (content: string) => `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><getRatesResponse><return>${content}</return></getRatesResponse></soap:Body></soap:Envelope>`;

describe("Loomis rating", () => {
  it("requests all services with SOAP namespaces, escaped credentials, metric quantities and the required compact date", () => {
    const text = loomisRequest(shipment(), false, "user&name", "secret<value", "test-account");
    expect(text).toContain("<dto:service_type>ALL</dto:service_type>");
    expect(text).toContain("<dto:shipping_date>20261013</dto:shipping_date>");
    expect(text).toContain("<dto:dimension_unit>M</dto:dimension_unit>");
    expect(text).toContain("<dto:reported_weight_unit>K</dto:reported_weight_unit>");
    expect(text).toContain("30.480");
    expect(text).toContain("2.268");
    expect(text).toContain("user&amp;name");
    expect(text).toContain("secret&lt;value");
    expect(text).not.toContain("DECLARED_VALUE");
  });
  it("uses returned totals without adding aggregate charges again and preserves each service", () => {
    const rows = parseLoomis(envelope(["DD", "DE"].map((service) => `<getRatesResult><shipment><service_type>${service}</service_type><estimated_delivery_date>20261015</estimated_delivery_date><transit_time>2</transit_time><transit_time_guaranteed>false</transit_time_guaranteed><shipment_info_num><name>TOTAL_CHARGE</name><value>24.75</value></shipment_info_num><shipment_info_num><name>ADD_SER_CHARGE</name><value>4.00</value></shipment_info_num></shipment></getRatesResult>`).join("")));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.serviceName)).toEqual(["Loomis Ground", "Loomis Express 18:00"]);
    expect(rows[0].total).toBe("24.75");
    expect(rows[0].eta.date).toBe("2026-10-15");
    expect(rows[0].taxIncluded).toBe(true);
  });
  it("rejects carrier errors and missing totals instead of producing sample prices", () => {
    expect(() => parseLoomis(envelope("<error>Invalid account</error>"))).toThrow("Loomis rejected");
    expect(() => parseLoomis(envelope("<getRatesResult><shipment><service_type>DD</service_type></shipment></getRatesResult>"))).toThrow("could not quote");
  });
});
describe("real carrier error handling", () => {
  function configureCanadaPost() {
    vi.stubEnv("APP_ENV", "development"); vi.stubEnv("MOCK_CARRIERS", "false");
    vi.stubEnv("CANADA_POST_SANDBOX_API_KEY", "test-key");
    vi.stubEnv("CANADA_POST_SANDBOX_API_SECRET", "test-secret");
  }
  it("shows HTTP status and a safe carrier code without returning mock fallback rates", async () => {
    configureCanadaPost();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<messages><message><code>AA004</code><description>private input must not be exposed</description></message></messages>", { status: 403 })));
    const result = await compare(shipment());
    expect(result.results).toEqual([]);
    expect(result.carrierStatuses[0]).toMatchObject({ source: "live_carrier", status: "error" });
    expect(result.carrierStatuses[0].message).toContain("HTTP 403; AA004");
    expect(JSON.stringify(result)).not.toContain("private input");
  });
  it("retains real base rates and reports a coverage API failure", async () => {
    configureCanadaPost();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response("<price-quotes><price-quote><service-code>DOM.XP</service-code><service-name>Xpresspost</service-name><price-details><base>20</base><due>22.40</due></price-details></price-quote></price-quotes>"))
      .mockResolvedValueOnce(new Response("<messages><message><code>INVALID_COVERAGE</code></message></messages>", { status: 400 })));
    const result = await compare({ ...shipment(), coverageAmount: 500 });
    expect(result.results).toHaveLength(1);
    expect(result.results[0].withoutCoverage.total).toBe("22.40");
    expect(result.results[0].withCoverage.available).toBe(false);
    expect(result.results[0].withCoverage.status).toBe("carrier_error");
    expect(result.carrierStatuses[0].status).toBe("partial");
    expect(result.carrierStatuses[0].message).toContain("HTTP 400; INVALID_COVERAGE");
  });
  it("reports authentication HTTP errors and excludes carrier response bodies", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ errors: [{ code: "NOT.AUTHORIZED", message: "secret value" }] }), { status: 401 })));
    await expect(request("https://apis-sandbox.fedex.com/oauth/token", {}, new AbortController().signal)).rejects.toThrow("Authentication failed (HTTP 401; NOT.AUTHORIZED)");
  });
});

 it("uses test contact defaults only in Loomis sandbox and discloses them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(envelope("<getRatesResult><shipment><service_type>DD</service_type><shipment_info_num><name>TOTAL_CHARGE</name><value>25.00</value></shipment_info_num></shipment></getRatesResult>")));
    vi.stubGlobal("fetch", fetchMock);
    const original = shipment();
    const input = { ...original, ship_from: { ...original.ship_from, address_line1: "", contact_name: "", phone: "" }, ship_to: { ...original.ship_to, address_line1: "", contact_name: "", phone: "" } };
    const options = { coverage: false, signal: new AbortController().signal };
    const rows = await loomis("sandbox", { base: "https://sandbox.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/", get: () => "sandbox-test-credential" }).getRates(input, options);
    expect(fetchMock.mock.calls[0][1].body).toContain("1 Test Street");
    expect(fetchMock.mock.calls[0][1].body).toContain("Sandbox Sender");
    expect(fetchMock.mock.calls[0][1].body).toContain("Sandbox Recipient");
    expect(rows[0].notices.join(" ")).toContain("sandbox test defaults");
    expect(input.ship_from.address_line1).toBe("");
    await expect(loomis("production", { base: "https://www.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/", get: () => "production-test-credential" }).getRates(input, options)).rejects.toThrow("street address");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
 it("requests counter prices without sending a commercial identity", () => {
    const text = canadaPostRequest(shipment(), false, "test-customer", "test-contract", "counter");
    expect(text).toContain("<quote-type>counter</quote-type>");
    expect(text).not.toContain("customer-number");
    expect(text).not.toContain("contract-id");
    expect(canadaPostRequest(shipment(), false, "test-customer", "test-contract")).toContain("<customer-number>test-customer</customer-number>");
 });

it("derives Canada Post pre-tax totals from returned tax amounts, preserving adjustments", () => {
  const rows = parseCanadaPost('<price-quotes><price-quote><service-code>DOM.RP</service-code><service-name>Regular Parcel</service-name><price-details><base>20.00</base><due>33.90</due><taxes><gst percent="0">0</gst><pst percent="0">0</pst><hst percent="13">3.90</hst></taxes></price-details></price-quote></price-quotes>');
  expect(rows[0].preTaxTotal).toBe("30.00");
});
it("preserves FedEx returned pre-tax and tax-inclusive totals", () => {
  const rows = parseFedex(JSON.stringify({ output: { rateReplyDetails: [{ serviceType: "GROUND", ratedShipmentDetails: [{ rateType: "ACCOUNT", currency: "CAD", totalNetCharge: 113, totalNetFedExCharge: 100 }] }] } }));
  expect(rows[0].total).toBe("113.00");
  expect(rows[0].preTaxTotal).toBe("100.00");
  expect(rows[0].taxIncluded).toBe(true);
});

 it("sends production Loomis rates to the saved endpoint with production credentials and actual addresses", async () => {
    const endpoint = "https://www.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/";
    const fetchMock = vi.fn().mockResolvedValue(new Response(envelope("<getRatesResult><shipment><service_type>DD</service_type><shipment_info_num><name>TOTAL_CHARGE</name><value>37.50</value></shipment_info_num></shipment></getRatesResult>")));
    vi.stubGlobal("fetch", fetchMock);
    const fields: Record<string, string> = { USERNAME: "production-user", PASSWORD: "production-password", ACCOUNT_NUMBER: "production-account" };
    const adapter = loomis("production", { base: endpoint, get: key => fields[key] ?? "" });
    expect(adapter.isConfigured()).toBe(true);
    const rows = await adapter.getRates(shipment(), { coverage: false, signal: new AbortController().signal });
    expect(rows[0].total).toBe("37.50");
    expect(fetchMock.mock.calls[0][0]).toBe(endpoint);
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).toContain("production-user"); expect(body).toContain("production-account");
    expect(body).toContain("1 Test St"); expect(body).not.toContain("Sandbox Sender");
    expect(rows[0].notices.join(" ")).not.toContain("sandbox test defaults");
 });
