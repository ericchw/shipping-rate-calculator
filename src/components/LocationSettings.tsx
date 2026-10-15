"use client";
import { useEffect, useState } from "react";
import { useSitePreferences } from "./SitePreferences";
import { formatSiteDate, formatSiteTime } from "@/lib/site-preferences";
const locales = { "en-CA": "Canada · English", "fr-CA": "Canada · French", "en-US": "United States", "en-GB": "United Kingdom", "en-AU": "Australia" };
export default function LocationSettings() {
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
    <div className="panel-title"><h2 id="location-time-heading">Location and time</h2></div>
    <div className="section">
      <p className="subtle">Choose the time zone used for today’s ship date and times across the site. Settings apply to production and sandbox in this browser.</p>
      <fieldset disabled={!ready} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="field-grid">
          <label>Location / time zone
            <select aria-label="Location / time zone" value={preferences.timeZone} onChange={(event) => update({ timeZone: event.target.value })}>
              {[...new Set([preferences.timeZone, ...zones, "UTC"])].sort().map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ").replaceAll("/", " / ")}</option>)}
            </select>
          </label>
          <label>Date and time region
            <select aria-label="Date and time region" value={preferences.locale} onChange={(event) => update({ locale: event.target.value })}>
              {Object.entries(locales).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>Time format
            <select aria-label="Time format" value={preferences.hour12 ? "12" : "24"} onChange={(event) => update({ hour12: event.target.value === "12" })}>
              <option value="12">12-hour · AM / PM</option><option value="24">24-hour</option>
            </select>
          </label>
        </div>
      </fieldset>
      {now && ready && <p className="inline-note">Today: {formatSiteDate(now, preferences)} · Local time: {formatSiteTime(now, preferences)}</p>}
      <p className="subtle" role="status">{storageAvailable ? "Changes save automatically in this browser." : "Changes apply for this visit. Browser storage is unavailable."}</p>
    </div>
  </section>;
}
