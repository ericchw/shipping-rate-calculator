"use client";
import { useI18n } from "./UIPreferences";
import { useEffect, useState } from "react";
import { clientApi } from "@/lib/client-api";
import type { AppMode } from "@/lib/app-routes";
import { useToast } from "./ToastProvider";

export default function GenerationSettings({ mode, groupId, onSaved }: { mode: AppMode; groupId: string; onSaved: (enabled: boolean) => void }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const notify = useToast();
  useEffect(() => {
    let active = true;
    setBusy(true); setError("");
    clientApi(mode, `admin/generation-settings?groupId=${encodeURIComponent(groupId)}`).then((data) => { if (active) setEnabled(data.enabled); })
      .catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [mode, groupId]);
  return <section className="panel generation-permission-card" aria-label={t("Tracking generation settings")}>
    <div className="management-heading"><div><h3>{t("Label generation")}</h3><p>{t("Allow members to generate tracking numbers and labels in")}{" "}{mode === "sandbox" ? "sandbox" : "production"}.</p></div><span className={`access-badge ${enabled ? "enabled" : ""}`}>{busy ? t("Saving…") : enabled ? t("Enabled") : t("Disabled")}</span></div>
    {mode === "production" && <p className="subtle">{t("Label generation currently supports Loomis sandbox only.")}</p>}
    <label className="check"><input type="checkbox" checked={enabled} disabled={busy || !!error} onChange={async (event) => {
      const next = event.target.checked;
      setEnabled(next); setBusy(true);
      try {
        const data = await clientApi(mode, `admin/generation-settings?groupId=${encodeURIComponent(groupId)}`, "PUT", { enabled: next });
        setEnabled(data.enabled); onSaved(data.enabled);
        notify(`Tracking and label generation ${data.enabled ? "enabled" : "disabled"}.`);
      } catch (e) { setEnabled(!next); notify((e as Error).message, "error"); }
      finally { setBusy(false); }
    }} />{t("Enable tracking and label generation")}</label>
    {error && <p role="alert">{t(error)}</p>}
  </section>;
}
