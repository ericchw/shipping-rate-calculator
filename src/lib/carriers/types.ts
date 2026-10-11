import type { Shipment } from "../schemas";
import type { Carrier, Mode } from "../config";
export type Eta = {
  kind: "estimated_date" | "guaranteed_date" | "transit_days" | "unavailable";
  date: string | null;
  businessDays: number | null;
};
export type Quote = {
  apiResult?: unknown;
  serviceCode: string;
  serviceName: string;
  variant: string;
  currency: string;
  total: string;
  taxIncluded: boolean;
  preTaxTotal?: string | null;
  eta: Eta;
  breakdown: { label: string; amount: string }[];
  notices: string[];
};
export interface CarrierAdapter {
  carrier: Carrier;
  isConfigured(): boolean;
  getRates(
    request: Shipment,
    options: { coverage: boolean; signal: AbortSignal },
  ): Promise<Quote[]>;
}
export type RateRow = Omit<Quote, "total" | "taxIncluded" | "breakdown"> & {
  carrier: Carrier;
  mode: Mode;
  source: "mock" | "live_carrier";
  signature: {
    requested: boolean;
    available: boolean;
    includedInQuote: boolean;
  };
  withoutCoverage: {
    available: true;
    total: string;
    taxIncluded: boolean;
    preTaxTotal?: string | null;
    breakdown: Quote["breakdown"];
  };
  withCoverage: {
    apiResult?: unknown;
    available: boolean;
    total: string | null;
    taxIncluded: boolean | null;
    preTaxTotal?: string | null;
    breakdown: Quote["breakdown"];
    declaredValue: string | null;
    status: string;
  };
  coverageDifference: string | null;
};
export type Comparison = {
  requestId: string;
  quotedAt: string;
  mode: Mode;
  appEnvironment: string;
  results: RateRow[];
  carrierStatuses: {
    carrier: Carrier;
    mode: Mode;
    source: "mock" | "live_carrier";
    status: string;
    message: string | null;
  }[];
};
export const unavailableEta: Eta = {
  kind: "unavailable",
  date: null,
  businessDays: null,
};
