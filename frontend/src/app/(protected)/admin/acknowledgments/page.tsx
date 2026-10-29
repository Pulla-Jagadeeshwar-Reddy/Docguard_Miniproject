"use client";

import { FormEvent, useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";

type Option = { id: number; name: string };
type DocumentOption = { id: number; title: string; status: string; versionStatus: string | null };
type Assignment = { assignment_id: number; document_title: string; target_role_name: string | null; target_department_name: string | null; due_date: string; eligible_users: number; acknowledged_users: number; pending_users: number; completion_percent: number };
type Department = { department_id: number; department_name: string; completion_percent: number; pending_assignments: number; eligible_assignments: number };

function defaultDueDate() { return new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10); }

export default function AcknowledgmentsAdminPage() {
  const [roles, setRoles] = useState<Option[]>([]);
  const [departments, setDepartments] = useState<Option[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [completion, setCompletion] = useState<Department[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [targetType, setTargetType] = useState("role");
  const [targetId, setTargetId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [userOptions, documentList, compliance] = await Promise.all([
      api<{ roles: Option[]; departments: Option[] }>("/users"),
      api<{ documents: DocumentOption[] }>("/documents"),
      api<{ assignments: Assignment[]; departments: Department[] }>("/compliance/acknowledgments")
    ]);
    setRoles(userOptions.roles); setDepartments(userOptions.departments);
    setDocuments(documentList.documents.filter(document => document.status === "active" && document.versionStatus === "approved"));
    setAssignments(compliance.assignments); setCompletion(compliance.departments);
    if (!targetId) setTargetId(String(targetType === "role" ? userOptions.roles[0]?.id ?? "" : userOptions.departments[0]?.id ?? ""));
    if (!documentId) setDocumentId(String(documentList.documents.find(document => document.status === "active" && document.versionStatus === "approved")?.id ?? ""));
  }
  useEffect(() => { load().catch(caught => setError(caught instanceof Error ? caught.message : "Acknowledgment data could not be loaded")); }, []);

  function changeTargetType(value: string) {
    setTargetType(value);
    setTargetId(String(value === "role" ? roles[0]?.id ?? "" : departments[0]?.id ?? ""));
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage(""); setSaving(true);
    const body = {
      documentId: Number(documentId), targetType,
      ...(targetType === "role" ? { targetRoleId: Number(targetId) } : { targetDepartmentId: Number(targetId) }),
      dueDate
    };
    try {
      await api("/assignments", { method: "POST", body: JSON.stringify(body) });
      setMessage("Policy assigned. Eligible users received an acknowledgment notification.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Assignment could not be created"); }
    finally { setSaving(false); }
  }

  const options = targetType === "role" ? roles : departments;
  return <section>
    <p style={{ color: "#18765f", fontWeight: 700 }}>ADMINISTRATION</p>
    <h1>Policy acknowledgments</h1>
    <p style={{ color: "#5c6d68", maxWidth: 680, lineHeight: 1.6 }}>Assign an approved policy to one role or department, then track completion against the current version.</p>
    {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}{message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}
    <form onSubmit={submit} style={cardStyle}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Create assignment</h2>
      <div style={formGrid}>
        <label style={labelStyle}>Approved policy
          <select required value={documentId} onChange={event => setDocumentId(event.target.value)} style={inputStyle}>
            <option value="">Choose a policy</option>{documents.map(document => <option key={document.id} value={document.id}>{document.title}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Target
          <select value={targetType} onChange={event => changeTargetType(event.target.value)} style={inputStyle}>
            <option value="role">Role</option><option value="department">Department</option>
          </select>
        </label>
        <label style={labelStyle}>{targetType === "role" ? "Role" : "Department"}
          <select required value={targetId} onChange={event => setTargetId(event.target.value)} style={inputStyle}>
            {options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
        <label style={labelStyle}>Due date<input required type="date" min={new Date().toISOString().slice(0, 10)} value={dueDate} onChange={event => setDueDate(event.target.value)} style={inputStyle} /></label>
      </div>
      <button disabled={saving || !documentId || !targetId} style={buttonStyle}>{saving ? "Assigning…" : "Assign policy"}</button>
    </form>
    <section style={{ ...cardStyle, marginTop: 18 }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Completion by department</h2>
      {completion.length === 0 ? <p style={{ color: "#5c6d68" }}>No acknowledgment assignments yet.</p> :
        <div role="img" aria-label="Acknowledgment completion percentage by department" style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={completion} layout="vertical" margin={{ top: 6, right: 24, left: 12, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" domain={[0, 100]} unit="%" />
              <YAxis type="category" dataKey="department_name" width={125} tick={{ fontSize: 12 }} /><Tooltip formatter={value => [`${value}%`, "Complete"]} />
              <Bar dataKey="completion_percent" name="Completion" fill="#18765f" radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>}
    </section>
    <section style={{ ...cardStyle, marginTop: 18, overflowX: "auto" }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Assignment status</h2>
      {assignments.length === 0 ? <p style={{ color: "#5c6d68" }}>No assignments are configured.</p> :
        <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
          <thead><tr>{["Policy", "Target", "Due", "Complete", "Progress"].map(label => <th key={label} style={thStyle} scope="col">{label}</th>)}</tr></thead>
          <tbody>{assignments.map(item => <tr key={item.assignment_id}>
            <td style={tdStyle}>{item.document_title}</td>
            <td style={tdStyle}>{item.target_role_name ?? item.target_department_name}</td>
            <td style={tdStyle}>{item.due_date}</td>
            <td style={tdStyle}>{item.acknowledged_users}/{item.eligible_users}</td>
            <td style={tdStyle}><progress value={Number(item.completion_percent)} max={100} aria-label={`${item.document_title} completion`} /> {Number(item.completion_percent).toFixed(0)}%</td>
          </tr>)}</tbody>
        </table>}
    </section>
  </section>;
}

const cardStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
const formGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 14, marginBottom: 16 };
const labelStyle = { display: "grid", gap: 7, fontWeight: 600 };
const inputStyle = { width: "100%", border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
const buttonStyle = { border: 0, borderRadius: 7, padding: "10px 14px", background: "#18765f", color: "white", fontWeight: 700, cursor: "pointer" };
const thStyle = { textAlign: "left" as const, padding: 10, borderBottom: "1px solid #dce5e2", color: "#52645f", fontSize: 13 };
const tdStyle = { padding: 10, borderBottom: "1px solid #edf1ef", fontSize: 14 };
