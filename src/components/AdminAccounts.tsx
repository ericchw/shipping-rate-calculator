"use client";
import { useEffect, useState } from "react";
import { useToast } from "./ToastProvider";
import type { CompanyGroup } from "@/lib/groups";
import type { Account } from "@/lib/accounts";
import type { AppMode } from "@/lib/app-routes";
import { clientApi } from "@/lib/client-api";
const blank = { email: "", password: "", role: "user" as Account["role"], webAccess: true, apiAccess: false, productionAccess: false, uatAccess: true, groupId: "" };
export default function AdminAccounts({ mode, groups, onSaved, onlyGroupId }: { mode: AppMode; groups: CompanyGroup[]; onSaved: () => void; onlyGroupId?: string }) {
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
  return <section className="panel user-management" aria-label={onlyGroupId ? "Company members" : "User management"}>
    <div className="management-heading"><div><span className="eyebrow">{onlyGroupId ? "COMPANY ACCESS" : "ACCOUNT ADMINISTRATION"}</span><h2>{onlyGroupId ? "Members" : "Users and access"} <small>{visible.length}</small></h2><p>{onlyGroupId ? "Members use this company's carrier connections and share its labels and rate logs." : "Create accounts, assign a company and control Web, API and environment access."}</p></div><button type="button" className="primary" disabled={busy} onClick={() => { reset(); setEditing(true); }}>+ Add user</button></div>
    <div className="user-list-filters"><label>Find a user<input type="search" value={search} placeholder="Search by email" onChange={event => setSearch(event.target.value)} /></label>{!onlyGroupId && <label>Company<select aria-label="Filter users by company" value={filter} onChange={event => setFilter(event.target.value)}><option value="">All companies</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}</div>
    {editing && <section className="admin-editor user-editor" aria-label={selected ? "Edit user" : "Add user"}>
      <div className="management-heading"><div><h3>{selected ? "Edit user" : "Add user"}</h3><p>{selected ? "Saving changes signs this user out." : "Choose the company this user will work in."}</p></div><button type="button" className="text-button" disabled={busy} onClick={reset}>Cancel</button></div>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError("");
        try { const { password, groupId, ...fields } = form; await clientApi(mode, `admin/accounts${selected ? `/${selected}` : ""}`, selected ? "PATCH" : "POST", { ...fields, groupId: groupId || null, ...(!selected || password ? { password } : {}) }); await refresh(); reset(); notify("Account saved."); onSaved(); }
        catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}><fieldset disabled={busy}>
        <div className="user-editor-grid"><label>Email<input type="email" autoComplete="off" required maxLength={200} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label><label>{selected ? "New password (optional)" : "Password"}<input type="password" autoComplete="new-password" required={!selected} minLength={6} maxLength={256} value={form.password} placeholder={selected ? "Leave blank to keep current password" : "At least 6 characters"} onChange={event => setForm({ ...form, password: event.target.value })} /></label><label>Role<select aria-label="User role" value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Account["role"] })}><option value="user">User</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label><label>Company group<select aria-label="User company group" required={form.role !== "admin"} value={form.groupId} onChange={event => setForm({ ...form, groupId: event.target.value })}><option value="">{form.role === "admin" ? "Management only" : "Choose a company"}</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label></div>
        <div className="user-access-options"><label className="check"><input type="checkbox" checked={form.webAccess} onChange={event => setForm({ ...form, webAccess: event.target.checked })} /><span>Web access<small>Sign in to the calculator</small></span></label><label className="check"><input type="checkbox" checked={form.apiAccess} onChange={event => setForm({ ...form, apiAccess: event.target.checked })} /><span>Integration API access<small>Allow API login sessions</small></span></label></div><div className="user-access-options"><label className="check"><input type="checkbox" checked={form.productionAccess} onChange={event => setForm({ ...form, productionAccess: event.target.checked })} /><span>Production access<small>Use live carrier services</small></span></label><label className="check"><input type="checkbox" checked={form.uatAccess} onChange={event => setForm({ ...form, uatAccess: event.target.checked })} /><span>UAT / Sandbox access<small>Use the test environment</small></span></label></div><button className="primary" type="submit">{busy ? "Saving…" : selected ? "Save changes" : "Create user"}</button>
      </fieldset></form>
    </section>}
    {error && <p className="error" role="alert">{error}</p>}
    {busy && <p role="status">Loading users…</p>}
    <div className="table-scroll"><table className="users-table"><thead><tr><th>User</th><th>Company</th><th>Role</th><th>Access</th><th>Environments</th><th>Actions</th></tr></thead><tbody>{visible.map(account => <tr key={account.id}><td><strong>{account.email}</strong></td><td>{groups.find(group => group.id === account.groupId)?.name || "Management only"}</td><td><span className={`access-badge ${account.role === "admin" ? "admin" : ""}`}>{account.role}</span></td><td><div className="access-badges"><span className={`access-badge ${account.webAccess ? "enabled" : ""}`}>Web {account.webAccess ? "on" : "off"}</span><span className={`access-badge ${account.apiAccess ? "enabled" : ""}`}>API {account.apiAccess ? "on" : "off"}</span></div></td><td><div className="access-badges"><span className="access-badge">Production {account.productionAccess ? "on" : "off"}</span><span className="access-badge">UAT {account.uatAccess ? "on" : "off"}</span></div></td><td><div className="admin-actions"><button className="secondary" disabled={busy} onClick={() => { setSelected(account.id); setEditing(true); setForm({ email: account.email, password: "", role: account.role, webAccess: account.webAccess, apiAccess: account.apiAccess, productionAccess: account.productionAccess, uatAccess: account.uatAccess, groupId: account.groupId || "" }); setError(""); }}>Edit</button><button className="text-button danger-text" disabled={busy} onClick={() => setDeleting(account)}>Delete</button></div></td></tr>)}</tbody></table></div>
    {!busy && !visible.length && <div className="management-empty"><h3>{search || filter ? "No matching users" : "No members yet"}</h3><p>{search || filter ? "Try another email or company." : "Add a user and assign them to this company."}</p></div>}
    {deleting && <div className="delete-confirmation" role="alert"><h3>Delete {deleting.email}?</h3><p>Sessions and personal addresses will be removed. Company connections, labels and rate logs stay saved.</p><div className="admin-actions"><button className="danger-button" disabled={busy} onClick={async () => { setBusy(true); setError(""); try { await clientApi(mode, `admin/accounts/${deleting.id}`, "DELETE"); if (selected === deleting.id) reset(); setDeleting(null); await refresh(); notify("Account deleted."); onSaved(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>Delete user</button><button className="secondary" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div></div>}
  </section>;
}
