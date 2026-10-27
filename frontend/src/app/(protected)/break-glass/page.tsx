"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";

const requestSchema = z.object({
  documentId: z.string().regex(/^[1-9]\d*$/, "Enter a positive policy ID").transform(Number).pipe(z.number().int().positive()),
  justification: z.string().trim().min(20, "Explain why emergency access is needed (at least 20 characters)").max(2000),
  durationHours: z.string().transform(Number).pipe(z.number().int().min(1).max(24))
}).strict();
type RequestInput = z.input<typeof requestSchema>;
type RequestValues = z.output<typeof requestSchema>;

export default function BreakGlassPage() {
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<RequestInput, unknown, RequestValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { durationHours: "1" }
  });

  async function requestAccess(values: RequestValues) {
    setError(""); setMessage("");
    try {
      const result = await api<{ override: { id: number; expiresAt: string } }>("/overrides", {
        method: "POST",
        body: JSON.stringify(values)
      });
      setMessage(`Emergency access granted until ${new Date(result.override.expiresAt).toLocaleString()}. An Admin review was requested.`);
      reset({ durationHours: "1" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Emergency access could not be requested");
    }
  }

  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>TIME-LIMITED ACCESS</p>
      <h1>Request emergency policy access</h1>
      <p style={{ color: "#5c6d68", maxWidth: 680, lineHeight: 1.6 }}>Use this only when a policy you cannot normally open is needed for urgent care. Enter the policy ID supplied by your department, explain the clinical need, and choose an access period of at most 24 hours. Every request is logged and sent to Admin reviewers.</p>
      <form onSubmit={handleSubmit(requestAccess)} role="dialog" aria-modal="true" aria-labelledby="break-glass-request-title" style={panelStyle}>
        <h2 id="break-glass-request-title" style={{ margin: 0, fontSize: 18 }}>Emergency access request</h2>
        <label style={labelStyle}>Policy ID
          <input {...register("documentId")} type="number" min="1" step="1" required style={inputStyle} />
        </label>
        {errors.documentId && <small role="alert" style={errorStyle}>{errors.documentId.message}</small>}
        <label style={labelStyle}>Justification
          <textarea {...register("justification")} minLength={20} maxLength={2000} required rows={5} placeholder="Describe why this policy is needed for urgent care…" style={{ ...inputStyle, resize: "vertical" }} />
        </label>
        {errors.justification && <small role="alert" style={errorStyle}>{errors.justification.message}</small>}
        <label style={labelStyle}>Access duration
          <select {...register("durationHours")} style={inputStyle}>
            <option value="1">1 hour</option><option value="4">4 hours</option><option value="8">8 hours</option><option value="24">24 hours</option>
          </select>
        </label>
        {error && <p role="alert" style={errorStyle}>{error}</p>}
        {message && <p role="status" style={{ color: "#18765f" }}>{message}</p>}
        <button disabled={isSubmitting} style={buttonStyle}>{isSubmitting ? "Requesting…" : "Request emergency access"}</button>
      </form>
    </section>
  );
}

const panelStyle = { display: "grid", gap: 14, maxWidth: 640, marginTop: 24, padding: 22, background: "white", border: "1px solid #dce5e2", borderRadius: 12 };
const labelStyle = { display: "grid", gap: 7, fontWeight: 600 };
const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 7, padding: "10px 12px", font: "inherit", background: "white" };
const errorStyle = { color: "#a32929" };
const buttonStyle = { width: "fit-content", border: 0, borderRadius: 7, padding: "11px 15px", background: "#8b3b27", color: "white", fontWeight: 700, cursor: "pointer" };
