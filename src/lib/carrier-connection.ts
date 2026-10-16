import "server-only";
import { CarrierSettings } from "./carrier-settings";
import { credentialsConfigured, type Carrier, type Mode } from "./config";
import { fedex } from "./carriers/fedex";
import { canadaPost } from "./carriers/canada-post";
import { purolator } from "./carriers/purolator";
import { loomis } from "./carriers/loomis";
import { CarrierApiError, CarrierResponseError } from "./carriers/transport";
import { shipmentSchema } from "./schemas";
import { nextBusinessDay } from "./units";
export async function testCarrierConnection(owner: string, carrier: Carrier, mode: Mode, groupId?: string) {
  const config = await new CarrierSettings(undefined, undefined, groupId).config(owner, carrier, mode);
  if (!credentialsConfigured(carrier, mode, config)) return {
    status: "unconfigured", message: "Save the required API URL and credentials before testing.",
  };
  const adapter = carrier === "fedex" ? fedex(mode, config) : carrier === "canada_post" ? canadaPost(mode, config) : carrier === "purolator" ? purolator(mode, config) : loomis(mode, config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  const started = Date.now();
  try {
    const rates = await adapter.getRates(shipmentSchema.parse({
      ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1", country_code: "CA", address_line1: "700 W Georgia St", contact_name: "Connection Check", phone: "6045550100" },
      ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6", country_code: "CA", address_line1: "301 Front St W", contact_name: "Connection Check", phone: "4165550100" },
      shipDate: nextBusinessDay(), packages: [{ length: 12, width: 8, height: 6, dimensionUnit: "in", weight: 5, weightUnit: "lb" }],
      carriers: [carrier], carrierMode: mode, coverageAmount: 0,
    }), { coverage: false, signal: controller.signal });
    return { status: rates.length ? "success" : "unavailable", message: rates.length ? `Connected · ${rates.length} services returned` : "Connected, but no services returned for the check shipment.", milliseconds: Date.now() - started };
  } catch (error) {
    return { status: controller.signal.aborted ? "timeout" : "error", message: controller.signal.aborted ? "Carrier request timed out."
      : error instanceof CarrierApiError || error instanceof CarrierResponseError ? error.message : "Connection failed. Check the saved credentials and account eligibility.", milliseconds: Date.now() - started };
  } finally { clearTimeout(timer); }
}
