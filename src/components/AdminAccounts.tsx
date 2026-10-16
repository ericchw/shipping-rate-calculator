"use client";
import { useI18n } from "./UIPreferences";
import { useEffect, useState } from "react";
import { useToast } from "./ToastProvider";
import type { CompanyGroup } from "@/lib/groups";
import type { Account } from "@/lib/accounts";
import type { AppMode } from "@/lib/app-routes";
import { clientApi } from "@/lib/client-api";
const blank = { email: "", password: "", role: "user" as Account["role"], webAccess: true, apiAccess: false, productionAccess: false, uatAccess: true, groupId: "" };
export default function AdminAccounts({ mode, groups, onSaved, onlyGroupId }: { mode: AppMode; groups: CompanyGroup[]; onSaved: () => void; onlyGroupId?: string }) {
  const { t } = useI18n();
  const notify = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...blank, groupId: onlyGroupId || "" });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<Account | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("");
  useEffect(() => {
    let active = true;
    clientApi(mode, "admin/accounts").then(data => { if (active) setAccounts(data.accounts); }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [mode]);
  const reset = () => { setSelected(null); setForm({ ...blank, groupId: onlyGroupId || "" }); setEditing(false); setError(""); };
  async function refresh() { setAccounts((await clientApi(mode, "admin/accounts")).accounts); }
  const visible = accounts.filter(account => (!onlyGroupId || account.groupId === onlyGroupId) && (!filter || account.groupId === filter) && account.email.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel user-management" aria-label={onlyGroupId ? t("Company members") : t("User management")}>
    <div className="management-heading"><div><span className="eyebrow">{onlyGroupId ? t("COMPANY ACCESS") : t("ACCOUNT ADMINISTRATION")}</span><h2>{onlyGroupId ? t("Members") : t("Users and access")} <small>{visible.length}</small></h2><p>{onlyGroupId ? t("Members use this company's carrier connections and share its labels and rate logs.") : t("Create accounts, assign a company and control Web, API and environment access.")}</p></div><button type="button" className="primary" disabled={busy} onClick={() => { reset(); setEditing(true); }}>{t("+ Add user")}</button></div>
    <div className="user-list-filters"><label>{t("Find a user")}<input type="search" value={search} placeholder={t("Search by email")} onChange={event => setSearch(event.target.value)} /></label>{!onlyGroupId && <label>{t("Company")}<select aria-label={t("Filter users by company")} value={filter} onChange={event => setFilter(event.target.value)}><option value="">{t("All companies")}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}</div>
    {editing && <section className="admin-editor user-editor" aria-label={selected ? t("Edit user") : t("Add user")}>
      <div className="management-heading"><div><h3>{selected ? t("Edit user") : t("Add user")}</h3><p>{selected ? t("Saving changes signs this user out.") : t("Choose the company this user will work in.")}</p></div><button type="button" className="text-button" disabled={busy} onClick={reset}>{t("Cancel")}</button></div>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { const { password, groupId, ...fields } = form; await clientApi(mode, `admin/accounts${selected ? `/${selected}` : ""}`, selected ? "PATCH" : "POST", { ...fields, groupId: groupId || null, ...(!selected || password ? { password } : {}) }); await refresh(); reset(); notify("Account saved."); onSaved(); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}><fieldset disabled={busy}>
        <div className="user-editor-grid"><label>{t("Email")}<input type="email" autoComplete="off" required maxLength={200} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>{selected ? t("New password (optional)") : t("Password")}<input type="password" autoComplete="new-password" required={!selected} minLength={6} maxLength={256} value={form.password} placeholder={selected ? t("Leave blank to keep current password") : t("At least 6 characters")} onChange={event => setForm({ ...form, password: event.target.value })} /></label><label>{t("Role")}<select aria-label={t("User role")} value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Account["role"] })}><option value="user">{t("User")}</option><option value="operator">{t("Operator")}</option><option value="admin">{t("Admin")}</option></select></label><label>{t("Company group")}<select aria-label={t("User company group")} required={form.role !== "admin"} value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value })}><option value="">{form.role === "admin" ? t("Management only") : t("Choose a company")}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
        <div className="user-access-options"><label className="check"><input type="checkbox" checked={form.webAccess} onChange={event => setForm({ ...form, webAccess: event.target.checked })} /><span>{t("Web access")}<small>{t("Sign in to the calculator")}</small></span></label><label className="check"><input type="checkbox" checked={form.apiAccess} onChange={event => setForm({ ...form, apiAccess: event.target.checked })} /><span>{t("Integration API access")}<small>{t("Allow API login sessions")}</small></span></label></div><div className="user-access-options"><label className="check"><input type="checkbox" checked={form.productionAccess} onChange={event => setForm({ ...form, productionAccess: event.target.checked })} /><span>{t("Production access")}<small>{t("Use live carrier services")}</small></span></label><label className="check"><input type="checkbox" checked={form.uatAccess} onChange={event => setForm({ ...form, uatAccess: event.target.checked })} /><span>{t("UAT / Sandbox access")}<small>{t("Use the test environment")}</small></span></label></div><button className="primary" type="submit">{busy ? t("Saving…") : selected ? t("Save changes") : t("Create user")}</button>
      </fieldset></form>
    </section>}
    {error && <p className="error" role="alert">{t(error)}</p>}
    {busy && <p role="status">{t("Loading users…")}</p>}
    <div className="table-scroll"><table className="users-table"><thead><tr><th>{t("User")}</th><th>{t("Company")}</th><th>{t("Role")}</th><th>{t("Access")}</th><th>{t("Environments")}</th><th>{t("Actions")}</th></tr></thead><tbody>{visible.map(account => <tr key={account.id}><td><strong>{account.email}</strong></td><td>{groups.find(group => group.id === account.groupId)?.name || t("Management only")}</td><td><span className={`access-badge ${account.role === "admin" ? "admin" : ""}`}>{t(account.role)}</span></td><td><div className="access-badges"><span className={`access-badge ${account.webAccess ? "enabled" : ""}`}>{t("Web")}{" "}{account.webAccess ? "on" : "off"}</span><span className={`access-badge ${account.apiAccess ? "enabled" : ""}`}>{t("API")}{" "}{account.apiAccess ? "on" : "off"}</span></div></td><td><div className="access-badges"><span className="access-badge">{t("Production")}{" "}{account.productionAccess ? "on" : "off"}</span><span className="access-badge">UAT {t(account.uatAccess ? "on" : "off")}</span></div></td><td><div className="admin-actions"><button className="secondary" disabled={busy} onClick={() => { setSelected(account.id); setEditing(true); setForm({ email: account.email, password: "", role: account.role, webAccess: account.webAccess, apiAccess: account.apiAccess, productionAccess: account.productionAccess, uatAccess: account.uatAccess, groupId: account.groupId || "" }); setError(""); }}>{t("Edit")}</button><button className="text-button danger-text" disabled={busy} onClick={() => setDeleting(account)}>{t("Delete")}</button></div></td></tr>)}</tbody></table></div>
    {!busy && !visible.length && <div className="management-empty"><h3>{search || filter ? t("No matching users") : t("No members yet")}</h3><p>{search || filter ? t("Try another email or company.") : t("Add a user and assign them to this company.")}</p></div>}
    {deleting && <div className="delete-confirmation" role="alert"><h3>{t("Delete")}{" "}{deleting.email}?</h3><p>{t("Sessions and personal addresses will be removed. Company connections, labels and rate logs stay saved.")}</p><div className="admin-actions"><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await clientApi(mode, `admin/accounts/${deleting.id}`, "DELETE"); if (selected === deleting.id) reset(); setDeleting(null); await refresh(); notify("Account deleted."); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>{t("Delete user")}</button><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>{t("Cancel")}</button></div></div>}
  </section>;
}
