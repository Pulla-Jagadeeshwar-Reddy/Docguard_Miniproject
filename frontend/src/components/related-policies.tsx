"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

type SimilarPolicy = { documentId: number; title: string; category: string; versionId: number; score: number };

export function RelatedPolicies({ documentId }: { documentId: number }) {
  const [policies, setPolicies] = useState<SimilarPolicy[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ similar: SimilarPolicy[] }>(`/documents/${documentId}/similar`)
      .then(result => setPolicies(result.similar))
      .catch(caught => setError(caught instanceof Error ? caught.message : "Related policies are unavailable"));
  }, [documentId]);
  if (error) return null;
  return <section style={panelStyle}>
    <h2 style={{ marginTop: 0, fontSize: 18 }}>Related policies</h2>
    {policies.length === 0 ? <p style={{ color: "#5c6d68", marginBottom: 0 }}>No similar approved policies are available yet.</p> :
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {policies.map(policy => <li key={policy.documentId} style={{ padding: "10px 0", borderTop: "1px solid #e6eeeb" }}>
          <Link href={`/documents/${policy.documentId}`} style={{ color: "#176c59", fontWeight: 700 }}>{policy.title}</Link>
          <span style={{ display: "block", color: "#5c6d68", fontSize: 13 }}>{policy.category} · similarity {(Number(policy.score) * 100).toFixed(1)}%</span>
        </li>)}
      </ul>}
  </section>;
}

const panelStyle = { marginTop: 18, background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
