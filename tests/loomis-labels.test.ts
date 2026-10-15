import { afterEach, expect, it, vi } from "vitest";
import { labelResponse, shipmentLabelRequest, generateLoomisLabel } from "../src/lib/carriers/loomis-labels";
import { shipmentSchema } from "../src/lib/schemas";
import { CarrierSettings } from "../src/lib/carrier-settings";
vi.mock("../src/lib/db", () => ({ db: () => ({}) }));
const shipment = shipmentSchema.parse({ ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1" }, ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" }, shipDate: "2026-10-14", packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }] });
const envelope = (operation: string, content: string) => `<Envelope><Body><${operation}Response><return>${content}</return></${operation}Response></Body></Envelope>`;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("creates the selected service using business namespaces and escaped sandbox credentials", () => {
  const body = shipmentLabelRequest(shipment, "DD", "user&", "secret<", "account");
  expect(body).toContain("business.uss.transforce.ca");
  expect(body).toContain("<rate:processShipment>");
  expect(body).toContain("<dto:service_type>DD</dto:service_type>");
  expect(body).toContain("1 Test Street");
  expect(body).toContain("user&amp;");
  expect(body).not.toContain("getRates");
});
it("rejects SOAP faults and per-shipment errors", () => {
  expect(() => labelResponse("<Envelope><Body><Fault>private</Fault></Body></Envelope>", "processShipment")).toThrow("Loomis rejected");
  expect(() => labelResponse(envelope("processShipment", "<processShipmentResult><errors>private</errors></processShipmentResult>"), "processShipment")).toThrow("Loomis rejected");
});
it("rejects production before loading credentials or contacting Loomis", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(generateLoomisLabel("owner", { ...shipment, carrierMode: "production" }, "DD")).rejects.toThrow("sandbox only");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("retrieves the original PNG using the returned shipment label ID", async () => {
  vi.stubEnv("MOCK_CARRIERS", "false");
  vi.spyOn(CarrierSettings.prototype, "config").mockResolvedValue({ enabled: true, base: "unused", get: (key) => key === "PASSWORD" ? "private-secret" : "test-value" });
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=";
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(envelope("processShipment", '<error xsi:nil="true"/><processShipmentResult><shipment><id>1234</id></shipment></processShipmentResult>'))).mockResolvedValueOnce(new Response(envelope("getLabelsAdvancedV2", `<result><label>${png}</label></result>`)));
  vi.stubGlobal("fetch", fetchMock);
  expect(await generateLoomisLabel("owner", shipment, "DD")).toMatchObject({ labelId: "1234", labels: [png] });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[1][1].body).toContain("<rq:id>1234</rq:id>");
});
it("does not retry shipment creation on HTTP 500", async () => {
  vi.stubEnv("MOCK_CARRIERS", "false");
  vi.spyOn(CarrierSettings.prototype, "config").mockResolvedValue({ enabled: true, base: "unused", get: () => "test-value" });
  const fetchMock = vi.fn().mockResolvedValue(new Response("failure", { status: 500 })); vi.stubGlobal("fetch", fetchMock);
  await expect(generateLoomisLabel("owner", shipment, "DD")).rejects.toThrow("may have been created");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
