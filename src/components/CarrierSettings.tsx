"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ConnectionResult, { type ConnectionCheck } from "./ConnectionResult";
import { useUnsavedChanges } from "@/lib/use-unsaved-changes";
import { pagePath } from "@/lib/app-routes";
import { clientApi } from "@/lib/client-api";
import { carrierDefinitions, defaultCarrierUrl, type PublicCarrierSettings, type SettingsMode } from "@/lib/carrier-settings-schema";

export default function CarrierSettings({ initialMode, onSaved, groupId }: { initialMode: SettingsMode; onSaved(): void; groupId?: string }) {
  const mode = initialMode;
  const request = useCallback((path: string, method = "GET", value?: unknown) => clientApi(mode, `carrier-settings${path}${groupId ? `${path.includes("?") ? "&" : "?"}groupId=${encodeURIComponent(groupId)}` : ""}`, method, value), [mode, groupId]);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [clearCredentials, setClearCredentials] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Record<string, { error: boolean; message: string }>>({});
  const [testing, setTesting] = useState("");
  const [connections, setConnections] = useState<Record<string, ConnectionCheck>>({});
  const [settings, setSettings] = useState<PublicCarrierSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  useUnsavedChanges(Object.values(dirty).some(Boolean));
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setSettings([]); setDirty({}); setClearCredentials({}); setFeedback({});
    request(`?mode=${mode}`).then((data) => { if (!cancelled) setSettings(data.settings); })
      .catch((error) => { if (!cancelled) setError(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, request]);
  const update = (carrier: string, values: Partial<PublicCarrierSettings>, changed = true) => {
    setSettings((old) => old.map((setting) => setting.carrier === carrier ? { ...setting, ...values } : setting));
    setDirty((old) => ({ ...old, [carrier]: changed }));
    setConnections((old) => { const next = { ...old }; delete next[carrier]; return next; });
    setFeedback((old) => { const next = { ...old }; delete next[carrier]; return next; });
  };
  function clearForm(setting: PublicCarrierSettings) {
    update(setting.carrier, { enabled: false, baseUrl: defaultCarrierUrl(setting.carrier, mode),
      fields: Object.fromEntries(carrierDefinitions[setting.carrier].fields.map(field => [field.key, ""])),
      savedSecrets: {}, configured: false, quoteType: mode === "sandbox" ? "counter" : "commercial" });
    setClearCredentials(old => ({ ...old, [setting.carrier]: true }));
    setFeedback(old => ({ ...old, [setting.carrier]: { error: false, message: "Fields cleared. Click Save settings to apply." } }));
  }
  async function save(setting: PublicCarrierSettings) {
    setSaving(setting.carrier); setError("");
    setFeedback(old => { const next = { ...old }; delete next[setting.carrier]; return next; });
    try {
      const saved = await request(`/${mode}/${setting.carrier}`, "PUT", {
        enabled: setting.enabled, baseUrl: setting.baseUrl, fields: setting.fields, quoteType: setting.quoteType,
        ...(clearCredentials[setting.carrier] ? { clearCredentials: true } : {}),
      });
      update(setting.carrier, saved, false);
      setClearCredentials(old => ({ ...old, [setting.carrier]: false }));
      setFeedback(old => ({ ...old, [setting.carrier]: { error: false, message: "Settings saved to this company group." } }));
      onSaved();
    } catch (error) { setFeedback(old => ({ ...old, [setting.carrier]: { error: true, message: (error as Error).message } })); }
    finally { setSaving(""); }
  }
  async function test(setting: PublicCarrierSettings) {
    setTesting(setting.carrier); setError("");
    setConnections((old) => ({ ...old, [setting.carrier]: { status: "checking", message: "Checking connection…" } }));
    try {
      const result = await request(`/${mode}/${setting.carrier}/test`, "POST");
      setConnections((old) => ({ ...old, [setting.carrier]: { ...result, checkedAt: new Date().toISOString() } }));
    } catch (error) { setConnections((old) => ({ ...old, [setting.carrier]: { status: (error as Error).name === "TimeoutError" ? "timeout" : "error", message: (error as Error).name === "TimeoutError" ? "The carrier took too long to respond. Try again." : (error as Error).message, checkedAt: new Date().toISOString() } })); }
    finally { setTesting(""); }
  }
  return <section className="panel carrier-settings" aria-labelledby="carrier-settings-title">
    <div className="section settings-heading">
      <div><h2 id="carrier-settings-title">Carrier API settings</h2><p className="inline-note">Shared by users in this company group. Blank secret fields keep the saved value.</p></div>
      <p className="inline-note">{mode === "sandbox" ? "Sandbox / UAT credentials" : "Production credentials"}. <Link href={`${pagePath(mode === "sandbox" ? "production" : "sandbox", "setting")}${groupId ? `?company=${encodeURIComponent(groupId)}` : ""}`}>Open {mode === "sandbox" ? "production" : "sandbox"} settings</Link></p>
      <p className="inline-note">Save your credentials, then test the carrier connection. Available services depend on your shipment and account.</p>
    </div>
    {error && <div className="error" role="alert">{error}</div>}
    {loading ? <div className="section">Loading carrier settings…</div> : <div className="settings-grid">
      {settings.map((setting) => {
        const definition = carrierDefinitions[setting.carrier];
        return <form className="carrier-setting-card" key={`${mode}:${setting.carrier}`} onSubmit={(event) => { event.preventDefault(); void save(setting); }}>
          <div className="setting-title"><h3>{definition.name}</h3><label className="check"><input type="checkbox" checked={setting.enabled} disabled={!!saving || !!testing} onChange={(event) => update(setting.carrier, { enabled: event.target.checked })} />Enabled</label></div>
          <span className={`settings-state ${dirty[setting.carrier] ? "unsaved" : setting.configured ? "saved" : ""}`}><span aria-hidden="true">{dirty[setting.carrier] ? "●" : setting.configured ? "✓" : "○"}</span> {dirty[setting.carrier] ? "Unsaved changes" : setting.configured ? "Credentials saved" : "Credentials required"}</span>
          <label>{setting.carrier === "loomis" ? "Rating API URL" : "API URL"}<input type="url" required={setting.enabled} disabled={!!saving || !!testing} value={setting.baseUrl} placeholder={setting.carrier === "loomis" && mode === "production" ? "Enter production rating URL" : undefined} onChange={(event) => update(setting.carrier, { baseUrl: event.target.value })} /></label>
          {definition.fields.map((field) => <label key={field.key}>{field.label}<input type={field.secret ? "password" : "text"} autoComplete="off" disabled={(!!saving || !!testing)} value={setting.fields[field.key] ?? ""}
            placeholder={field.secret && setting.savedSecrets[field.key] ? "Saved — leave blank to keep" : "Enter " + field.label.toLowerCase()}
            onChange={(event) => update(setting.carrier, { fields: { ...setting.fields, [field.key]: event.target.value } })} /></label>)}
          {setting.carrier === "canada_post" && <label>Rate type<select disabled={(!!saving || !!testing)} value={setting.quoteType} onChange={(event) => update(setting.carrier, { quoteType: event.target.value as "counter" | "commercial" })}><option value="counter">Counter / retail</option><option value="commercial">Commercial account</option></select></label>}
          <div className="settings-card-footer">
            <div className="settings-save-row"><button type="submit" className="primary" disabled={!!saving || !!testing}>{saving === setting.carrier && <span className="quote-spinner" aria-hidden="true" />}{saving === setting.carrier ? "Saving…" : "Save settings"}</button>
              <button className="settings-clear" type="button" disabled={!!saving || !!testing} onClick={() => clearForm(setting)}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" /></svg>Clear settings</button></div>
            {feedback[setting.carrier] && <div className={`settings-feedback ${feedback[setting.carrier].error ? "error" : ""}`} role={feedback[setting.carrier].error ? "alert" : "status"}><span aria-hidden="true">{feedback[setting.carrier].error ? "!" : "✓"}</span>{feedback[setting.carrier].message}</div>}
            <p className="settings-clear-note">Clearing edits the form. Save to apply.</p>
            <div className="settings-connection">
              <div className="settings-connection-heading"><div><h4>Connection check</h4><p>{dirty[setting.carrier] ? "Save your changes before testing." : !setting.configured ? "Add and save your credentials to test." : "Test your saved carrier credentials."}</p></div>
                <button className="settings-test" type="button" disabled={!!saving || !!testing || !!dirty[setting.carrier] || !setting.configured} onClick={() => void test(setting)}>
                  {testing === setting.carrier ? <span className="quote-spinner" aria-hidden="true" /> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m9 5 10 7-10 7V5Z" /></svg>}
                  {testing === setting.carrier ? "Checking…" : connections[setting.carrier] ? "Test again" : "Test connection"}
                </button>
              </div>
              {connections[setting.carrier] ? <ConnectionResult result={connections[setting.carrier]} /> : <div className="connection-idle"><span aria-hidden="true">○</span> Not tested</div>}
            </div>
          </div>
        </form>;
      })}
    </div>}
  </section>;
}
