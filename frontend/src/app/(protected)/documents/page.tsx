"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type DocumentRow = {
  id: number; title: string; status: string; category: string; owner: string;
  currentVersion: number | null; versionStatus: string | null; expiryDate: string | null;
};
type Session = { role: string };

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<DocumentRow[] | null>(null);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<{ documents: DocumentRow[] }>("/documents"), api<{ user: Session }>("/auth/me")])
      .then(([result, session]) => { setDocuments(result.documents); setRole(session.user.role); })
      .catch(caught => setError(caught instanceof Error ? caught.message : "Could not load policies"));
  }, []);

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div><p style={{ color: "#18765f", fontWeight: 700 }}>POLICY LIBRARY</p><h1>Documents</h1><p style={{ color: "#5c6d68" }}>Policies available to your role.</p></div>
        {(role === "Admin" || role === "Doctor") && <Link href="/documents/new" style={actionStyle}>Upload policy</Link>}
      </div>
      {error ? <p role="alert" style={{ color: "#a32929" }}>{error}</p> : documents === null ? <p aria-live="polite">Loading documents…</p> : documents.length === 0 ? (
        <div style={panelStyle}><h2>No permitted documents yet</h2><p>When a policy is shared with your role, it will appear here.</p></div>
      ) : (
        <div style={{ overflowX: "auto", marginTop: 24, ...panelStyle }}>
          <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
            <thead><tr>{["Policy", "Category", "Owner", "Document status", "Current version", "Expires"].map(value => <th key={value} scope="col" style={thStyle}>{value}</th>)}</tr></thead>
            <tbody>{documents.map(document => <tr key={document.id}>
              <td style={tdStyle}><Link href={`/documents/${document.id}`} style={{ color: "#176c59", fontWeight: 700 }}>{document.title}</Link></td>
              <td style={tdStyle}>{document.category}</td><td style={tdStyle}>{document.owner}</td>
              <td style={tdStyle}>{document.status}{document.versionStatus ? ` · ${document.versionStatus}` : ""}</td>
              <td style={tdStyle}>{document.currentVersion ?? "Awaiting approval"}</td>
              <td style={tdStyle}>{document.expiryDate ?? "No expiry"}</td>
            </tr>)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const panelStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
const actionStyle = { background: "#18765f", color: "white", padding: "10px 14px", borderRadius: 7, textDecoration: "none", fontWeight: 700 };
const thStyle = { textAlign: "left" as const, padding: 12, borderBottom: "1px solid #dce5e2", color: "#52645f", fontSize: 13 };
const tdStyle = { padding: 12, borderBottom: "1px solid #edf1ef", fontSize: 14 };
