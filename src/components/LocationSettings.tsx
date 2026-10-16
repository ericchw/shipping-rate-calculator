"use client";
import { useI18n } from "./UIPreferences";
import { useEffect, useState } from "react";
import { useSitePreferences } from "./SitePreferences";
import { formatSiteDate, formatSiteTime } from "@/lib/site-preferences";
const locales = { "en-CA": "Canada · English", "fr-CA": "Canada · French", "en-US": "United States", "en-GB": "United Kingdom", "en-AU": "Australia", "zh-TW": "繁體中文", "zh-CN": "简体中文" };
export default function LocationSettings() {
  const { t } = useI18n();
  const { preferences, ready, storageAvailable, update } = useSitePreferences();
  const [zones, setZones] = useState<string[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setZones(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["America/Vancouver", "America/Edmonton", "America/Winnipeg", "America/Toronto", "America/Halifax", "America/St_Johns", "Europe/London", "Australia/Sydney", "Asia/Tokyo", "UTC"]);
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <section className="panel" style={{ marginBottom: 24 }} aria-labelledby="location-time-heading">
    <div className="panel-title"><h2 id="location-time-heading">{t("Location and time")}</h2></div>
    <div className="section">
      <p className="subtle">{t("Choose the time zone used for today’s ship date and times across the site. Settings apply to production and sandbox in this browser.")}</p>
      <fieldset disabled={!ready} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="field-grid">
          <label>{t("Location / time zone")}{" "}<select aria-label={t("Location / time zone")} value={preferences.timeZone} onChange={(event) => update({ timeZone: event.target.value })}>
              {[...new Set([preferences.timeZone, ...zones, "UTC"])].sort().map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ").replaceAll("/", " / ")}</option>)}
            </select>
          </label>
          <label>{t("Date and time region")}{" "}<select aria-label={t("Date and time region")} value={preferences.locale} onChange={(event) => update({ locale: event.target.value })}>
              {Object.entries(locales).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
          </label>
          <label>{t("Time format")}{" "}<select aria-label={t("Time format")} value={preferences.hour12 ? "12" : "24"} onChange={(event) => update({ hour12: event.target.value === "12" })}>
              <option value="12">{t("12-hour · AM / PM")}</option><option value="24">{t("24-hour")}</option>
            </select>
          </label>
        </div>
      </fieldset>
      {now && ready && <p className="inline-note">{t("Today:")}{" "}{formatSiteDate(now, preferences)}{" "}{t("· Local time:")}{" "}{formatSiteTime(now, preferences)}</p>}
      <p className="subtle" role="status">{storageAvailable ? t("Changes save automatically in this browser.") : t("Changes apply for this visit. Browser storage is unavailable.")}</p>
    </div>
  </section>;
}
