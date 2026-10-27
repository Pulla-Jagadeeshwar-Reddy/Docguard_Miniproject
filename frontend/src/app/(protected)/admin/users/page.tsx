"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Option = { id: number; name: string };
type UserRow = { id: number; fullName: string; email: string; roleId: number; role: string; departmentId: number | null; department: string | null; accountStatus: string; lastLoginAt: string | null };
type UserResponse = { users: UserRow[]; roles: Option[]; departments: Option[] };

export default function UsersPage() {
  const [data, setData] = useState<UserResponse | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setData(await api<UserResponse>("/users")); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load users"); }
  }

  useEffect(() => { void load(); }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/users", { method: "POST", body: JSON.stringify({
        fullName: form.get("fullName"), email: form.get("email"), password: form.get("password"),
        roleId: Number(form.get("roleId")), departmentId: form.get("departmentId") ? Number(form.get("departmentId")) : null
      }) });
      event.currentTarget.reset();
      setMessage("User account created.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not create user"); }
    finally { setBusy(false); }
  }

  async function updateUser(userId: number, change: Record<string, unknown>) {
    setError(""); setMessage("");
    try {
      await api(`/users/${userId}`, { method: "PATCH", body: JSON.stringify(change) });
      setMessage("User account updated.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update account"); }
  }

  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>ADMINISTRATION</p>
      <h1>User accounts</h1>
      <p style={{ color: "#5c6d68" }}>Create accounts and manage role, department, and account status.</p>
      {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}

      <form onSubmit={createUser} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", alignItems: "end", gap: 12, padding: 18, background: "white", border: "1px solid #dce5e2", borderRadius: 12 }}>
        <label style={labelStyle}>Full name<input name="fullName" required maxLength={150} style={inputStyle} /></label>
        <label style={labelStyle}>Email<input name="email" type="email" required maxLength={255} style={inputStyle} /></label>
        <label style={labelStyle}>Temporary password<input name="password" type="password" required minLength={12} style={inputStyle} /></label>
        <label style={labelStyle}>Role<select name="roleId" required style={inputStyle}>{data?.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <label style={labelStyle}>Department<select name="departmentId" style={inputStyle}><option value="">Unassigned</option>{data?.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
        <button disabled={busy || !data} style={buttonStyle}>{busy ? "Creating…" : "Create account"}</button>
      </form>

      <div style={{ overflowX: "auto", marginTop: 24, background: "white", border: "1px solid #dce5e2", borderRadius: 12 }}>
        {!data && !error ? <p style={{ padding: 20 }}>Loading accounts…</p> : data?.users.length === 0 ? <p style={{ padding: 20 }}>No accounts found.</p> : data && (
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead><tr>{["Name", "Email", "Role", "Department", "Status", "Last sign-in"].map(label => <th key={label} scope="col" style={thStyle}>{label}</th>)}</tr></thead>
            <tbody>{data.users.map(user => <tr key={user.id}>
              <td style={tdStyle}>{user.fullName}</td><td style={tdStyle}>{user.email}</td>
              <td style={tdStyle}><select aria-label={`Change role for ${user.fullName}`} value={user.roleId} onChange={event => void updateUser(user.id, { roleId: Number(event.target.value) })} style={inputStyle}>
                {data.roles.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select></td>
              <td style={tdStyle}><select aria-label={`Change department for ${user.fullName}`} value={user.departmentId ?? ""} onChange={event => void updateUser(user.id, { departmentId: event.target.value ? Number(event.target.value) : null })} style={inputStyle}>
                <option value="">Unassigned</option>{data.departments.map(department => <option key={department.id} value={department.id}>{department.name}</option>)}
              </select></td>
              <td style={tdStyle}><select aria-label={`Change status for ${user.fullName}`} value={user.accountStatus} onChange={event => void updateUser(user.id, { accountStatus: event.target.value })} style={inputStyle}>
                <option value="active">Active</option><option value="suspended">Suspended</option><option value="disabled">Disabled</option>
              </select></td>
              <td style={tdStyle}>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "Never"}</td>
            </tr>)}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}

const labelStyle = { display: "grid", gap: 6, fontSize: 14, fontWeight: 600 };
const inputStyle = { minWidth: 0, border: "1px solid #b9c9c4", borderRadius: 7, padding: "9px 10px", font: "inherit", background: "white" };
const buttonStyle = { border: 0, borderRadius: 7, padding: "10px 14px", background: "#18765f", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" };
const thStyle = { textAlign: "left" as const, padding: 12, borderBottom: "1px solid #dce5e2", color: "#52645f", fontSize: 13 };
const tdStyle = { padding: 12, borderBottom: "1px solid #edf1ef", fontSize: 14 };
