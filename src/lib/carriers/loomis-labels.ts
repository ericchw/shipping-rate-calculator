import "server-only";
import { AppError } from "../errors";
import { CarrierSettings } from "../carrier-settings";
import { mockEnabled } from "../config";
import type { Shipment } from "../schemas";
import { loomisRequest } from "./loomis";
import { array, escapeXml, request, xml } from "./transport";

const endpoint = "https://sandbox.loomis-express.com/axis2/services/USSBusinessService.USSBusinessServiceHttpsSoap11Endpoint/";
const value = (v: unknown): string => typeof v === "string" ? v : "";
type Return = { error?: unknown; processShipmentResult?: { errors?: unknown | unknown[]; shipment?: { id?: unknown; shipment_info_str?: { name?: unknown; value?: unknown }[] } }; labels?: unknown | unknown[]; result?: { label?: unknown } | { label?: unknown }[] };
export function labelResponse(text: string, operation: string): Return {
  const body = (xml(text) as { Envelope?: { Body?: Record<string, { return?: Return }> } }).Envelope?.Body;
  const result = body?.[`${operation}Response`]?.return;
  if (body?.Fault || !result || value(result.error).trim() || array(result.processShipmentResult?.errors).some((e) => value(e).trim()))
    throw new AppError(502, "LOOMIS_LABEL_ERROR", "Loomis rejected the sandbox label request. Check your credentials and shipment details.");
  return result;
}
export function sandboxLabelShipment(s: Shipment): Shipment {
  const defaults = (a: Shipment["ship_from"], name: string) => ({ ...a,
    address_line1: a.address_line1.trim() || "1 Test Street",
    contact_name: a.contact_name.trim() || a.company.trim() || name,
    phone: a.phone.trim() || "6045550100" });
  return { ...s, ship_from: defaults(s.ship_from, "Sandbox Sender"), ship_to: defaults(s.ship_to, "Sandbox Recipient") };
}
export function shipmentLabelRequest(s: Shipment, service: string, username: string, password: string, account: string) {
  return loomisRequest(sandboxLabelShipment(s), s.coverageAmount > 0, username, password, account)
    .replaceAll("http://ws.rating.uss.transforce.ca", "http://ws.business.uss.transforce.ca")
    .replaceAll("rate:getRates", "rate:processShipment")
    .replace("<dto:service_type>ALL</dto:service_type>", `<dto:service_type>${escapeXml(service)}</dto:service_type>`);
}
export async function generateLoomisLabel(owner: string, s: Shipment, service: string, groupId?: string) {
  if (s.carrierMode !== "sandbox") throw new AppError(400, "SANDBOX_ONLY", "Label generation is available in sandbox only.");
  if (mockEnabled("sandbox")) throw new AppError(400, "LIVE_SANDBOX_REQUIRED", "Use the live carrier sandbox to generate verification labels.");
  if (s.ship_from.country_code !== "CA" || s.ship_to.country_code !== "CA" || s.coverageAmount >= 2500)
    throw new AppError(400, "UNSUPPORTED_LABEL", "Sandbox labels require Canadian addresses and declared value below CAD 2,500.");
  const c = await new CarrierSettings(undefined, undefined, groupId).config(owner, "loomis", "sandbox");
  if (!c.enabled || !["USERNAME", "PASSWORD", "ACCOUNT_NUMBER"].every((key) => c.get(key)))
    throw new AppError(400, "CREDENTIALS_REQUIRED", "Enable Loomis with your sandbox credentials in Settings.");
  const signal = AbortSignal.timeout(40000);
  const call = (operation: string, body: string) => request(endpoint, { method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"urn:${operation}"` }, body }, signal, 1);
  try {
    // Do not retry shipment creation: a lost response may still have created a shipment.
    const created = labelResponse(await call("processShipment", shipmentLabelRequest(s, service, c.get("USERNAME"), c.get("PASSWORD"), c.get("ACCOUNT_NUMBER"))), "processShipment");
    const shipment = created.processShipmentResult?.shipment;
    const id = value(shipment?.id);
    if (!/^\d+$/.test(id)) throw new AppError(502, "INVALID_LABEL_ID", "Loomis did not return a label ID.");
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ws="http://ws.business.uss.transforce.ca" xmlns:rq="http://ws.business.uss.transforce.ca/xsd"><soap:Body><ws:getLabelsAdvancedV2><ws:request><rq:format>PNG</rq:format><rq:id>${id}</rq:id><rq:password>${escapeXml(c.get("PASSWORD"))}</rq:password><rq:user_id>${escapeXml(c.get("USERNAME"))}</rq:user_id></ws:request></ws:getLabelsAdvancedV2></soap:Body></soap:Envelope>`;
    const response = labelResponse(await call("getLabelsAdvancedV2", envelope), "getLabelsAdvancedV2");
    const labels = (response.result ? array(response.result).map((r) => r.label) : array(response.labels)).map((v) => value(v).replace(/\s/g, ""));
    if (!labels.length || labels.some((label) => !/^[A-Za-z0-9+/]+={0,2}$/.test(label) || Buffer.from(label, "base64").subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"))
      throw new AppError(502, "INVALID_LABEL", "Loomis did not return a valid PNG label.");
    return { labelId: id, shipmentNumber: value(array(shipment?.shipment_info_str).find((item) => item.name === "SIN")?.value), labels };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "LOOMIS_LABEL_ERROR", "The Loomis sandbox label request failed or timed out. A test shipment may have been created.");
  }
}
