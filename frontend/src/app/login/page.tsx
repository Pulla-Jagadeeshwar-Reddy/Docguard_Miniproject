"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") })
      });
      router.replace("/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f4f7f6", padding: 24 }}>
      <section style={{ width: "min(100%, 420px)", background: "white", border: "1px solid #dce5e2", borderRadius: 14, padding: 32, boxShadow: "0 12px 32px #193d3210" }}>
        <p style={{ color: "#18765f", fontWeight: 700, margin: 0 }}>DOCUGUARD · HOSPITAL POLICY</p>
        <h1 style={{ marginBottom: 8, color: "#17342d" }}>Sign in</h1>
        <p style={{ color: "#5c6d68", marginTop: 0 }}>Use your assigned DocuGuard account.</p>
        <form onSubmit={submit} style={{ display: "grid", gap: 16 }}>
          <label style={{ display: "grid", gap: 6 }}>Email
            <input name="email" type="email" autoComplete="username" required maxLength={255} style={inputStyle} />
          </label>
          <label style={{ display: "grid", gap: 6 }}>Password
            <input name="password" type="password" autoComplete="current-password" required style={inputStyle} />
          </label>
          {error && <p role="alert" style={{ color: "#a32929", margin: 0 }}>{error}</p>}
          <button disabled={busy} type="submit" style={buttonStyle}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </section>
    </main>
  );
}

const inputStyle = { border: "1px solid #b9c9c4", borderRadius: 8, padding: "11px 12px", font: "inherit" };
const buttonStyle = { border: 0, borderRadius: 8, padding: "12px 16px", background: "#18765f", color: "white", font: "inherit", fontWeight: 700, cursor: "pointer" };
