"use client";
import { useEffect, useState } from "react";
import type { Account } from "@/lib/accounts";
import type { AppMode } from "@/lib/app-routes";
import { clientApi } from "@/lib/client-api";

const blank = { email: "", password: "", role: "user" as Account["role"], webAccess: true, apiAccess: false };
export default function AdminAccounts({ mode }: { mode: AppMode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [form, setForm] = useState({ ...blank });
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [deleting, setDeleting] = useState<Account | null>(null);
  useEffect(() => {
    let cancelled = false;
    clientApi(mode, "admin/accounts").then(data => { if (!cancelled) setAccounts(data.accounts); }).catch(error => { if (!cancelled) setError(error.message); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [mode]);
  const reset = () => { setSelected(null); setForm({ ...blank }); };
  async function refresh() { setAccounts((await clientApi(mode, "admin/accounts")).accounts); }
  return <div className="admin-layout">
    <section className="panel admin-editor">
      <h2>{selected ? "Edit account" : "Add account"}</h2>
      <p className="inline-note">Web access enables the calculator. API access enables integration login sessions. Account changes sign that user out.</p>
      <form onSubmit={async event => {
        event.preventDefault(); setBusy(true); setError(""); setMessage("");
        try {
          const { password, ...fields } = form;
          await clientApi(mode, `admin/accounts${selected ? `/${selected}` : ""}`, selected ? "PATCH" : "POST", { ...fields, ...(!selected || password ? { password } : {}) });
          reset(); await refresh(); setMessage("Account saved.");
        } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
      }}>
        <fieldset disabled={busy}>
          <label>Email<input type="email" autoComplete="off" required maxLength={200} value={form.email} onChange={event => setForm({ ...form, email: event.target.value })} /></label>
          <label>{selected ? "New password (optional)" : "Password"}<input type="password" autoComplete="new-password" required={!selected} minLength={6} maxLength={256} value={form.password} placeholder={selected ? "Leave blank to keep current password" : "At least 6 characters"} onChange={event => setForm({ ...form, password: event.target.value })} /></label>
          <label>Role<select value={form.role} onChange={event => setForm({ ...form, role: event.target.value as Account["role"] })}><option value="user">User</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
          <label className="check"><input type="checkbox" checked={form.webAccess} onChange={event => setForm({ ...form, webAccess: event.target.checked })} />Web access</label>
          <label className="check"><input type="checkbox" checked={form.apiAccess} onChange={event => setForm({ ...form, apiAccess: event.target.checked })} />API access</label>
          <div className="admin-actions"><button className="primary" type="submit">{busy ? "Working…" : selected ? "Save changes" : "Add account"}</button>{selected && <button type="button" onClick={reset}>Cancel</button>}</div>
        </fieldset>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </section>
    <section className="panel admin-list"><h2>Accounts <small>({accounts.length})</small></h2>
      {busy && <p role="status">Working…</p>}
      <div className="api-docs-table"><table><thead><tr><th>Email</th><th>Role</th><th>Web</th><th>API</th><th>Actions</th></tr></thead><tbody>{accounts.map(account => <tr key={account.id}>
        <td>{account.email}</td><td>{account.role}</td><td>{account.webAccess ? "✓" : "—"}</td><td>{account.apiAccess ? "✓" : "—"}</td><td><div className="admin-actions"><button disabled={busy} onClick={() => { setSelected(account.id); setForm({ email: account.email, password: "", role: account.role, webAccess: account.webAccess, apiAccess: account.apiAccess }); setError(""); setMessage(""); }}>Edit</button><button disabled={busy} onClick={() => setDeleting(account)}>Delete</button></div></td>
      </tr>)}</tbody></table></div>
      {deleting && <div className="admin-delete" role="alert"><p>Delete <strong>{deleting.email}</strong>? Their sessions, saved addresses and carrier settings will also be deleted.</p><div className="admin-actions"><button disabled={busy} onClick={async () => {
        setBusy(true); setError(""); setMessage("");
        try { await clientApi(mode, `admin/accounts/${deleting.id}`, "DELETE"); if (selected === deleting.id) reset(); setDeleting(null); await refresh(); setMessage("Account deleted."); }
        catch (error) { setError((error as Error).message); } finally { setBusy(false); }
      }}>Delete account</button><button disabled={busy} onClick={() => setDeleting(null)}>Cancel</button></div></div>}
    </section>
  </div>;
}
