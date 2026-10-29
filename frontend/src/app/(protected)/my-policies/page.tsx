"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type Policy = {
  assignmentId: number;
  documentId: number;
  title: string;
  category: string;
  versionId: number;
  versionNumber: number;
  dueDate: string;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  overdue: boolean;
};

export default function MyPoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState<number | null>(null);

  async function load() {
    const result = await api<{ policies: Policy[] }>("/acknowledgments/mine");
    setPolicies(result.policies);
  }
  useEffect(() => { load().catch(caught => setError(caught instanceof Error ? caught.message : "Assigned policies could not be loaded")); }, []);

  async function acknowledge(assignmentId: number) {
    setError(""); setMessage(""); setWorking(assignmentId);
    try {
      await api("/acknowledgments", { method: "POST", body: JSON.stringify({ assignmentId }) });
      setMessage("Your acknowledgment was recorded for the current policy version.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Acknowledgment could not be recorded"); }
    finally { setWorking(null); }
  }

  const complete = policies.filter(policy => policy.acknowledged).length;
  const pending = policies.length - complete;
  return <section>
    <p style={{ color: "#18765f", fontWeight: 700 }}>MY WORK</p>
    <h1>My Policies</h1>
    <p style={{ color: "#5c6d68", maxWidth: 680, lineHeight: 1.6 }}>Review the current approved versions assigned to you and record that you have read each one.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, margin: "20px 0" }}>
      <article style={cardStyle}><small>Assigned policies</small><strong style={numberStyle}>{policies.length}</strong></article>
      <article style={cardStyle}><small>Pending acknowledgment</small><strong style={numberStyle}>{pending}</strong></article>
      <article style={cardStyle}><small>Completed</small><strong style={numberStyle}>{complete}</strong></article>
    </div>
    {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}{message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}
    {policies.length === 0 ? <p style={{ ...cardStyle, color: "#5c6d68" }}>There are no current policy assignments for your account.</p> :
      <div style={{ display: "grid", gap: 12 }}>{policies.map(policy => <article key={`${policy.assignmentId}-${policy.versionId}`} style={cardStyle}>
        <p style={{ margin: 0, color: "#18765f", fontSize: 12, fontWeight: 700 }}>{policy.category.toUpperCase()}</p>
        <h2 style={{ fontSize: 18, margin: "7px 0" }}><Link href={`/documents/${policy.documentId}`} style={{ color: "#176c59" }}>{policy.title}</Link></h2>
        <p style={{ color: "#5c6d68", margin: "6px 0 12px" }}>Current version {policy.versionNumber} · due {policy.dueDate}{policy.overdue ? " · overdue" : ""}</p>
        {policy.acknowledged ? <p role="status" style={{ margin: 0, color: "#18765f", fontWeight: 700 }}>Acknowledged {policy.acknowledgedAt ? `on ${new Date(policy.acknowledgedAt).toLocaleDateString()}` : ""}</p> :
          <button disabled={working === policy.assignmentId} onClick={() => void acknowledge(policy.assignmentId)} style={buttonStyle}>{working === policy.assignmentId ? "Saving…" : "I have read this policy"}</button>}
      </article>)}</div>}
  </section>;
}

const cardStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 18 };
const numberStyle = { display: "block", fontSize: 28, marginTop: 7 };
const buttonStyle = { border: 0, borderRadius: 7, padding: "10px 14px", background: "#18765f", color: "white", fontWeight: 700, cursor: "pointer" };
