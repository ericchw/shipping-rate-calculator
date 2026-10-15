import "server-only";
import Decimal from "decimal.js";
import { carrierConfig, credentialsConfigured, type CarrierConfig, type Mode } from "../config";
import { convert, hasPackageDimensions } from "../units";
import type { Shipment } from "../schemas";
import { array, escapeXml, request, xml, CarrierResponseError } from "./transport";
import { unavailableEta, type CarrierAdapter, type Quote } from "./types";

// SOAP 1.1 address and action verified against the sandbox rating WSDL.
const sandboxEndpoint = "https://sandbox.loomis-express.com/axis2/services/USSRatingService.USSRatingServiceHttpsSoap11Endpoint/";
const serviceNames: Record<string, string> = {
  DD: "Loomis Ground", DE: "Loomis Express 18:00", DN: "Loomis Express 12:00", D9: "Loomis Express 9:00",
};
const tag = (name: string, value: unknown) => `<dto:${name}>${escapeXml(value)}</dto:${name}>`;
const named = (type: string, name: string, value: unknown) => `<dto:${type}>${tag("name", name)}${tag("value", value)}</dto:${type}>`;
export function loomisRequest(s: Shipment, coverage: boolean, username: string, password: string, account: string) {
  const p = s.packages[0];
  const a = s.ship_from, b = s.ship_to;
  const shipment = [
    tag("delivery_address_line_1", b.address_line1), tag("delivery_address_line_2", b.address_line2),
    tag("delivery_city", b.city), tag("delivery_country", b.country_code),
    tag("delivery_name", b.contact_name || b.company), tag("delivery_phone", b.phone),
    tag("delivery_postal_code", b.postal_code), tag("delivery_province", b.region),
    tag("dimension_unit", "M"),
    `<dto:packages>${hasPackageDimensions(p) ? ["length", "width", "height"].map((key) => named("package_info_num", key.toUpperCase(), new Decimal(convert(p[key as "length" | "width" | "height"], p.dimensionUnit, "cm")).toFixed(3))).join("") : ""}${tag("reported_weight", new Decimal(convert(p.weight, p.weightUnit, "kg")).toFixed(3))}</dto:packages>`,
    tag("pickup_address_line_1", a.address_line1), tag("pickup_address_line_2", a.address_line2),
    tag("pickup_city", a.city), tag("pickup_name", a.contact_name || a.company), tag("pickup_phone", a.phone),
    tag("pickup_postal_code", a.postal_code), tag("pickup_province", a.region),
    tag("reported_weight_unit", "K"), tag("service_type", "ALL"),
    ...(coverage ? [named("shipment_info_num", "DECLARED_VALUE", new Decimal(s.coverageAmount).toFixed(2))] : []),
    ...(s.signatureRequired ? [named("shipment_info_str", "SIGNATURE", "SR")] : []),
    tag("shipper_num", account), tag("shipping_date", s.shipDate.replaceAll("-", "")),
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:rate="http://ws.rating.uss.transforce.ca" xmlns:rq="http://ws.rating.uss.transforce.ca/xsd" xmlns:dto="http://dto.uss.transforce.ca/xsd"><soap:Body><rate:getRates><rate:request><rq:password>${escapeXml(password)}</rq:password><rq:shipment>${shipment}</rq:shipment><rq:user_id>${escapeXml(username)}</rq:user_id></rate:request></rate:getRates></soap:Body></soap:Envelope>`;
}
type NamedValue = { name?: unknown; value?: unknown };
type LoomisShipment = { service_type?: unknown; estimated_delivery_date?: unknown; transit_time?: unknown; transit_time_guaranteed?: unknown; shipment_info_num?: NamedValue | NamedValue[]; shipment_info_str?: NamedValue | NamedValue[]; tax_charge_1?: unknown; tax_charge_2?: unknown; freight_charge?: unknown; fuel_surcharge?: unknown };
type LoomisEnvelope = { Envelope?: { Body?: { Fault?: unknown; getRatesResponse?: { return?: { error?: unknown; getRatesResult?: { errors?: unknown | unknown[]; shipment?: LoomisShipment } | { errors?: unknown | unknown[]; shipment?: LoomisShipment }[] } } } } };
const textValue = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
export function parseLoomis(text: string): Quote[] {
  const body = (xml(text) as LoomisEnvelope).Envelope?.Body;
  if (body?.Fault) throw new CarrierResponseError("Loomis returned a SOAP fault.");
  const response = body?.getRatesResponse?.return;
  if (!response) throw new CarrierResponseError("Loomis returned an invalid rate response.");
  if (textValue(response.error).trim()) throw new CarrierResponseError("Loomis rejected the rate request. Check the account credentials and shipment details.");
  const rows: Quote[] = [];
  let failed = false;
  for (const result of array(response.getRatesResult)) {
    if (array(result.errors).some((error) => textValue(error).trim())) { failed = true; continue; }
    const s = result.shipment;
    if (!s) continue;
    const charges = array(s.shipment_info_num);
    const total = textValue(charges.find((item) => textValue(item.name) === "TOTAL_CHARGE")?.value);
    if (!total) { failed = true; continue; }
    const serviceCode = textValue(s.service_type);
    if (!serviceCode) { failed = true; continue; }
    const rawDate = textValue(s.estimated_delivery_date);
    const date = /^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10)
      : /^\d{8}$/.test(rawDate) ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6)}` : undefined;
    const daysText = textValue(s.transit_time);
    const days = /^\d+$/.test(daysText) ? Number(daysText) : null;
    const label = textValue(array(s.shipment_info_str).find((item) => textValue(item.name) === "SERVICE_LABEL")?.value);
    const taxValues = [s.tax_charge_1, s.tax_charge_2].map(textValue);
    const preTaxTotal = taxValues.every((value) => value !== "" && Number.isFinite(Number(value)))
      ? new Decimal(total).minus(taxValues[0]).minus(taxValues[1]).toFixed(2) : null;
    rows.push({
      serviceCode, serviceName: label || serviceNames[serviceCode] || serviceCode, variant: "ACCOUNT", currency: "CAD",
      apiResult: result,
      total: new Decimal(total).toFixed(2), taxIncluded: true, preTaxTotal,
      eta: date ? { kind: textValue(s.transit_time_guaranteed) === "true" ? "guaranteed_date" : "estimated_date", date, businessDays: days }
        : days !== null ? { kind: "transit_days", date: null, businessDays: days } : unavailableEta,
      breakdown: charges.filter((item) => ["BASE_CHARGE", "ADD_SER_CHARGE"].includes(textValue(item.name))).map((item) => ({ label: textValue(item.name), amount: new Decimal(textValue(item.value)).toFixed(2) })),
      notices: ["Returned total includes carrier taxes. Shipment Value Protection is subject to Loomis terms."],
    });
  }
  if (failed && !rows.length) throw new CarrierResponseError("Loomis could not quote this shipment. Check its addresses and account eligibility.");
  if (failed) for (const row of rows) row.notices.push("Loomis could not quote one or more other services.");
  return rows;
}
export function loomis(mode: Mode, settings?: CarrierConfig): CarrierAdapter {
  const c = settings ?? carrierConfig("loomis", mode);
  return {
    carrier: "loomis",
    isConfigured: () => credentialsConfigured("loomis", mode, c),
    async getRates(s, o) {
      if (!credentialsConfigured("loomis", mode, c)) throw new CarrierResponseError("Save the Loomis API URL, username, password and account ID before requesting rates.");
      if (s.ship_from.country_code !== "CA" || s.ship_to.country_code !== "CA")
        throw new CarrierResponseError("Loomis international rates require customs details that are not yet supported.");
      const sandboxAddress = (a: Shipment["ship_from"], name: string) => ({
        ...a,
        address_line1: a.address_line1?.trim() || "1 Test Street",
        contact_name: a.contact_name?.trim() || a.company?.trim() || name,
        phone: a.phone?.trim() || "6045550100",
      });
      const usedDefaults = [s.ship_from, s.ship_to].some((a) =>
        !a.address_line1?.trim() || !(a.contact_name?.trim() || a.company?.trim()) || !a.phone?.trim());
      if (mode === "production" && usedDefaults)
        throw new CarrierResponseError("Loomis requires a street address, contact name or company, and phone number for both Ship From and Ship To.");
      const ratingShipment = mode === "production" ? s : { ...s,
        ship_from: sandboxAddress(s.ship_from, "Sandbox Sender"),
        ship_to: sandboxAddress(s.ship_to, "Sandbox Recipient"),
      };
      if (o.coverage && s.coverageAmount >= 2500)
        throw new CarrierResponseError("Loomis declared value of CAD 2,500 or more requires a special agreement.");
      const rows = parseLoomis(await request(mode === "production" || settings ? c.base : sandboxEndpoint, {
        method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '"urn:getRates"' },
        body: loomisRequest(ratingShipment, o.coverage, c.get("USERNAME"), c.get("PASSWORD"), c.get("ACCOUNT_NUMBER")),
      }, o.signal));
      if (mode === "sandbox" && usedDefaults) for (const row of rows) row.notices.push("Missing street/contact/phone fields used sandbox test defaults: 1 Test Street, Sandbox Sender/Recipient, 6045550100.");
      return rows;
    },
  };
}
