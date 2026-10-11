import "server-only";
import Decimal from "decimal.js";
import { carrierConfig, credentialsConfigured, type CarrierConfig, type Mode } from "../config";
import { convert } from "../units";
import type { Shipment } from "../schemas";
import { array, escapeXml as e, request, xml, CarrierResponseError } from "./transport";
import { unavailableEta, type CarrierAdapter, type Quote } from "./types";
export function canadaPostRequest(
  s: Shipment,
  coverage: boolean,
  customer = "",
  contract = "",
  quoteType: "commercial" | "counter" = "commercial",
) {
  const p = s.packages[0];
  const dimensions = [p.length, p.width, p.height]
    .map((v) => convert(v, p.dimensionUnit, "cm"))
    .sort((a, b) => b - a);
  const dest = s.ship_to;
  const destination =
    dest.country_code === "CA"
      ? `<domestic><postal-code>${e(dest.postal_code)}</postal-code></domestic>`
      : dest.country_code === "US"
        ? `<united-states><zip-code>${e(dest.postal_code)}</zip-code></united-states>`
        : `<international><country-code>${e(dest.country_code)}</country-code><postal-code>${e(dest.postal_code)}</postal-code></international>`;
  const options = [
    s.signatureRequired ? "<option><option-code>SO</option-code></option>" : "",
    coverage
      ? `<option><option-code>COV</option-code><option-amount>${new Decimal(s.coverageAmount).toFixed(2)}</option-amount></option>`
      : "",
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?><mailing-scenario xmlns="http://www.canadapost.ca/ws/ship/rate-v4">${quoteType === "counter" ? "" : customer ? `<customer-number>${e(customer)}</customer-number>` : ""}${quoteType === "counter" ? "" : contract ? `<contract-id>${e(contract)}</contract-id>` : ""}<quote-type>${quoteType}</quote-type><expected-mailing-date>${e(s.shipDate)}</expected-mailing-date>${options ? `<options>${options}</options>` : ""}<parcel-characteristics><weight>${new Decimal(convert(p.weight, p.weightUnit, "kg")).toFixed(3)}</weight><dimensions>${dimensions.map((v, i) => `<${["length", "width", "height"][i]}>${new Decimal(v).toFixed(1)}</${["length", "width", "height"][i]}>`).join("")}</dimensions></parcel-characteristics><origin-postal-code>${e(s.ship_from.postal_code)}</origin-postal-code><destination>${destination}</destination></mailing-scenario>`;
}
type CPQuote = {
  "service-code": string;
  "service-name": string;
  "price-details": {
    due: string;
    base: string;
    taxes?: Record<string, unknown>;
  };
  "service-standard"?: {
    "expected-delivery-date"?: string;
    "expected-transit-time"?: string;
    "guaranteed-delivery"?: string;
  };
};
export function parseCanadaPost(text: string): Quote[] {
  const root = xml(text);
  const quotes = (root["price-quotes"] as { "price-quote"?: CPQuote[] })?.[
    "price-quote"
  ];
  if (!quotes) throw new Error("Carrier returned no quotes");
  return array(quotes).map((q) => {
    const taxes = q["price-details"].taxes;
    const amounts = taxes ? Object.values(taxes).map((tax) =>
      tax && typeof tax === "object" ? (tax as { value?: string; "#text"?: string }).value ?? (tax as { "#text"?: string })["#text"] : undefined) : [];
    const taxTotal = amounts.length && amounts.every((value) => value !== undefined && Number.isFinite(Number(value)))
      ? amounts.reduce((total, value) => total.plus(value!), new Decimal(0)) : null;
    const std = q["service-standard"];
    const date = std?.["expected-delivery-date"];
    return {
      serviceCode: q["service-code"],
      apiResult: q,
      serviceName: q["service-name"],
      variant: "parcel",
      currency: "CAD",
      total: new Decimal(q["price-details"].due).toFixed(2),
      taxIncluded: true,
      preTaxTotal: taxTotal === null ? null : new Decimal(q["price-details"].due).minus(taxTotal).toFixed(2),
      eta: date
        ? {
            kind:
              std?.["guaranteed-delivery"] === "true"
                ? "guaranteed_date"
                : "estimated_date",
            date,
            businessDays: std?.["expected-transit-time"]
              ? Number(std["expected-transit-time"])
              : null,
          }
        : unavailableEta,
      breakdown: [
        {
          label: "Base before taxes/options",
          amount: new Decimal(q["price-details"].base).toFixed(2),
        },
      ],
      notices: [
        "Coverage eligibility and limits are determined by Canada Post.",
      ],
    };
  });
}
export function canadaPost(mode: Mode, settings?: CarrierConfig): CarrierAdapter {
  const c = settings ?? carrierConfig("canada_post", mode);
  return {
    carrier: "canada_post",
    isConfigured: () => credentialsConfigured("canada_post", mode, c),
    async getRates(s, o) {
      if (s.ship_from.country_code !== "CA")
        throw new Error("Canada Post requires a Canadian origin");
      const quoteType = c.get("QUOTE_TYPE") || "commercial";
      if (quoteType !== "commercial" && quoteType !== "counter")
        throw new CarrierResponseError("Canada Post quote type must be commercial or counter.");
      const text = await request(
        `${c.base}/rs/ship/price`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${Buffer.from(`${c.get("API_KEY")}:${c.get("API_SECRET")}`).toString("base64")}`,
            Accept: "application/vnd.cpc.ship.rate-v4+xml",
            "Content-Type": "application/vnd.cpc.ship.rate-v4+xml",
            "Accept-Language": "en-CA",
          },
          body: canadaPostRequest(
            s,
            o.coverage,
            c.get("CUSTOMER_NUMBER"),
            c.get("CONTRACT_ID"),
            quoteType,
          ),
        },
        o.signal,
      );
      const rows = parseCanadaPost(text);
      for (const row of rows) row.notices.push(quoteType === "counter" ? "Canada Post counter rates (retail); account/contract discounts are not applied." : "Canada Post commercial account rates.");
      return rows;
    },
  };
}
