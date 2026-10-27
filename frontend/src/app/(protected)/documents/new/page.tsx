"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api, uploadWithProgress } from "@/lib/api";

type Category = { id: number; name: string };
type UploadResult = { documentId: number; versionId: number; ingestionPending: boolean };
const uploadSchema = z.object({
  title: z.string().trim().min(1, "Enter a policy title").max(255),
  categoryId: z.string().min(1, "Choose a category"),
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
type UploadValues = z.infer<typeof uploadSchema>;

export default function NewDocumentPage() {
  const router = useRouter();
  const [categories, setCategories] = useState<Category[]>([]);
  const [role, setRole] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const { register, handleSubmit, formState: { errors }, reset } = useForm<UploadValues>({ resolver: zodResolver(uploadSchema) });

  useEffect(() => {
    Promise.all([api<{ categories: Category[] }>("/documents/categories"), api<{ user: { role: string } }>("/auth/me")])
      .then(([result, session]) => { setCategories(result.categories); setRole(session.user.role); })
      .catch(caught => setError(caught instanceof Error ? caught.message : "Could not load upload form"));
  }, []);

  async function submit(values: UploadValues) {
    setBusy(true); setError(""); setProgress(0);
    try {
      const form = new FormData();
      form.append("title", values.title);
      form.append("categoryId", values.categoryId);
      form.append("effectiveDate", values.effectiveDate);
      form.append("expiryDate", values.expiryDate ?? "");
      form.append("file", values.file[0]);
      const result = await uploadWithProgress<UploadResult>("/documents", form, setProgress);
      reset();
      router.replace(`/documents/${result.documentId}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed"); }
    finally { setBusy(false); }
  }

  return (
    <section style={{ maxWidth: 720 }}>
      <Link href="/documents" style={{ color: "#176c59" }}>← Documents</Link>
      <p style={{ color: "#18765f", fontWeight: 700, marginTop: 28 }}>DOCUMENT CONTROL</p>
      <h1>Upload a policy</h1>
      {(role === "Admin" || role === "Doctor") ? (
        <form onSubmit={handleSubmit(submit)} style={{ display: "grid", gap: 16, marginTop: 24, padding: 24, background: "white", border: "1px solid #dce5e2", borderRadius: 12 }}>
          <label style={labelStyle}>Policy title<input {...register("title")} maxLength={255} style={inputStyle} aria-invalid={Boolean(errors.title)} /></label>
          {errors.title && <small role="alert" style={errorStyle}>{errors.title.message}</small>}
          <label style={labelStyle}>Category<select {...register("categoryId")} style={inputStyle} aria-invalid={Boolean(errors.categoryId)}><option value="">Choose a category</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          {errors.categoryId && <small role="alert" style={errorStyle}>{errors.categoryId.message}</small>}
          <label style={labelStyle}>Effective date<input type="date" {...register("effectiveDate")} style={inputStyle} aria-invalid={Boolean(errors.effectiveDate)} /></label>
          {errors.effectiveDate && <small role="alert" style={errorStyle}>{errors.effectiveDate.message}</small>}
          <label style={labelStyle}>Expiry date (optional)<input type="date" {...register("expiryDate")} style={inputStyle} /></label>
          <label style={labelStyle}>Policy file<input {...register("file")} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={inputStyle} aria-invalid={Boolean(errors.file)} /><small>PDF or DOCX, maximum 20 MB.</small></label>
          {errors.file && <small role="alert" style={errorStyle}>{errors.file.message}</small>}
          {busy && <label style={labelStyle}>Upload progress: {progress}%<progress value={progress} max={100} aria-label="Upload progress" /></label>}
          {error && <p role="alert" style={{ color: "#a32929", margin: 0 }}>{error}</p>}
          <button disabled={busy || categories.length === 0} style={buttonStyle}>{busy ? "Uploading…" : "Submit for review"}</button>
        </form>
      ) : role ? <p role="alert">Only Admin and Doctor accounts may submit policy files.</p> : <p aria-live="polite">Loading upload form…</p>}
      <p style={{ color: "#6b7773", fontSize: 13, lineHeight: 1.5, marginTop: 16 }}>Submitted files enter pending review. A different Admin must approve the version before it becomes current.</p>
    </section>
  );
}

const labelStyle = { display: "grid", gap: 7, fontWeight: 600 };
const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
const buttonStyle = { border: 0, borderRadius: 7, padding: "11px 14px", background: "#18765f", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" };
const errorStyle = { color: "#a32929" };
