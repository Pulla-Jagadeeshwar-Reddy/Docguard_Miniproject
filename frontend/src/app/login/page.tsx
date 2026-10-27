"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";

const loginSchema = z.object({ email: z.string().email().max(255), password: z.string().min(1).max(200) });
type LoginValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [apiError, setApiError] = useState("");
  const [busy, setBusy] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  async function submit(values: LoginValues) {
    setBusy(true);
    setApiError("");
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify(values)
      });
      router.replace("/dashboard");
    } catch (caught) {
      setApiError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center" style={{ background: "#f4f7f6", padding: 24 }}>
      <section style={{ width: "min(100%, 420px)", background: "white", border: "1px solid #dce5e2", borderRadius: 14, padding: 32, boxShadow: "0 12px 32px #193d3210" }}>
        <p style={{ color: "#18765f", fontWeight: 700, margin: 0 }}>DOCUGUARD · HOSPITAL POLICY</p>
        <h1 style={{ marginBottom: 8, color: "#17342d" }}>Sign in</h1>
        <p style={{ color: "#5c6d68", marginTop: 0 }}>Use your assigned DocuGuard account.</p>
        <form onSubmit={handleSubmit(submit)} style={{ display: "grid", gap: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>Email
            <input {...register("email")} type="email" autoComplete="username" maxLength={255} style={inputStyle} aria-invalid={Boolean(errors.email)} />
          </label>
          {errors.email && <small role="alert" style={{ color: "#a32929" }}>{errors.email.message}</small>}
          <label style={{ display: "grid", gap: 6 }}>Password
            <input {...register("password")} type="password" autoComplete="current-password" style={inputStyle} aria-invalid={Boolean(errors.password)} />
          </label>
          {errors.password && <small role="alert" style={{ color: "#a32929" }}>{errors.password.message}</small>}
          {apiError && <p role="alert" style={{ color: "#a32929", margin: 0 }}>{apiError}</p>}
          <button disabled={busy} type="submit" style={buttonStyle}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 8, padding: "11px 12px", font: "inherit" };
const buttonStyle = { border: 0, borderRadius: 8, padding: "12px 16px", background: "#18765f", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" };
