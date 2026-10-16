"use client";
import { useI18n } from "./UIPreferences";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { clientApi } from "@/lib/client-api";
import { pagePath, type AppMode } from "@/lib/app-routes";
import type { CompanyGroup } from "@/lib/groups";
import AdminAccounts from "./AdminAccounts";
import CarrierSettings from "./CarrierSettings";
import GenerationSettings from "./GenerationSettings";
import { useToast } from "./ToastProvider";
const canLeave = () => window.dispatchEvent(new Event("shipping:before-leave", { cancelable: true }));
export default function AdminManagement({ mode, ownGroup, onSaved, view = "companies" }: { mode: AppMode; ownGroup: { id: string; name: string } | null; onSaved: () => void; view?: "companies" | "users" }) {
  const { t } = useI18n();
  const [groups, setGroups] = useState<CompanyGroup[]>([]);
  const [selected, setSelected] = useState(ownGroup?.id || "");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [rename, setRename] = useState("");
  const [tab, setTab] = useState<"overview" | "connections" | "members">("overview");
  const [search, setSearch] = useState("");
  const [deleteError,setDeleteError] = useState("");
  const selectionInitialized=useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const notify = useToast();
  const load = useCallback(async () => {
    const data: { groups: CompanyGroup[] } = await clientApi(mode, "admin/groups");
    setGroups(data.groups);
    const requested = !selectionInitialized.current ? new URLSearchParams(window.location.search).get("company") : null;
    selectionInitialized.current = true;
    setSelected(current => requested && data.groups.some(group=>group.id===requested) ? requested : data.groups.some(group => group.id === current) ? current : data.groups[0]?.id || "");
  }, [mode]);
  useEffect(() => { let active = true; load().catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [load]);
  const group = groups.find(item => item.id === selected);
  useEffect(() => { setRename(group?.name || ""); }, [group?.name]);
  async function save(name: string, id?: string) {
    setBusy(true); setError("");
    try {
      const saved = await clientApi(mode, `admin/groups${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", { name });
      await load(); setSelected(saved.id); setNewName(""); setCreating(false); setTab("overview"); onSaved();
      notify(id ? t("Company group renamed.") : t("Company created. Add members or connect a carrier to get started."));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const refreshed = () => { void load().catch((e: Error) => setError(e.message)); onSaved(); };
  if (loading) return <div className="panel management-empty" role="status">{t("Loading company settings…")}</div>;
  if (view === "users") return <><div className="settings-section-heading"><h2>{t("Users and access")}</h2><p>{t("Each user belongs to one company. Administrators manage connections and account access.")}</p></div>{error && <p role="alert" className="error">{t(error)}</p>}<AdminAccounts mode={mode} groups={groups} onSaved={refreshed} /></>;
  return <div className="company-settings-layout">
    <aside className="panel company-directory" aria-label={t("Company groups")}>
      <div className="management-heading"><div><span className="eyebrow">{t("WORKSPACES")}</span><h2>{t("Companies")}{" "}<small>{groups.length}</small></h2></div><button type="button" className="company-add-button" aria-label={t("Add company")} onClick={() => { if (canLeave()) { setCreating(!creating); setError(""); } }}>+</button></div>
      <label className="company-search">{t("Find a company")}<input type="search" placeholder={t("Search companies")} value={search} onChange={event => setSearch(event.target.value)} /></label>
      {creating && <form className="company-create-form" onSubmit={event => { event.preventDefault(); void save(newName); }}><label>{t("Company name")}<input autoFocus required maxLength={200} value={newName} disabled={busy} onChange={event => setNewName(event.target.value)} placeholder="e.g. Richmond Trading" /></label><div className="admin-actions"><button className="primary" type="submit" disabled={busy || !newName.trim()}>{t("Create company")}</button><button type="button" className="text-button" onClick={() => setCreating(false)}>{t("Cancel")}</button></div></form>}
      <nav className="company-directory-list" aria-label={t("Choose company")}>{groups.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => <button key={item.id} type="button" aria-current={item.id === selected ? "true" : undefined} onClick={() => { if (item.id !== selected && canLeave()) { setSelected(item.id); setTab("overview"); setDeleting(false); setError(""); } }}><span className="company-avatar" aria-hidden="true">{item.name.slice(0,1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.memberCount} {t(item.memberCount === 1 ? "member" : "members")}{item.id === ownGroup?.id ? t(" · Your company") : ""}</small></span><span aria-hidden="true">›</span></button>)}</nav>
      {!groups.length && <p className="subtle">{t("Create your first company, then add members and carrier connections.")}</p>}
    </aside>
    <div className="company-settings-content">
      {error && <p role="alert" className="error">{t(error)}</p>}
      {group ? <>
        <section className="panel company-detail-heading"><div><span className="eyebrow">{t("COMPANY SETTINGS")}</span><h2>{group.name}</h2><p>{group.memberCount} {t(group.memberCount === 1 ? "member" : "members")}{" "}{t("· Shared carrier connections, labels and rate logs")}</p></div><span className={`environment-badge ${mode}`}>{mode === "sandbox" ? t("Sandbox") : t("Production")}</span></section>
        <div className="settings-subtabs" role="tablist" aria-label={t("Company settings sections")}>{(["overview","connections","members"] as const).map(item => <button key={item} role="tab" aria-selected={tab === item} aria-controls={`company-${item}`} id={`company-tab-${item}`} onClick={() => { if (tab !== item && canLeave()) { setTab(item); setError(""); setDeleting(false); } }}>{item === "overview" ? t("Overview") : item === "connections" ? t("API connections") : t(`Members (${group.memberCount})`)}</button>)}</div>
        <div role="tabpanel" id={`company-${tab}`} aria-labelledby={`company-tab-${tab}`} key={`${group.id}:${tab}`}>
          {tab === "overview" && <>
            <section className="panel company-profile-card"><div className="management-heading"><div><h3>{t("Company profile")}</h3><p>{t("This name identifies the shared workspace for your users.")}</p></div><Link className="text-button" href={`${pagePath(mode,"labels")}?groupId=${group.id}`}>{t("View labels ↗")}</Link></div><form onSubmit={event => { event.preventDefault(); void save(rename, selected); }}><label>{t("Company name")}<input required maxLength={200} value={rename} disabled={busy} onChange={event => setRename(event.target.value)} /></label><button className="secondary" type="submit" disabled={busy || !rename.trim() || rename.trim() === group.name}>{t("Save name")}</button></form></section>
            <div className="company-setup-cards"><button onClick={() => setTab("members")}><span aria-hidden="true">◎</span><strong>{t("Manage members")}</strong><small>{t("Create accounts and assign company access.")}</small><b aria-hidden="true">→</b></button><button onClick={() => setTab("connections")}><span aria-hidden="true">⇄</span><strong>{t("Connect carriers")}</strong><small>{t("Set up the API credentials used by this company.")}</small><b aria-hidden="true">→</b></button></div>
            <GenerationSettings mode={mode} groupId={group.id} onSaved={onSaved} />
            <section className="panel company-danger-zone"><div><h3>{t("Delete company group")}</h3><p>{t("Only groups without members, labels or rate logs can be deleted.")}</p></div><button type="button" className="danger-outline" disabled={busy} onClick={() => { setDeleteError(""); setDeleting(true); }}>{t("Delete group")}</button>
              {deleting && <div className="delete-confirmation" role="group" aria-label={t("Confirm group deletion")}><h3>{t("Delete “")}{group.name}”?</h3><p>{t("Saved carrier credentials and tracking permissions for this company will be removed in both environments. This cannot be undone.")}</p>{deleteError && <p role="alert" className="error">{deleteError}</p>}<div className="admin-actions"><button type="button" className="danger-button" disabled={busy} onClick={async () => { setBusy(true); setDeleteError(""); try { await clientApi(mode,`admin/groups/${group.id}`,"DELETE"); setDeleting(false); await load(); onSaved(); notify("Company group deleted."); } catch(e) { setDeleteError((e as Error).message); } finally { setBusy(false); } }}>{t("Yes, delete group")}</button><button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(false)}>{t("Cancel")}</button></div></div>}
            </section>
          </>}
          {tab === "connections" && <CarrierSettings initialMode={mode} groupId={group.id} onSaved={onSaved} />}
          {tab === "members" && <AdminAccounts mode={mode} groups={groups} onlyGroupId={group.id} onSaved={refreshed} />}
        </div>
      </> : <section className="panel management-empty"><span className="empty-workspace-icon" aria-hidden="true">▦</span><h2>{t("Your companies belong here")}</h2><p>{t("Create a company to manage its members and carrier connections in one place.")}</p><button type="button" className="primary" onClick={() => setCreating(true)}>{t("+ Create company")}</button></section>}
    </div>
  </div>;
}
