"use client";
import { useI18n } from "./UIPreferences";
import { useEffect, useState } from "react";
import type { AppMode } from "@/lib/app-routes";
import LocationSettings from "./LocationSettings";
import AdminManagement from "./AdminManagement";
type Section = "personal" | "companies" | "users";
export default function SettingsWorkspace({ mode, user, group, generationEnabled, adminPage = false, onSaved }: { mode: AppMode; user: { email: string; role: string; webAccess?: boolean }; group: { id: string; name: string } | null; generationEnabled: boolean; adminPage?: boolean; onSaved: () => void }) {
  const { t } = useI18n();
  const [section,setSection] = useState<Section>(adminPage ? "companies" : "personal");
  const admin=user.role === "admin";
  useEffect(() => {
    if (!admin) return;
    const query = new URLSearchParams(window.location.search);
    if (query.has("company") || query.get("section") === "companies") setSection("companies");
    else if (query.get("section") === "users") setSection("users");
  }, [admin]);
  return <div className="settings-workspace">
    <div className="settings-navigation" role="tablist" aria-label={t("Settings sections")}>{(["personal",...(admin ? ["companies","users"] : [])] as Section[]).map(item => <button key={item} role="tab" aria-selected={section === item} id={`settings-tab-${item}`} aria-controls={`settings-panel-${item}`} onClick={() => { if (item !== section && window.dispatchEvent(new Event("shipping:before-leave",{cancelable:true}))) setSection(item); }}><span aria-hidden="true">{item === "personal" ? "◉" : item === "companies" ? "▦" : "◎"}</span><span>{item === "personal" ? t("My settings") : item === "companies" ? t("Company groups") : t("Users and access")}</span>{item !== "personal" && <small>{t("Admin")}</small>}</button>)}</div>
    <div role="tabpanel" id={`settings-panel-${section}`} aria-labelledby={`settings-tab-${section}`}>
      {section === "personal" ? <>
        <section className="panel account-overview"><span className="account-avatar" aria-hidden="true">{user.email.slice(0,1).toUpperCase()}</span><div><span className="eyebrow">{t("YOUR ACCOUNT")}</span><h2>{user.email}</h2><p>{group?.name || t("Management account · No company assigned")}</p></div><span className={`access-badge ${admin ? "admin" : ""}`}>{t(user.role)}</span></section>
        <div className="personal-settings-grid"><div><LocationSettings /></div><aside className="panel membership-card"><span className="eyebrow">{t("YOUR COMPANY")}</span><h2>{group?.name || t("No company assigned")}</h2><p>{group ? t("Your company shares carrier connections, labels and rate logs.") : admin ? t("Select Company groups to create a workspace and assign its members.") : t("Ask an administrator to assign your company.")}</p><dl><div><dt>{t("Carrier API settings")}</dt><dd>{admin ? t("Managed in Company groups") : t("Managed by your administrator")}</dd></div><div><dt>{t("Label generation")}</dt><dd>{generationEnabled ? t("Enabled") : t("Disabled")}</dd></div><div><dt>{t("Company assignment")}</dt><dd>{t("Administrator managed")}</dd></div></dl>{admin ? <button type="button" className="secondary" onClick={() => setSection("companies")}>{t("Manage company settings →")}</button> : <div className="membership-note">{t("Need a connection or company change? Contact your administrator.")}</div>}</aside></div>
      </> : <AdminManagement mode={mode} ownGroup={group} view={section} onSaved={onSaved} />}
    </div>
  </div>;
}
