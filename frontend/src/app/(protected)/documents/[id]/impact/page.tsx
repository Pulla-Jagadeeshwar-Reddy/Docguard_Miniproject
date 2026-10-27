"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { DependencyGraph } from "@/components/dependency-graph";

type DocumentOption = { id: number; title: string };
type GraphData = {
  root: DocumentOption;
  nodes: { id: number; title: string; depth: number }[];
  edges: { source: number; target: number; type: string }[];
};
type Impact = { id: number; title: string; depth: number };
const relationSchema = z.object({
  targetDocumentId: z.string().min(1).transform(Number).pipe(z.number().int().positive()),
  referenceType: z.enum(["depends_on", "cites", "supersedes"])
}).strict();
type RelationInput = z.input<typeof relationSchema>;
type RelationValues = z.infer<typeof relationSchema>;

export default function DocumentImpactPage() {
  const { id } = useParams<{ id: string }>();
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [impact, setImpact] = useState<Impact[]>([]);
  const [documents, setDocuments] = useState<DocumentOption[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RelationInput, unknown, RelationValues>({
    resolver: zodResolver(relationSchema),
    defaultValues: { referenceType: "depends_on" }
  });

  const load = useCallback(async () => {
    const [graphResult, impactResult, documentsResult] = await Promise.all([
      api<GraphData>(`/documents/${id}/graph`),
      api<{ impactedDocuments: Impact[] }>(`/documents/${id}/impact`),
      api<{ documents: DocumentOption[] }>("/documents")
    ]);
    setGraph(graphResult);
    setImpact(impactResult.impactedDocuments);
    setDocuments(documentsResult.documents);
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load().catch(caught => setError(caught instanceof Error ? caught.message : "Dependency data could not be loaded"))
      .finally(() => setLoading(false));
  }, [load]);

  async function addReference(values: RelationValues) {
    setError(""); setMessage("");
    try {
      await api(`/documents/${id}/references`, { method: "POST", body: JSON.stringify(values) });
      setMessage("Dependency reference added.");
      reset({ referenceType: "depends_on" });
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Reference could not be added"); }
  }

  if (loading) return <p aria-live="polite">Loading dependency graph…</p>;
  if (!graph) return <section><Link href="/documents">← Documents</Link><p role="alert" style={{ color: "#a32929" }}>{error || "Dependency data unavailable"}</p></section>;

  return (
    <section>
      <Link href={`/documents/${id}`} style={{ color: "#176c59" }}>← {graph.root.title}</Link>
      <p style={{ color: "#18765f", fontWeight: 700, marginTop: 26 }}>POLICY RELATIONSHIPS</p>
      <h1>Dependency graph and impact</h1>
      <p style={{ color: "#5c6d68", maxWidth: 720 }}>The graph follows linked policies in either direction. Impact lists policies that depend on this policy, including indirect dependencies; the recursive query tracks visited ids so cycles terminate.</p>
      {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}
      {message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}

      <DependencyGraph documents={graph.nodes} references={graph.edges} />

      <section style={panelStyle}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Policies affected if this policy changes</h2>
        {impact.length === 0 ? <p>No dependent policies were found.</p> : (
          <ul>{impact.map(item => <li key={item.id} style={{ marginBottom: 6 }}><Link href={`/documents/${item.id}`} style={{ color: "#176c59" }}>{item.title}</Link> · {item.depth} step{item.depth === 1 ? "" : "s"} away</li>)}</ul>
        )}
      </section>

      <form onSubmit={handleSubmit(addReference)} style={{ ...panelStyle, display: "grid", gap: 12, maxWidth: 640 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Add a reference from this policy</h2>
        <label style={labelStyle}>Referenced policy
          <select {...register("targetDocumentId")} style={inputStyle} defaultValue="">
            <option value="" disabled>Select a policy</option>
            {documents.filter(document => document.id !== Number(id)).map(document => <option key={document.id} value={document.id}>{document.title}</option>)}
          </select>
        </label>
        {errors.targetDocumentId && <small role="alert" style={{ color: "#a32929" }}>Choose a referenced policy.</small>}
        <label style={labelStyle}>Relationship type
          <select {...register("referenceType")} style={inputStyle}>
            <option value="depends_on">Depends on</option><option value="cites">Cites</option><option value="supersedes">Supersedes</option>
          </select>
        </label>
        <button disabled={isSubmitting || documents.length < 2} style={buttonStyle}>{isSubmitting ? "Saving…" : "Add reference"}</button>
      </form>
    </section>
  );
}

const panelStyle = { marginTop: 20, background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
const labelStyle = { display: "grid", gap: 7, fontWeight: 600 };
const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
const buttonStyle = { width: "fit-content", border: 0, borderRadius: 7, padding: "10px 14px", background: "#18765f", color: "white", fontWeight: 700, cursor: "pointer" };
