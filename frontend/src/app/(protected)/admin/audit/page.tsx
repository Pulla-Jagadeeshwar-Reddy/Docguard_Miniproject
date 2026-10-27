"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type AuditLog = { id: string; user: string; document: string; version: number | null; action: string; breakGlass: boolean; ip: string | null; accessedAt: string; previousHash: string; rowHash: string };
type IntegrityCheck = { id: number; runAt: string; rowsVerified: string; result: "intact" | "tampered"; firstBrokenLogId: string | null; runBy: string };
type AuditResponse = { logs: AuditLog[]; total: number; integrityChecks: IntegrityCheck[] };

export default function AuditPage() {
  const [data, setData] = useState<AuditResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  async function load(filters = "") {
    setLoading(true);
    try { setData(await api<AuditResponse>(`/audit/logs${filters ? `?${filters}` : ""}`)); setError(""); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load audit data"); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const params = new URLSearchParams();
    for (const key of ["userId", "documentId", "action", "from", "to"]) {
      const value = String(form.get(key) ?? "");
      if (value && (key === "userId" || key === "documentId" || key === "action")) params.set(key, value);
      if (value && (key === "from" || key === "to")) {
        const date = new Date(value);
        if (!Number.isNaN(date.valueOf())) params.set(key, date.toISOString());
      }
    }
    void load(params.toString());
  }

  async function verify() {
    setVerifying(true); setError(""); setResultMessage("");
    try {
      const result = await api<{ check: IntegrityCheck }>("/audit/verify", { method: "POST" });
      setResultMessage(result.check.result === "intact"
        ? `Integrity verified across ${result.check.rowsVerified} audit rows.`
        : `Tampering detected at log row ${result.check.firstBrokenLogId}.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Integrity verification failed"); }
    finally { setVerifying(false); }
  }

  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>SECURITY</p>
      <h1>Access audit</h1>
      <p style={{ color: "#5c6d68" }}>Audit events are append-only. The database hash chain makes edits detectable.</p>
      <form onSubmit={filter} style={{ display: "flex", flexWrap: "wrap", alignItems: "end", gap: 12, padding: 16, background: "white", border: "1px solid #dce5e2", borderRadius: 12 }}>
        <label style={labelStyle}>Action<select name="action" style={inputStyle}><option value="">All actions</option>{["view", "download", "upload", "edit", "approve"].map(action => <option key={action}>{action}</option>)}</select></label>
        <label style={labelStyle}>User ID<input name="userId" type="number" min="1" style={inputStyle} /></label>
        <label style={labelStyle}>Document ID<input name="documentId" type="number" min="1" style={inputStyle} /></label>
        <label style={labelStyle}>From<input name="from" type="datetime-local" style={inputStyle} /></label>
        <label style={labelStyle}>To<input name="to" type="datetime-local" style={inputStyle} /></label>
        <button style={buttonStyle}>Apply filters</button>
        <button type="button" disabled={verifying} onClick={() => void verify()} style={verifyStyle}>{verifying ? "Verifying…" : "Verify integrity"}</button>
      </form>
      {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}
      {resultMessage && <p role="status" style={{ color: resultMessage.startsWith("Tampering") ? "#a32929" : "#18765f", fontWeight: 700 }}>{resultMessage}</p>}
      <section style={panelStyle}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Verification history</h2>
        {!data || data.integrityChecks.length === 0 ? <p>No integrity checks have been run yet.</p> : <ul style={{ paddingLeft: 20 }}>
          {data.integrityChecks.map(check => <li key={check.id} style={{ margin: "8px 0" }}>
            <strong style={{ color: check.result === "intact" ? "#18765f" : "#a32929" }}>{check.result.toUpperCase()}</strong>
            {` · ${check.rowsVerified} rows · ${new Date(check.runAt).toLocaleString()} · ${check.runBy}`}
            {check.firstBrokenLogId && ` · first broken row ${check.firstBrokenLogId}`}
          </li>)}
        </ul>}
      </section>
      <section style={{ ...panelStyle, marginTop: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Audit events <span style={{ color: "#6b7773", fontSize: 14, fontWeight: 400 }}>({data?.total ?? 0})</span></h2>
        {loading ? <p aria-live="polite">Loading audit events…</p> : !data || data.logs.length === 0 ? <p>No audit events match these filters.</p> : <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 1000, borderCollapse: "collapse" }}>
            <thead><tr>{["Time", "User", "Document", "Version", "Action", "Break-glass", "IP", "Previous hash", "Row hash"].map(label => <th scope="col" key={label} style={thStyle}>{label}</th>)}</tr></thead>
            <tbody>{data.logs.map(log => <tr key={log.id}>
              <td style={tdStyle}>{new Date(log.accessedAt).toLocaleString()}</td><td style={tdStyle}>{log.user}</td><td style={tdStyle}>{log.document}</td>
              <td style={tdStyle}>{log.version ?? "—"}</td><td style={tdStyle}>{log.action}</td><td style={tdStyle}>{log.breakGlass ? "Yes" : "No"}</td>
              <td style={tdStyle}>{log.ip ?? "—"}</td><td style={hashStyle} title={log.previousHash}>{log.previousHash.slice(0, 12)}…</td>
              <td style={hashStyle} title={log.rowHash}>{log.rowHash.slice(0, 12)}…</td>
            </tr>)}</tbody>
          </table>
        </div>}
      </section>
    </section>
  );
}

const labelStyle = { display: "grid", gap: 6, fontSize: 14, fontWeight: 600 };
const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 7, padding: "9px 10px", font: "inherit", background: "white" };
const buttonStyle = { border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", background: "white", font: "inherit", fontWeight: 600, cursor: "pointer" };
const verifyStyle = { ...buttonStyle, border: 0, background: "#18765f", color: "white" };
const panelStyle = { marginTop: 22, background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
const thStyle = { textAlign: "left" as const, padding: 10, borderBottom: "1px solid #dce5e2", color: "#52645f", fontSize: 13 };
const tdStyle = { padding: 10, borderBottom: "1px solid #edf1ef", fontSize: 13, whiteSpace: "nowrap" as const };
const hashStyle = { ...tdStyle, fontFamily: "monospace" };
