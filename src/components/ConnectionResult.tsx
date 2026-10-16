"use client";
import { useI18n } from "./UIPreferences";
import { useSitePreferences } from "./SitePreferences";
import { formatSiteTime } from "@/lib/site-preferences";
export type ConnectionCheck = { status: string; message: string; milliseconds?: number; checkedAt?: string };
const titles: Record<string, string> = {
  checking: "Checking connection", success: "Connected", error: "Connection failed",
  timeout: "Request timed out", unavailable: "Connected · no rates returned", unconfigured: "Credentials needed",
};
export default function ConnectionResult({ result }: { result: ConnectionCheck }) {
  const { t } = useI18n();
  const { preferences } = useSitePreferences();
  const checking = result.status === "checking";
  const success = result.status === "success";
  const warning = result.status === "unavailable" || result.status === "unconfigured";
  return <div className={`connection-result ${success ? "success" : checking ? "checking" : warning ? "warning" : "error"}`} role="status" aria-live="polite" aria-busy={checking}>
    <span className="connection-result-icon" aria-hidden="true">{checking ? <span className="quote-spinner" /> : success ? "✓" : warning ? "!" : "×"}</span>
    <div className="connection-result-content"><strong>{titles[result.status] ?? t("Connection result")}</strong><p>{t(success ? result.message.replace(/^Connected\s*·\s*/i, "") : result.message)}</p>
      {!checking && <div className="connection-result-meta">
        {result.milliseconds !== undefined && <span>{t("Response")}{" "}{(result.milliseconds / 1000).toFixed(2)}s</span>}
        {result.checkedAt && <time dateTime={result.checkedAt}>{t("Checked")}{" "}{formatSiteTime(result.checkedAt, preferences)}</time>}
      </div>}
    </div>
  </div>;
}
