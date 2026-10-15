import "server-only";
import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import {
  appEnvironment,
  configured,
  mockEnabled,
  type Carrier,
} from "./config";
import { loomis } from "./carriers/loomis";
import { mock } from "./carriers/mock";
import type { Shipment } from "./schemas";
import type { Comparison, Quote, RateRow } from "./carriers/types";
import { CarrierApiError, CarrierResponseError } from "./carriers/transport";
import { hasPackageDimensions } from "./units";
import { CarrierSettings } from "./carrier-settings";
export function difference(base: Quote, covered?: Quote) {
  return covered &&
    base.currency === covered.currency &&
    base.taxIncluded === covered.taxIncluded
    ? new Decimal(covered.total).minus(base.total).toFixed(2)
    : null;
}
export async function compare(s: Shipment, owner?: string, groupId?: string): Promise<Comparison> {
  const mode = s.carrierMode;
  const source = mockEnabled(mode) ? "mock" : "live_carrier";
  const output: Comparison = {
    requestId: randomUUID(),
    quotedAt: new Date().toISOString(),
    mode,
    appEnvironment: appEnvironment(),
    results: [],
    carrierStatuses: [],
  };
  await Promise.all(
    s.carriers.map(async (carrier: Carrier) => {
      const saved = owner ? await new CarrierSettings(undefined, undefined, groupId).config(owner, carrier, mode) : undefined;
      if (saved && !saved.enabled) {
        output.carrierStatuses.push({ carrier, mode, source, status: "disabled", message: "Disabled in your company group’s carrier settings." });
        return;
      }
      const status = saved ? "configured" : configured(carrier, mode);
      const adapter =
        source === "mock"
          ? mock(carrier)
          : carrier === "canada_post"
            ? (await import("./carriers/canada-post")).canadaPost(mode, saved)
            : carrier === "fedex"
              ? (await import("./carriers/fedex")).fedex(mode, saved)
              : loomis(mode, saved);
      if (status !== "configured" || !adapter.isConfigured()) {
        output.carrierStatuses.push({
          carrier,
          mode,
          source,
          status: "unconfigured",
          message:
            carrier === "loomis"
              ? "Ask an administrator to configure Loomis for your company group."
              : "Credentials missing for this mode",
        });
        return;
      }
      const controller = new AbortController();
      const milliseconds = Math.min(
        30000,
        Math.max(1000, Number(process.env.CARRIER_TIMEOUT_MS) || 12000),
      );
      const timer = setTimeout(() => controller.abort(), milliseconds);
      try {
        const base = await adapter.getRates(s, {
          coverage: false,
          signal: controller.signal,
        });
        let covered: Quote[] = [];
        let coveredFailed = false;
        let coveredError = "";
        if (s.coverageAmount > 0) {
          try {
            covered = await adapter.getRates(s, {
              coverage: true,
              signal: controller.signal,
            });
          } catch (error) {
            coveredFailed = true;
            coveredError = error instanceof CarrierApiError || error instanceof CarrierResponseError ? error.message : "Declared-value quote failed";
          }
        }
        const used = new Set<string>();
        for (const q of base) {
          const key = `${q.serviceCode}:${q.variant}:${q.currency}:${q.taxIncluded}`;
          if (used.has(key)) continue;
          used.add(key);
          const match = covered.find(
            (c) =>
              c.serviceCode === q.serviceCode &&
              c.variant === q.variant &&
              c.currency === q.currency &&
              c.taxIncluded === q.taxIncluded,
          );
          const row: RateRow = {
            ...q,
            carrier,
            mode,
            source,
            signature: {
              requested: s.signatureRequired,
              available: true,
              includedInQuote: s.signatureRequired,
            },
            withoutCoverage: {
              available: true,
              total: q.total,
              taxIncluded: q.taxIncluded,
              preTaxTotal: q.preTaxTotal ?? null,
              breakdown: q.breakdown,
            },
            withCoverage: {
              apiResult: match?.apiResult,
              available: !!match,
              total: match?.total ?? null,
              taxIncluded: match?.taxIncluded ?? null,
              preTaxTotal: match?.preTaxTotal ?? null,
              breakdown: match?.breakdown ?? [],
              declaredValue: match
                ? new Decimal(s.coverageAmount).toFixed(2)
                : null,
              status:
                s.coverageAmount === 0
                  ? "not_quoted"
                  : match
                    ? "quoted"
                    : coveredFailed
                      ? "carrier_error"
                      : "not_supported",
            },
            coverageDifference: difference(q, match),
            notices: [
              ...q.notices,
              ...(!hasPackageDimensions(s.packages[0]) ? ["Package dimensions were not provided. Actual measurements may change final charges."] : []),
              ...(coveredFailed
                ? [`${coveredError} Base quote retained.`]
                : []),
            ],
          };
          output.results.push(row);
        }
        output.carrierStatuses.push({
          carrier,
          mode,
          source,
          status: base.length ? (coveredFailed ? "partial" : "success") : "unavailable",
          message: coveredFailed
            ? `Base rates returned; ${coveredError}`
            : null,
        });
      } catch (error) {
        output.carrierStatuses.push({
          carrier,
          mode,
          source,
          status: controller.signal.aborted ? "timeout" : "error",
          message: controller.signal.aborted
            ? "Carrier request timed out"
            : error instanceof CarrierApiError || error instanceof CarrierResponseError
              ? error.message
              : "Carrier could not quote this shipment. Check account eligibility and shipment details.",
        });
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return output;
}
