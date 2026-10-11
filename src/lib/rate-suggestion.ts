import type { RateRow } from "./carriers/types";

export function rateTotal(row: RateRow, coverage: boolean, includeTax = true) {
  const rate = coverage ? row.withCoverage : row.withoutCoverage;
  if (!rate.available) return null;
  return includeTax ? rate.total : rate.preTaxTotal ?? rate.total;
}
export function taxLabel(row: RateRow, coverage: boolean, includeTax: boolean) {
  const rate = coverage ? row.withCoverage : row.withoutCoverage;
  return includeTax ? rate.taxIncluded ? "Tax included" : "Tax basis unconfirmed"
    : rate.preTaxTotal != null ? "Tax excluded" : "Returned total · pre-tax amount unavailable";
}
export function comparableTax(row: RateRow, coverage: boolean, includeTax: boolean) {
  const rate = coverage ? row.withCoverage : row.withoutCoverage;
  return includeTax ? rate.taxIncluded === true : rate.preTaxTotal != null;
}

// Compare like-for-like CAD totals. Delivery and price have equal weight;
// when no delivery information is returned, suggest by price only.
export function suggestRate(rows: RateRow[], coverage: boolean, includeTax = true) {
  const candidates = rows.filter((row) => {
    const total = rateTotal(row, coverage, includeTax);
    return row.currency === "CAD" && total !== null && Number.isFinite(Number(total)) &&
      comparableTax(row, coverage, includeTax) &&
      (!row.signature.requested || (row.signature.available && row.signature.includedInQuote));
  });
  const dates = candidates.filter((row) => row.eta.date && Number.isFinite(Date.parse(row.eta.date)));
  // Dates and transit-day counts are separate scales; prefer actual returned dates.
  const pool = dates.length ? dates : candidates.some((row) => row.eta.businessDays !== null)
    ? candidates.filter((row) => row.eta.businessDays !== null) : candidates;
  if (!pool.length) return null;
  const delivery = (row: RateRow) => dates.length ? Date.parse(row.eta.date!) / 86400000 : row.eta.businessDays ?? 0;
  const costs = pool.map((row) => Number(rateTotal(row, coverage, includeTax)));
  const times = pool.map(delivery);
  const minPrice = Math.min(...costs), priceRange = Math.max(...costs) - minPrice;
  const minTime = Math.min(...times), timeRange = Math.max(...times) - minTime;
  const score = (row: RateRow) => (priceRange ? (Number(rateTotal(row, coverage, includeTax)) - minPrice) / priceRange : 0) +
    (timeRange ? (delivery(row) - minTime) / timeRange : 0);
  return {
    row: pool.toSorted((a, b) => score(a) - score(b) || Number(rateTotal(a, coverage, includeTax)) - Number(rateTotal(b, coverage, includeTax)) || delivery(a) - delivery(b))[0],
    deliveryCompared: dates.length > 0 || pool.some((row) => row.eta.businessDays !== null),
  };
}
