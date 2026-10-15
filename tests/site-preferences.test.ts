import { expect, it } from "vitest";
import { defaultSitePreferences, formatSiteDate, formatSiteTime, readSitePreferences } from "../src/lib/site-preferences";
import { todayInTimeZone } from "../src/lib/units";
it("uses the selected time zone for today across midnight and daylight saving transitions", () => {
  const now = new Date("2026-10-14T02:00:00Z");
  expect(todayInTimeZone("America/Vancouver", now)).toBe("2026-10-13");
  expect(todayInTimeZone("Asia/Tokyo", now)).toBe("2026-10-14");
  expect(todayInTimeZone("America/Vancouver", new Date("2026-03-08T09:30:00Z"))).toBe("2026-03-08");
  expect(todayInTimeZone("America/Vancouver", new Date("2026-03-08T10:30:00Z"))).toBe("2026-03-08");
});
it("rejects invalid stored preferences and preserves valid settings", () => {
  expect(readSitePreferences({ timeZone: "bad-zone", locale: "bad-locale", hour12: "yes" })).toEqual(defaultSitePreferences);
  const saved = { timeZone: "Asia/Tokyo", locale: "en-GB", hour12: true };
  expect(readSitePreferences(saved)).toEqual(saved);
  expect(readSitePreferences(null, saved)).toEqual(saved);
});
it("formats date and time with the chosen region and clock", () => {
  const now = new Date("2026-10-14T02:15:30Z");
  const preferences = { timeZone: "Asia/Tokyo", locale: "en-GB", hour12: false };
  expect(formatSiteTime(now, preferences)).toContain("11:15:30");
  expect(formatSiteDate(now, preferences)).toBe("14/10/2026");
  expect(formatSiteTime(now, { ...preferences, timeZone: "America/Vancouver", hour12: true })).toMatch(/07:15:30.*pm/i);
});
