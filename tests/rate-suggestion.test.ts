import { describe, expect, it } from "vitest";
import { rateTotal, suggestRate, taxLabel } from "../src/lib/rate-suggestion";
import type { RateRow } from "../src/lib/carriers/types";
const row = (code: string, total: string, days: number): RateRow => ({
  carrier: "fedex", serviceCode: code, serviceName: code, variant: "ACCOUNT", currency: "CAD",
  mode: "sandbox", source: "live_carrier", notices: [],
  eta: { kind: "transit_days", date: null, businessDays: days },
  signature: { requested: false, available: true, includedInQuote: false },
  withoutCoverage: { available: true, total, taxIncluded: true, preTaxTotal: total, breakdown: [] },
  withCoverage: { available: true, total, preTaxTotal: total, taxIncluded: true, breakdown: [], declaredValue: "500", status: "quoted" }, coverageDifference: "0",
});
describe("quote suggestion", () => {
  it("balances price and delivery instead of choosing an expensive fastest rate", () => {
    expect(suggestRate([row("slow", "20", 7), row("balanced", "30", 2), row("fast", "100", 1)], false)?.row.serviceCode).toBe("balanced");
  });
  it("uses covered totals and rejects unavailable coverage or unquoted required signatures", () => {
    const cheap = row("cheap", "10", 1), covered = row("covered", "25", 2);
    cheap.withCoverage.available = false;
    expect(suggestRate([cheap, covered], true)?.row.serviceCode).toBe("covered");
    covered.signature = { requested: true, available: false, includedInQuote: false };
    expect(suggestRate([covered], true)).toBeNull();
  });
  it("uses API pre-tax amounts and does not invent a tax deduction", () => {
    const quote = row("test", "113", 2);
    quote.withoutCoverage.preTaxTotal = "100";
    expect(rateTotal(quote, false, false)).toBe("100");
    expect(rateTotal(quote, false, true)).toBe("113");
    quote.withoutCoverage.preTaxTotal = null;
    expect(rateTotal(quote, false, false)).toBe("113");
    expect(taxLabel(quote, false, false)).toContain("pre-tax amount unavailable");
    expect(suggestRate([quote], false, false)).toBeNull();
  });
});
