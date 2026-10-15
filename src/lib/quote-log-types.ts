import type { AppMode } from "./app-routes";
import type { Shipment } from "./schemas";
import type { Comparison } from "./carriers/types";
export type QuoteLogSummary = { id: string; mode: AppMode; created_at: string; ship_from: Pick<Shipment["ship_from"], "city" | "region" | "postal_code">; ship_to: Pick<Shipment["ship_to"], "city" | "region" | "postal_code">; shipDate: string; weight: number; weightUnit: string; rateCount: number; status: "comparing" | "completed" | "partial" | "no_rates" };
export type QuoteLog = QuoteLogSummary & { shipment: Shipment; comparison: Comparison };
