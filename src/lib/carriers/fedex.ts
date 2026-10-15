import "server-only";
import Decimal from "decimal.js";
import { carrierConfig, credentialsConfigured, type CarrierConfig, type Mode } from "../config";
import type { Address, Shipment } from "../schemas";
import { convert, hasPackageDimensions } from "../units";
import { request } from "./transport";
import { unavailableEta, type CarrierAdapter, type Quote } from "./types";
const tokens = new Map<string, { value: string; expires: number }>();
const address = (a: Address) => ({
  streetLines: [a.address_line1, a.address_line2].filter(Boolean),
  city: a.city,
  stateOrProvinceCode: a.region,
  postalCode: a.postal_code,
  countryCode: a.country_code,
});
export function fedexRequest(s: Shipment, coverage: boolean, account: string) {
  const p = s.packages[0];
  return {
    accountNumber: { value: account },
    rateRequestControlParameters: { returnTransitTimes: true },
    requestedShipment: {
      shipper: { address: address(s.ship_from) },
      recipient: { address: address(s.ship_to) },
      shipDateStamp: s.shipDate,
      pickupType: "DROPOFF_AT_FEDEX_LOCATION",
      packagingType: "YOUR_PACKAGING",
      rateRequestType: ["ACCOUNT"],
      preferredCurrency: "CAD",
      requestedPackageLineItems: [
        {
          groupPackageCount: 1,
          weight: { units: "KG", value: convert(p.weight, p.weightUnit, "kg") },
          ...(hasPackageDimensions(p) ? { dimensions: {
            units: "CM",
            length: Math.ceil(convert(p.length, p.dimensionUnit, "cm")),
            width: Math.ceil(convert(p.width, p.dimensionUnit, "cm")),
            height: Math.ceil(convert(p.height, p.dimensionUnit, "cm")),
          } } : {}),
          ...(coverage
            ? {
                declaredValue: {
                  amount: new Decimal(s.coverageAmount).toFixed(2),
                  currency: "CAD",
                },
              }
            : {}),
          ...(s.signatureRequired
            ? {
                packageSpecialServices: {
                  specialServiceTypes: ["SIGNATURE_OPTION"],
                  signatureOptionType: "DIRECT",
                },
              }
            : {}),
        },
      ],
    },
  };
}
type FedexDetail = {
  rateType: string;
  currency?: string;
  totalNetCharge?: number | string;
  totalNetFedExCharge?: number | string;
  totalNetChargeWithDutiesAndTaxes?: number | string;
  shipmentRateDetail?: {
    currency?: string;
    totalTaxes?: number;
    surCharges?: { description: string; amount: number }[];
  };
};
type FedexReply = {
  serviceType: string;
  serviceName?: string;
  packagingType?: string;
  operationalDetail?: { deliveryDate?: string; transitTime?: string };
  ratedShipmentDetails?: FedexDetail[];
};
export function parseFedex(text: string): Quote[] {
  const data = JSON.parse(text) as {
    output?: { rateReplyDetails?: FedexReply[] };
    errors?: unknown[];
  };
  if (data.errors?.length || !data.output?.rateReplyDetails)
    throw new Error("Carrier returned no rates");
  return data.output.rateReplyDetails.flatMap((r) =>
    (r.ratedShipmentDetails?.some((d) => d.rateType === "ACCOUNT")
      ? r.ratedShipmentDetails.filter((d) => d.rateType === "ACCOUNT")
      : r.ratedShipmentDetails ?? []).flatMap((d) => {
      const total = d.totalNetChargeWithDutiesAndTaxes ?? d.totalNetCharge;
      if (total === undefined) return [];
      const date = r.operationalDetail?.deliveryDate?.slice(0, 10);
      return [
        {
          serviceCode: r.serviceType,
          apiResult: r,
          serviceName: r.serviceName ?? r.serviceType.replaceAll("_", " "),
          variant: `${r.packagingType ?? "YOUR_PACKAGING"}:${d.rateType}`,
          currency: d.currency ?? d.shipmentRateDetail?.currency ?? "UNKNOWN",
          total: new Decimal(total).toFixed(2),
          taxIncluded: d.totalNetChargeWithDutiesAndTaxes !== undefined || d.shipmentRateDetail?.totalTaxes !== undefined || (d.totalNetFedExCharge !== undefined && d.totalNetCharge !== undefined),
          preTaxTotal: d.totalNetFedExCharge !== undefined ? new Decimal(d.totalNetFedExCharge).toFixed(2)
            : d.shipmentRateDetail?.totalTaxes !== undefined && d.totalNetCharge !== undefined
              ? new Decimal(d.totalNetCharge).minus(d.shipmentRateDetail.totalTaxes).toFixed(2) : null,
          eta: date
            ? { kind: "estimated_date" as const, date, businessDays: null }
            : unavailableEta,
          breakdown: (d.shipmentRateDetail?.surCharges ?? []).map((x) => ({
            label: x.description,
            amount: new Decimal(x.amount).toFixed(2),
          })),
          notices: [
            "Declared value is subject to FedEx liability limits; it is not shipment insurance.",
            "Dimensions are rounded up to whole centimetres at the carrier boundary.",
          ],
        },
      ];
    }),
  );
}
export function fedex(mode: Mode, settings?: CarrierConfig): CarrierAdapter {
  const c = settings ?? carrierConfig("fedex", mode);
  const identity = [
    mode,
    c.get("CLIENT_ID"),
    c.get("ACCOUNT_NUMBER"),
    c.get("CLIENT_SECRET"),
  ].join(":");
  return {
    carrier: "fedex",
    isConfigured: () => credentialsConfigured("fedex", mode, c),
    async getRates(s, o) {
      let token = tokens.get(identity);
      if (!token || token.expires < Date.now()) {
        const data = JSON.parse(
          await request(
            `${c.base}/oauth/token`,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: c.get("CLIENT_ID"),
                client_secret: c.get("CLIENT_SECRET"),
              }).toString(),
            },
            o.signal,
          ),
        ) as { access_token: string; expires_in: number };
        if (!data.access_token || !Number.isFinite(data.expires_in))
          throw new Error("Invalid OAuth response");
        token = {
          value: data.access_token,
          expires: Date.now() + (data.expires_in - 60) * 1000,
        };
        if (tokens.size >= 100) tokens.clear();
        tokens.set(identity, token);
      }
      try {
        return parseFedex(
          await request(
            `${c.base}/rate/v1/rates/quotes`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token.value}`,
                "Content-Type": "application/json",
                "X-locale": "en_CA",
              },
              body: JSON.stringify(
                fedexRequest(s, o.coverage, c.get("ACCOUNT_NUMBER")),
              ),
            },
            o.signal,
          ),
        );
      } catch (e) {
        tokens.delete(identity);
        throw e;
      }
    },
  };
}
