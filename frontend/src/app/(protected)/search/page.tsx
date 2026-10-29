"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Category = { id: number; name: string };
type SearchResult = {
  documentId: number;
  title: string;
  category: string;
  versionId: number;
  versionNumber: number;
  effectiveDate: string;
  score: number;
  matchedBy: string[];
  snippet: string;
};
type SearchResponse = { query: string; type: string; count: number; results: SearchResult[] };

export default function SearchPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("hybrid");
  const [categoryId, setCategoryId] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api<{ categories: Category[] }>("/documents/categories").then(result => setCategories(result.categories)).catch(() => undefined); }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    if (!clean) { setError("Enter a search phrase."); return; }
    const params = new URLSearchParams({ q: clean, type });
    if (categoryId) params.set("categoryId", categoryId);
    setLoading(true); setError("");
    try { setData(await api<SearchResponse>(`/search?${params.toString()}`)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Search could not be completed"); }
    finally { setLoading(false); }
  }

  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>POLICY LIBRARY</p>
      <h1>Search policies</h1>
      <p style={{ color: "#5c6d68", maxWidth: 700, lineHeight: 1.6 }}>Search approved policies you can access by exact wording or by meaning. Snippets come from the matching policy text.</p>
      <form onSubmit={submit} style={panelStyle}>
        <label style={{ display: "grid", gap: 7, flex: "1 1 300px", fontWeight: 600 }}>
          Search phrase
          <input value={query} onChange={event => setQuery(event.target.value)} maxLength={200} placeholder="e.g. needle prick injury" style={inputStyle} />
        </label>
        <label style={labelStyle}>Search mode
          <select value={type} onChange={event => setType(event.target.value)} style={inputStyle}>
            <option value="hybrid">Hybrid</option><option value="semantic">By meaning</option><option value="keyword">Exact terms</option>
          </select>
        </label>
        <label style={labelStyle}>Category
          <select value={categoryId} onChange={event => setCategoryId(event.target.value)} style={inputStyle}>
            <option value="">All accessible categories</option>
            {categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <button disabled={loading} style={buttonStyle}>{loading ? "Searching…" : "Search"}</button>
      </form>
      {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}
      {data && <div aria-live="polite" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 19 }}>{data.count} {data.count === 1 ? "result" : "results"} for “{data.query}”</h2>
        {data.results.length === 0 ? <p style={{ color: "#5c6d68" }}>No accessible approved policy matched that search.</p> : <div style={{ display: "grid", gap: 12 }}>
          {data.results.map(result => <article key={`${result.documentId}-${result.versionId}`} style={cardStyle}>
            <p style={{ color: "#18765f", fontSize: 12, fontWeight: 700, margin: 0 }}>{result.category.toUpperCase()} · {result.matchedBy.join(" + ").toUpperCase()}</p>
            <h3 style={{ margin: "7px 0" }}><Link href={`/documents/${result.documentId}`} style={{ color: "#176c59" }}>{result.title}</Link></h3>
            <p style={{ color: "#43564f", lineHeight: 1.6, margin: "8px 0" }}>{result.snippet}{result.snippet.length >= 520 ? "…" : ""}</p>
            <small style={{ color: "#64746f" }}>Approved version {result.versionNumber} · effective {result.effectiveDate} · rank score {result.score.toFixed(4)}</small>
          </article>)}
        </div>}
      </div>}
    </section>
  );
}

const panelStyle = { display: "flex", flexWrap: "wrap" as const, alignItems: "end", gap: 12, background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 18, marginTop: 22 };
const labelStyle = { display: "grid", gap: 7, minWidth: 170, fontWeight: 600 };
const inputStyle = { width: "100%", border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
const buttonStyle = { border: 0, borderRadius: 7, padding: "11px 18px", background: "#18765f", color: "white", fontWeight: 700, cursor: "pointer" };
const cardStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 18 };
