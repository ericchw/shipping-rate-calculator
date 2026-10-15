import type { Shipment } from "./schemas";
import type { AppMode } from "./app-routes";
export type LabelSummary = {
  id: string;
  mode: AppMode;
  service_code: string;
  label_id: string;
  shipment_number: string;
  created_at: string;
  ship_from?: Pick<Shipment["ship_from"], "city" | "region" | "postal_code">;
  ship_to?: Pick<Shipment["ship_to"], "city" | "region" | "postal_code">;
  ship_date?: string;
};
export type SavedLabel = LabelSummary & { shipment: Shipment; labels: string[] };
export const loomisLabelServices: Record<string, string> = {
  DD: "Loomis Ground", DE: "Loomis Express 18:00", DN: "Loomis Express 12:00", D9: "Loomis Express 9:00",
};
