import "server-only";
import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { carrierConfig, credentialsConfigured, type CarrierConfig, type Mode } from "../config";
import type { Address, Shipment } from "../schemas";
import { convert, hasPackageDimensions } from "../units";
import { CarrierResponseError, request } from "./transport";
import { type CarrierAdapter, type Quote } from "./types";

const tokens = new Map<string, { value: string; expires: number }>();
const address = (a: Address) => ({
  ...(a.company ? { companyName: a.company } : {}),
  ...([a.address_line1, a.address_line2].some(Boolean) ? {
    streetAddress: [a.address_line1, a.address_line2].filter(Boolean),
  } : {}),
  city: a.city,
  provinceStateCode: a.region,
  country: a.country_code,
  postalZipCode: a.postal_code,
});

export function purolatorRequest(s: Shipment, coverage: boolean, senderAccount: string) {
  // The published REST courier schema currently accepts Canadian senders only.
  if (s.ship_from.country_code !== "CA")
    throw new CarrierResponseError("Purolator courier estimates currently require a Canadian sender.");
  const parcel = s.packages[0];
  const quantity = parcel.quantity ?? 1;
  const packageWeight = Number(new Decimal(parcel.weight).toFixed(2, Decimal.ROUND_UP));
  const metric = parcel.weightUnit === "kg";
  const measurement = (value: number, from: "cm" | "in") =>
    Number(new Decimal(convert(value, from, metric ? "cm" : "in")).toFixed(2, Decimal.ROUND_UP));
  const options = [
    ...(s.signatureRequired ? [{ optionId: s.ship_to.country_code === "CA" ? "ResidentialSignatureDomestic" : "ResidentialSignatureIntl", optionIdValue: "true" }] : []),
    ...(coverage && s.coverageAmount > 0 ? [{ optionId: "DeclaredValue", optionIdValue: new Decimal(s.coverageAmount).toFixed(2) }] : []),
  ];
  return {
    lineOfBusiness: "Courier",
    shipmentDate: s.shipDate,
    outboundShipment: {
      billingInformation: { billingAccountNumber: senderAccount, displayPublishedRates: false },
      senderInformation: address(s.ship_from),
      receiverInformation: address(s.ship_to),
      shipmentInformation: {
        serviceId: s.ship_to.country_code === "CA" ? "PurolatorGround" : s.ship_to.country_code === "US" ? "PurolatorGroundU.S." : "PurolatorExpressInternational",
        showAlternativeServicesIndicator: true,
        unitOfMeasurement: metric ? "Metric" : "Imperial",
        totalWeight: new Decimal(packageWeight).times(quantity).toNumber(),
        totalPackages: quantity,
        packageInformation: Array.from({ length: quantity }, () => ({
          packageWeight,
          ...(hasPackageDimensions(parcel) ? {
            packageLength: measurement(parcel.length, parcel.dimensionUnit),
            packageWidth: measurement(parcel.width, parcel.dimensionUnit),
            packageHeight: measurement(parcel.height, parcel.dimensionUnit),
          } : {}),
        })),
        ...(options.length ? { shipmentOptionsInformation: options } : {}),
      },
    },
  };
}

const money = z.union([z.number(), z.string().regex(/^\d+(?:\.\d+)?$/)])
  .refine(value => new Decimal(value).isFinite() && new Decimal(value).gte(0));
