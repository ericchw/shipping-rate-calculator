import { describe, expect, it } from "vitest";
import { translate } from "../src/lib/i18n";
import { readUIPreferences, defaultUIPreferences } from "../src/lib/ui-preferences";
import messages from "../src/lib/translations.json";
describe("UI languages and appearance preferences", () => {
  it("accepts the four languages and three themes, preserving old browser settings safely", () => {
    expect(readUIPreferences(null)).toEqual(defaultUIPreferences);
    expect(readUIPreferences({ language:"unknown",theme:"unknown" })).toEqual(defaultUIPreferences);
    for (const language of ["en","fr","zh-TW","zh-CN"]) for (const theme of ["system","light","dark"])
      expect(readUIPreferences({language,theme})).toEqual({language,theme});
  });
  it("translates navigation, shipment inputs and dynamic messages without changing protocol or user data", () => {
    expect(translate("Ship To","fr")).toBe("Destinataire");
    expect(translate("Ship To","zh-TW")).toBe("收件地址");
    expect(translate("Boxes","zh-CN")).toBe("箱数");
    expect(translate("3 business days","fr")).toBe("3 jours ouvrables");
    expect(translate("2026-10-19 · 2 business days","zh-TW")).toBe("2026-10-19 · 2 個工作日");
    expect(translate("Request copied: Purolator.","zh-CN")).toBe("已复制请求：Purolator。");
    for (const value of ["carrierMode","PurolatorExpress9AM","6045550100","123 Example Street","V6V2K9"])
      expect(translate(value,"fr")).toBe(value);
    expect(translate("  Ship To  ","fr")).toBe("  Destinataire  ");
  });
  it("has a complete French, traditional Chinese and simplified Chinese entry for every catalog key", () => {
    for (const [key,values] of Object.entries(messages)) {
      expect(values,key).toHaveLength(3);
      for (const value of values) expect(value.trim(),key).not.toBe("");
      const placeholders=key.match(/\{\w+\}/g)?.sort() ?? [];
      for (const value of values) expect(value.match(/\{\w+\}/g)?.sort() ?? [],key).toEqual(placeholders);
    }
  });
});
