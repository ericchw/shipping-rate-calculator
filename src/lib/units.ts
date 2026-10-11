import Decimal from "decimal.js";
export function roundMeasurementUp(value: number) {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_CEIL).toNumber();
}
export function measurementValue(value: number | string) {
  return roundMeasurementUp(Number(value) === 0 ? 1 : Number(value));
}
export function convert(value: number, from: string, to: string): number {
  if (from === to) return value;
  const factor = from === "in" || to === "in" ? "2.54" : "0.45359237";
  return new Decimal(value)
    [from === "in" || from === "lb" ? "mul" : "div"](factor)
    .toNumber();
}
export function nextBusinessDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  const d = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00Z`);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
