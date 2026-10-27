"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, uploadWithProgress } from "@/lib/api";

type Version = { id: number; versionNumber: number; status: string; uploadedAt: string; effectiveDate: string; expiryDate: string | null; uploadedBy: string; approvedBy: string | null; approvedAt: string | null };
type DocumentDetail = { id: number; title: string; status: string; categoryId: number; category: string; owner: string; currentVersionId: number | null };
const versionSchema = z.object({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an effective date"),
  expiryDate: z.string().optional(),
  file: z.custom<FileList>(value => {
      if (typeof FileList === "undefined" || !(value instanceof FileList) || value.length !== 1) return false;
      const file = value[0];
      const extension = file.name.toLowerCase().split(".").pop();
      const acceptedType = (extension === "pdf" && file.type === "application/pdf") ||
        (extension === "docx" && file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      return file.size <= 20 * 1024 * 1024 && acceptedType;
    }, "Choose one PDF or DOCX file no larger than 20 MB")
});
type VersionValues = z.infer<typeof versionSchema>;

export default function DocumentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [ingestionPending, setIngestionPending] = useState(false);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { register, handleSubmit, formState: { errors: versionErrors }, reset } = useForm<VersionValues>({ resolver: zodResolver(versionSchema) });

  async function load() {
    const [detail, session] = await Promise.all([
      api<{ document: DocumentDetail; versions: Version[]; ingestionPending: boolean }>(`/documents/${params.id}`),
      api<{ user: { role: string } }>("/auth/me")
    ]);
    setDocument(detail.document); setVersions(detail.versions); setIngestionPending(detail.ingestionPending); setRole(session.user.role);
  }

  useEffect(() => { load().catch(caught => setError(caught instanceof Error ? caught.message : "Could not load document")); }, [params.id]);

  async function approve(versionId: number) {
    setError(""); setMessage("");
    try {
      await api(`/documents/versions/${versionId}/approve`, { method: "POST" });
      setMessage("Version approved and made current.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Approval failed"); }
  }

  async function uploadVersion(values: VersionValues) {
    setUploadingVersion(true); setUploadProgress(0); setError(""); setMessage("");
    const body = new FormData();
    body.append("title", document!.title);
    body.append("categoryId", String(document!.categoryId));
    body.append("effectiveDate", values.effectiveDate);
    body.append("expiryDate", values.expiryDate ?? "");
    body.append("file", values.file[0]);
    try {
      await uploadWithProgress(`/documents/${params.id}/versions`, body, setUploadProgress);
      setMessage("New version submitted for review.");
      await load();
      reset();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Version upload failed"); }
    finally { setUploadingVersion(false); }
  }

  if (!document && !error) return <p aria-live="polite">Loading document…</p>;
  if (!document) return <section><Link href="/documents">← Documents</Link><p role="alert" style={{ color: "#a32929" }}>{error}</p></section>;

  return (
    <section>
      <Link href="/documents" style={{ color: "#176c59" }}>← Documents</Link>
      <p style={{ color: "#18765f", fontWeight: 700, marginTop: 28 }}>{document.category.toUpperCase()}</p>
      <h1>{document.title}</h1>
      <p style={{ color: "#5c6d68" }}>Owner: {document.owner} · Document status: {document.status}</p>
      {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}{message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}
      {ingestionPending && <p role="status" style={{ ...panelStyle, color: "#6b5a1a" }}>The file is stored and versioned. Text extraction and search indexing are awaiting Push’s ingestion service.</p>}
      <div style={panelStyle}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Version history</h2>
        {versions.length === 0 ? <p>No versions have been uploaded.</p> : <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", minWidth: 700, borderCollapse: "collapse" }}>
            <thead><tr>{["Version", "Status", "Uploaded by", "Uploaded", "Effective", "Expires", "Approved by", "File"].map(value => <th key={value} scope="col" style={thStyle}>{value}</th>)}</tr></thead>
            <tbody>{versions.map(version => <tr key={version.id}>
              <td style={tdStyle}>v{version.versionNumber}{document.currentVersionId === version.id ? " · Current" : ""}</td>
              <td style={tdStyle}>{version.status}</td><td style={tdStyle}>{version.uploadedBy}</td>
              <td style={tdStyle}>{new Date(version.uploadedAt).toLocaleDateString()}</td><td style={tdStyle}>{version.effectiveDate}</td>
              <td style={tdStyle}>{version.expiryDate ?? "No expiry"}</td><td style={tdStyle}>{version.approvedBy ?? "—"}</td>
              <td style={tdStyle}><a href={`/api/versions/${version.id}/file`} style={{ color: "#176c59" }}>Download</a>
                {role === "Admin" && version.status === "pending_review" && <button onClick={() => void approve(version.id)} style={smallButtonStyle}>Approve</button>}
              </td>
            </tr>)}</tbody>
          </table>
        </div>}
      </div>
      {(role === "Admin" || role === "Doctor") && <form onSubmit={handleSubmit(uploadVersion)} style={{ ...panelStyle, marginTop: 18, display: "grid", gap: 12, maxWidth: 640 }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Submit a new version</h2>
        <label style={labelStyle}>Effective date<input {...register("effectiveDate")} type="date" style={inputStyle} /></label>
        {versionErrors.effectiveDate && <small role="alert" style={{ color: "#a32929" }}>{versionErrors.effectiveDate.message}</small>}
        <label style={labelStyle}>Expiry date (optional)<input {...register("expiryDate")} type="date" style={inputStyle} /></label>
        <label style={labelStyle}>PDF or DOCX file (20 MB maximum)<input {...register("file")} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={inputStyle} /></label>
        {versionErrors.file && <small role="alert" style={{ color: "#a32929" }}>{versionErrors.file.message}</small>}
        {uploadingVersion && <label style={labelStyle}>Upload progress: {uploadProgress}%<progress value={uploadProgress} max={100} aria-label="Upload progress" /></label>}
        <button disabled={uploadingVersion} style={smallButtonStyle}>{uploadingVersion ? "Uploading…" : "Submit version for review"}</button>
      </form>}
    </section>
  );
}

const panelStyle = { marginTop: 22, background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
const thStyle = { textAlign: "left" as const, padding: 10, borderBottom: "1px solid #dce5e2", color: "#52645f", fontSize: 13 };
const tdStyle = { padding: 10, borderBottom: "1px solid #edf1ef", fontSize: 14 };
const smallButtonStyle = { display: "block", marginTop: 6, border: 0, borderRadius: 6, padding: "7px 9px", background: "#18765f", color: "white", fontWeight: 600, cursor: "pointer" };
const labelStyle = { display: "grid", gap: 7, fontWeight: 600 };
const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
