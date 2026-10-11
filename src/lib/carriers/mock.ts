import "server-only";
import type { Carrier } from "../config";
import type { CarrierAdapter, Quote } from "./types";
import fixtures from "../../../tests/fixtures/quotes.json";
export function mock(carrier: Carrier): CarrierAdapter {
  return {
    carrier,
    isConfigured: () => true,
    async getRates(s, o) {
      const destination = s.ship_to.country_code === "CA"
        ? "domestic"
        : s.ship_to.country_code === "US" ? "us" : "international";
      return fixtures
        .filter((f) => f.carrier === carrier && f.destinations.includes(destination))
        .map(
          (f) =>
            ({
              ...f,
              total: o.coverage ? f.covered : f.total,
              eta: { kind: "transit_days", date: null, businessDays: f.days },
              breakdown: [],
              notices: [
                "Synthetic fixture: not a carrier price or transit commitment.",
              ],
            }) as Quote,
        );
    },
  };
}
