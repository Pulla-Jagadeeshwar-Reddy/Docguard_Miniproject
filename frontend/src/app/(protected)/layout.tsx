"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { NotificationsBell } from "@/components/notifications-bell";

type SessionUser = { id: number; fullName: string; role: string };

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: SessionUser }>("/auth/me").then(result => setUser(result.user)).catch(() => router.replace("/login")).finally(() => setLoading(false));
  }, [router]);

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  }

  if (loading || !user) {
    return <main style={{ padding: 40, color: "#50635d" }} aria-live="polite">{loading ? "Loading your session…" : "Redirecting to sign in…"}</main>;
  }

  const links = [
    { href: "/dashboard", label: "Overview" },
    { href: "/documents", label: "Documents" },
    { href: "/search", label: "Search" },
    { href: "/my-policies", label: "My Policies" },
    ...(user.role === "Doctor" || user.role === "Nurse" ? [
      { href: "/break-glass", label: "Emergency access" }
    ] : []),
    ...(user.role === "Admin" ? [
      { href: "/admin/users", label: "User administration" },
      { href: "/admin/audit", label: "Audit log" },
      { href: "/admin/break-glass", label: "Emergency reviews" },
      { href: "/admin/acknowledgments", label: "Acknowledgments" },
      { href: "/compliance/coverage", label: "Coverage" }
    ] : [])
  ];
  return (
    <div className="min-h-screen" style={{ background: "#f4f7f6", color: "#17342d" }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "14px 28px", background: "white", borderBottom: "1px solid #dce5e2" }}>
        <Link href="/dashboard" style={{ color: "#18765f", fontWeight: 800, textDecoration: "none" }}>DocuGuard</Link>
        <nav aria-label="Main navigation" style={{ display: "flex", gap: 18, marginRight: "auto", marginLeft: 28 }}>
          {links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} style={{ color: pathname === link.href ? "#18765f" : "#52645f", fontWeight: 600 }}>{link.label}</Link>)}
        </nav>
        <NotificationsBell />
        <span>{user.fullName} · {user.role}</span>
        <button onClick={logout} style={{ border: "1px solid #b9c9c4", borderRadius: 7, background: "white", padding: "8px 12px", cursor: "pointer" }}>Sign out</button>
      </header>
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "36px 24px" }}>{children}</main>
    </div>
  );
}