const charge = z.object({ amount: money, type: z.string().optional(), id: z.string().optional(), description: z.string().optional() });
const charges = (wrapper: "surcharge" | "tax" | "optionPrice") => z.array(z.union([
  z.object({ [wrapper]: charge }).transform(item => item[wrapper]), charge,
]));
const estimate = z.object({
  serviceId: z.string().min(1), totalPrice: money,
  subTotal: money.optional(), basePrice: money.optional(),
  expectedDeliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
    const date = new Date(value); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }).nullish(),
  estimatedTransitDays: z.number().int().nonnegative().nullish(),
  taxes: charges("tax").optional(),
  surcharges: charges("surcharge").optional(),
  optionPrices: charges("optionPrice").optional(),
});
const errorInfo = z.object({ code: z.string().optional(), description: z.string().optional() });
function errorDetails(text: string, sensitive: string[]) {
  try {
    const data = JSON.parse(text);
    const messages: unknown[] = [data.error_description, data.errorSummary, data.message,
      ...(Array.isArray(data.errors) ? data.errors.map((item: { error?: { description?: string }; description?: string }) => item.error?.description ?? item.description) : [])];
    const detail = messages.filter((item): item is string => typeof item === "string").slice(0, 3).join(" ");
    return sensitive.filter(Boolean).reduce((value, secret) => value.split(secret).join("[redacted]"), detail)
      .replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 600) || undefined;
  } catch { return undefined; }
}
export function parsePurolator(text: string, sensitive: string[] = []): Quote[] {
  const parsed = z.object({
    errors: z.array(z.union([z.object({ error: errorInfo }).transform(item => item.error), errorInfo])).optional(),
    outboundShipmentEstimates: z.union([
      z.object({ shipmentEstimate: z.array(estimate) }).transform(item => item.shipmentEstimate),
      z.array(z.object({ shipmentEstimate: estimate })).transform(items => items.map(item => item.shipmentEstimate)),
    ]).optional(),
  }).safeParse(JSON.parse(text));
  if (!parsed.success) throw new CarrierResponseError("Purolator returned an invalid estimate response.");
  if (parsed.data.errors?.length) {
    const code = parsed.data.errors[0].code;
    throw new CarrierResponseError(`Purolator rejected the estimate${code && /^[A-Za-z0-9_.-]{1,100}$/.test(code) ? ` (${code})` : ""}. ${(sensitive.length ? errorDetails(text, sensitive) : undefined) || "Check the account and shipment details."}`);
  }
  if (!parsed.data.outboundShipmentEstimates) throw new CarrierResponseError("Purolator returned no estimate data.");
  return parsed.data.outboundShipmentEstimates.map(rate => {
    const date = rate.expectedDeliveryDate ?? null;
    const days = rate.estimatedTransitDays ?? null;
    // totalPrice includes taxes per the REST estimate schema; never add them again.
    const total = new Decimal(rate.totalPrice);
    const preTax = rate.subTotal !== undefined ? new Decimal(rate.subTotal)
      : rate.taxes !== undefined ? total.minus(rate.taxes.reduce((sum, item) => sum.plus(item.amount), new Decimal(0))) : null;
    if (preTax?.isNegative() || preTax?.gt(total)) throw new CarrierResponseError("Purolator returned inconsistent estimate totals.");
    return {
      serviceCode: rate.serviceId,
      serviceName: rate.serviceId.replace(/^Purolator/, "Purolator ").replace(/(Express|Ground)(?=\S)/, "$1 "),
      variant: "courier:account",
      currency: "CAD",
      total: total.toFixed(2), taxIncluded: true, preTaxTotal: preTax?.toFixed(2) ?? null,
      eta: { kind: date ? "estimated_date" : days !== null ? "transit_days" : "unavailable", date, businessDays: days },
      breakdown: [
        ...(rate.basePrice !== undefined ? [{ label: "Base rate", amount: new Decimal(rate.basePrice).toFixed(2) }] : []),
        ...[...(rate.surcharges ?? []), ...(rate.optionPrices ?? []), ...(rate.taxes ?? [])].map(item => ({
          label: item.description || item.type || item.id || "Charge", amount: new Decimal(item.amount).toFixed(2),
        })),
      ],
      apiResult: rate,
      notices: ["Purolator courier account estimate in CAD. Final charges depend on actual shipment details.",
        "Declared value is subject to Purolator liability terms; it is not shipment insurance."],
    } satisfies Quote;
  });
}

export function purolator(mode: Mode, settings?: CarrierConfig): CarrierAdapter {
  const c = settings ?? carrierConfig("purolator", mode);
  const identity = createHash("sha256").update(JSON.stringify([mode, c.base, c.get("CLIENT_ID"), c.get("CLIENT_SECRET"), c.get("API_KEY")])).digest("hex");
  return {
    carrier: "purolator",
    isConfigured: () => credentialsConfigured("purolator", mode, c),
    async getRates(s, options) {
      if (!credentialsConfigured("purolator", mode, c))
        throw new CarrierResponseError(mode === "sandbox"
          ? "Save Purolator client ID, client secret and test sender account before requesting UAT rates."
          : "Save Purolator REST API key, client ID, client secret and sender account before requesting production rates.");
      const body = purolatorRequest(s, options.coverage, c.get("SENDER_ACCOUNT"));
      let token = tokens.get(identity);
      const sensitive = [
        ...["API_KEY", "CLIENT_ID", "CLIENT_SECRET", "SENDER_ACCOUNT", "RECEIVER_ACCOUNT", "FREIGHT_ACCOUNT"].map(key => c.get(key)),
        Buffer.from(`${c.get("CLIENT_ID")}:${c.get("CLIENT_SECRET")}`).toString("base64"),
        ...[...Object.values(s.ship_from), ...Object.values(s.ship_to)].filter(value => value.length >= 4),
      ];
      const describeError = (text: string) => errorDetails(text, [...sensitive, token?.value ?? ""]);
      try {
        if (!token || token.expires <= Date.now()) {
          const auth = z.object({ access_token: z.string().min(1), token_type: z.string().regex(/^Bearer$/i), expires_in: z.number().positive().finite() }).safeParse(JSON.parse(await request(`${c.base}/auth/v1/token`, {
            method: "POST",
            headers: { Authorization: `Basic ${Buffer.from(`${c.get("CLIENT_ID")}:${c.get("CLIENT_SECRET")}`).toString("base64")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ grant_type: "client_credentials", scope: "portal_api" }),
          }, options.signal, 3, describeError)));
          if (!auth.success) throw new CarrierResponseError("Purolator returned an invalid authentication response.");
          token = { value: auth.data.access_token, expires: Date.now() + Math.max(0, auth.data.expires_in - 60) * 1000 };
          if (tokens.size >= 100) tokens.clear();
          tokens.set(identity, token);
        }
        return parsePurolator(await request(`${c.base}/rate/v1/shipment`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token.value}`, ...(c.get("API_KEY") ? { "x-api-key": c.get("API_KEY") } : {}), "Content-Type": "application/json", Language: "en" },
          body: JSON.stringify(body),
        }, options.signal, 3, describeError), [...sensitive, token.value]);
      } catch (error) {
        tokens.delete(identity);
        throw error;
      }
    },
  };
}
