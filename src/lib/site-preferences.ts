export type SitePreferences = { timeZone: string; locale: string; hour12: boolean };
export const defaultSitePreferences: SitePreferences = { timeZone: "America/Vancouver", locale: "en-CA", hour12: false };
export const sitePreferencesKey = "shipping:location-time";
export const dateLocales = ["en-CA", "fr-CA", "en-US", "en-GB", "en-AU", "zh-TW", "zh-CN"] as const;
export function validTimeZone(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { new Intl.DateTimeFormat("en-CA", { timeZone: value }); return true; } catch { return false; }
}
export function readSitePreferences(value: unknown, fallback = defaultSitePreferences): SitePreferences {
  const saved = value && typeof value === "object" ? value as Partial<SitePreferences> : {};
  return {
    timeZone: validTimeZone(saved.timeZone) ? saved.timeZone : fallback.timeZone,
    locale: dateLocales.includes(saved.locale as typeof dateLocales[number]) ? saved.locale! : fallback.locale,
    hour12: typeof saved.hour12 === "boolean" ? saved.hour12 : fallback.hour12,
  };
}
export function formatSiteTime(value: string | Date, preferences: SitePreferences) {
  return new Intl.DateTimeFormat(preferences.locale, { timeZone: preferences.timeZone, hour12: preferences.hour12,
    hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export function formatSiteDate(value: Date, preferences: SitePreferences) {
  return new Intl.DateTimeFormat(preferences.locale, { timeZone: preferences.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}
