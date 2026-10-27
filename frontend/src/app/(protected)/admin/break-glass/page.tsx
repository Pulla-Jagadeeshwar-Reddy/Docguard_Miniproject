"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type ReviewRequest = {
  id: number;
  requesterId: number;
  requester: string;
  documentId: number;
  document: string;
  justification: string;
  grantedAt: string;
  expiresAt: string;
  status: string;
};

export default function BreakGlassReviewPage() {
  const [requests, setRequests] = useState<ReviewRequest[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const result = await api<{ requests: ReviewRequest[] }>("/overrides/pending");
    setRequests(result.requests);
  }, []);

  useEffect(() => {
    load().catch(caught => setError(caught instanceof Error ? caught.message : "Review queue could not be loaded"))
      .finally(() => setLoading(false));
  }, [load]);

  async function review(item: ReviewRequest, outcome: "justified" | "unjustified") {
    setError(""); setMessage("");
    try {
      await api(`/overrides/${item.id}/review`, { method: "POST", body: JSON.stringify({ outcome }) });
      setMessage(`Request for ${item.document} marked ${outcome}.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Request could not be reviewed"); }
  }

  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>ADMINISTRATION</p>
      <h1>Emergency access reviews</h1>
      <p style={{ color: "#5c6d68" }}>Review the justification and outcome of each time-limited access request.</p>
      {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}
      {loading ? <p aria-live="polite">Loading review queue…</p> : requests.length === 0 ? (
        <div style={panelStyle}><p style={{ margin: 0 }}>There are no pending emergency access reviews.</p></div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {requests.map(item => <article key={item.id} style={panelStyle}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{item.document}</h2>
            <p style={{ margin: "8px 0" }}>Requested by {item.requester} · Policy ID {item.documentId} · {item.status}</p>
            <blockquote style={{ margin: "12px 0", paddingLeft: 14, borderLeft: "3px solid #d5e2dc" }}>{item.justification}</blockquote>
            <p style={{ color: "#5c6d68", fontSize: 13 }}>Granted {new Date(item.grantedAt).toLocaleString()} · Expires {new Date(item.expiresAt).toLocaleString()}</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => void review(item, "justified")} style={approveStyle}>Mark justified</button>
              <button onClick={() => void review(item, "unjustified")} style={rejectStyle}>Mark unjustified</button>
            </div>
          </article>)}
        </div>
      )}
    </section>
  );
}

const panelStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
const approveStyle = { border: 0, borderRadius: 7, padding: "9px 12px", background: "#18765f", color: "white", fontWeight: 700, cursor: "pointer" };
const rejectStyle = { border: "1px solid #a32929", borderRadius: 7, padding: "9px 12px", background: "white", color: "#a32929", fontWeight: 700, cursor: "pointer" };
