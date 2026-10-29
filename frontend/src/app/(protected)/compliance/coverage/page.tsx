"use client";

import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Regulation = { regulationId: number; regulationName: string; issuingBody: string; totalControls: number; mandatoryControls: number; coveredMandatoryControls: number; mandatoryGaps: number; coveragePercent: number };
type Control = { regulationId: number; regulationName: string; controlId: number; controlCode: string; title: string; description: string | null; isMandatory: boolean; mappedDocumentCount: number; validDocumentCount: number; isCovered: boolean };
type Option = { id: number; name: string };
type DocumentOption = { id: number; title: string; status: string; versionStatus: string | null };

export default function CoveragePage() {
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [controls, setControls] = useState<Control[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [regulationName, setRegulationName] = useState("");
  const [issuingBody, setIssuingBody] = useState("");
  const [selectedRegulation, setSelectedRegulation] = useState("");
  const [controlCode, setControlCode] = useState("");
  const [controlTitle, setControlTitle] = useState("");
  const [controlDescription, setControlDescription] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [controlId, setControlId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    const [coverage, docs] = await Promise.all([
      api<{ regulations: Regulation[]; controls: Control[] }>("/compliance/coverage"),
      api<{ documents: DocumentOption[] }>("/documents")
    ]);
    setRegulations(coverage.regulations); setControls(coverage.controls);
    setDocuments(docs.documents.filter(doc => doc.status === "active" && doc.versionStatus === "approved"));
    if (!selectedRegulation && coverage.regulations[0]) setSelectedRegulation(String(coverage.regulations[0].regulationId));
    if (!documentId && docs.documents[0]) setDocumentId(String(docs.documents[0].id));
    if (!controlId && coverage.controls[0]) setControlId(String(coverage.controls[0].controlId));
  }
  useEffect(() => { load().catch(caught => setError(caught instanceof Error ? caught.message : "Coverage data could not be loaded")); }, []);

  async function submit(event: FormEvent, action: () => Promise<void>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    try { await action(); await load(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Coverage update failed"); }
    finally { setSaving(false); }
  }
  const gaps = controls.filter(control => control.isMandatory && !control.isCovered);
  const currentControls = selectedRegulation ? controls.filter(control => control.regulationId === Number(selectedRegulation)) : controls;

  return <section>
    <p style={{ color: "#18765f", fontWeight: 700 }}>COMPLIANCE</p>
    <h1>Regulatory coverage</h1>
    <p style={{ color: "#5c6d68", maxWidth: 760, lineHeight: 1.6 }}>Coverage is based on mapped controls backed by a current, approved, unexpired policy. The included NABH, JCI, HIPAA, and DPDP examples are illustrative project data, not official compliance interpretations.</p>
    {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}{message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}
    <div style={regGrid}>{regulations.map(item => <article key={item.regulationId} style={cardStyle}>
      <small style={{ color: "#5c6d68" }}>{item.issuingBody}</small><h2 style={{ margin: "7px 0", fontSize: 19 }}>{item.regulationName}</h2>
      <strong style={{ fontSize: 30 }}>{Number(item.coveragePercent).toFixed(0)}%</strong><span style={{ color: "#5c6d68" }}> mandatory controls covered</span>
      <progress value={Number(item.coveragePercent)} max={100} aria-label={`${item.regulationName} coverage ${item.coveragePercent}%`} style={{ width: "100%", marginTop: 10 }} />
      <small style={{ display: "block", color: "#5c6d68", marginTop: 6 }}>{item.coveredMandatoryControls}/{item.mandatoryControls} covered · {item.mandatoryGaps} gaps</small>
    </article>)}</div>
    <section style={{ ...cardStyle, marginTop: 18 }}>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Mandatory control gaps ({gaps.length})</h2>
      {gaps.length === 0 ? <p style={{ color: "#18765f" }}>All configured mandatory controls have a current approved policy mapped.</p> :
        <ul style={{ paddingLeft: 20, marginBottom: 0 }}>{gaps.map(control => <li key={control.controlId} style={{ padding: "6px 0" }}><strong>{control.regulationName} · {control.controlCode}</strong> — {control.title} <small style={{ color: "#5c6d68" }}>({control.mappedDocumentCount} mapped, {control.validDocumentCount} valid)</small></li>)}</ul>}
    </section>
    <section style={{ ...cardStyle, marginTop: 18 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Coverage matrix</h2>
        <label style={labelStyle}>Regulation
          <select value={selectedRegulation} onChange={event => setSelectedRegulation(event.target.value)} style={inputStyle}>
            <option value="">All regulations</option>{regulations.map(item => <option key={item.regulationId} value={item.regulationId}>{item.regulationName}</option>)}
          </select>
        </label>
      </div>
      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
          <thead><tr>{["Regulation", "Control", "Requirement", "Mapped policies", "Current valid", "Status"].map(label => <th key={label} style={thStyle} scope="col">{label}</th>)}</tr></thead>
          <tbody>{currentControls.map(control => <tr key={control.controlId}>
            <td style={tdStyle}>{control.regulationName}</td><td style={tdStyle}>{control.controlCode}{control.isMandatory ? " *" : ""}</td>
            <td style={tdStyle}>{control.title}</td><td style={tdStyle}>{control.mappedDocumentCount}</td><td style={tdStyle}>{control.validDocumentCount}</td>
            <td style={{ ...tdStyle, color: control.isCovered ? "#18765f" : "#a32929", fontWeight: 700 }}>{control.isCovered ? "Covered" : "Gap"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section style={{ marginTop: 18, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
      <form style={cardStyle} onSubmit={event => void submit(event, async () => {
        await api("/regulations", { method: "POST", body: JSON.stringify({ regulationName, issuingBody }) });
        setMessage("Regulation saved."); setRegulationName(""); setIssuingBody("");
      })}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add regulation</h2>
        <label style={labelStyle}>Name<input required value={regulationName} onChange={event => setRegulationName(event.target.value)} style={inputStyle} /></label>
        <label style={{ ...labelStyle, marginTop: 10 }}>Issuing body<input required value={issuingBody} onChange={event => setIssuingBody(event.target.value)} style={inputStyle} /></label>
        <button disabled={saving} style={buttonStyle}>Save regulation</button>
      </form>
      <form style={cardStyle} onSubmit={event => void submit(event, async () => {
        await api("/controls", { method: "POST", body: JSON.stringify({ regulationId: Number(selectedRegulation), controlCode, title: controlTitle, description: controlDescription, isMandatory: true }) });
        setMessage("Mandatory control saved."); setControlCode(""); setControlTitle(""); setControlDescription("");
      })}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Add mandatory control</h2>
        <label style={labelStyle}>Regulation<select required value={selectedRegulation} onChange={event => setSelectedRegulation(event.target.value)} style={inputStyle}>{regulations.map(item => <option key={item.regulationId} value={item.regulationId}>{item.regulationName}</option>)}</select></label>
        <label style={{ ...labelStyle, marginTop: 10 }}>Control code<input required value={controlCode} onChange={event => setControlCode(event.target.value)} style={inputStyle} /></label>
        <label style={{ ...labelStyle, marginTop: 10 }}>Title<input required value={controlTitle} onChange={event => setControlTitle(event.target.value)} style={inputStyle} /></label>
        <label style={{ ...labelStyle, marginTop: 10 }}>Description<textarea value={controlDescription} onChange={event => setControlDescription(event.target.value)} style={inputStyle} /></label>
        <button disabled={saving || !selectedRegulation} style={buttonStyle}>Save control</button>
      </form>
      <form style={cardStyle} onSubmit={event => void submit(event, async () => {
        await api("/control-map", { method: "POST", body: JSON.stringify({ documentId: Number(documentId), controlId: Number(controlId) }) });
        setMessage("Policy mapping saved.");
      })}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Map an approved policy</h2>
        <label style={labelStyle}>Policy<select required value={documentId} onChange={event => setDocumentId(event.target.value)} style={inputStyle}>{documents.map(doc => <option key={doc.id} value={doc.id}>{doc.title}</option>)}</select></label>
        <label style={{ ...labelStyle, marginTop: 10 }}>Control<select required value={controlId} onChange={event => setControlId(event.target.value)} style={inputStyle}>{controls.map(control => <option key={control.controlId} value={control.controlId}>{control.regulationName} · {control.controlCode}</option>)}</select></label>
        <button disabled={saving || !documentId || !controlId} style={buttonStyle}>Map policy</button>
      </form>
    </section>
  </section>;
}

const regGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 20 };
const cardStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 18 };
const labelStyle = { display: "grid", gap: 7, fontWeight: 600 };
const inputStyle = { width: "100%", border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
const buttonStyle = { marginTop: 14, border: 0, borderRadius: 7, padding: "10px 14px", background: "#18765f", color: "white", fontWeight: 700, cursor: "pointer" };
const thStyle = { textAlign: "left" as const, padding: 10, borderBottom: "1px solid #dce5e2", color: "#52645f", fontSize: 13 };
const tdStyle = { padding: 10, borderBottom: "1px solid #edf1ef", fontSize: 14 };
