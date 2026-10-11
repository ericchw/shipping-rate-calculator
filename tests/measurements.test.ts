import { describe, it, expect } from "vitest";
import { convert, measurementValue, roundMeasurementUp } from "../src/lib/units";
import { shipmentSchema } from "../src/lib/schemas";

describe("package measurement defaults and rounding", () => {
  it("uses 1 for empty or zero inputs and rounds upward without floating-point over-rounding", () => {
    expect(measurementValue("")).toBe(1);
    expect(measurementValue(" ")).toBe(1);
    expect(measurementValue(0)).toBe(1);
    expect(measurementValue("1.001")).toBe(1.01);
    expect(measurementValue("1.234")).toBe(1.24);
    expect(measurementValue("1.23")).toBe(1.23);
    expect(roundMeasurementUp(convert(5, "lb", "kg"))).toBe(2.27);
    expect(roundMeasurementUp(convert(12, "in", "cm"))).toBe(30.48);
  });
  it("allows a quote with cleared measurements while preserving rejection of negative measurements", () => {
    const input = {
      ship_from: { city: "Vancouver", region: "BC", postal_code: "V6B1A1" },
      ship_to: { city: "Toronto", region: "ON", postal_code: "M5V2T6" },
      shipDate: "2026-10-13",
      packages: [{ weight: measurementValue(""), length: measurementValue(""), width: measurementValue(""), height: measurementValue(""), weightUnit: "lb", dimensionUnit: "in" }],
    };
    expect(shipmentSchema.safeParse(input).success).toBe(true);
    expect(shipmentSchema.safeParse({ ...input, packages: [{ ...input.packages[0], weight: measurementValue(-1) }] }).success).toBe(false);
  });
});
