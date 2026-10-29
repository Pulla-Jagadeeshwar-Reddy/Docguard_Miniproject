"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/lib/api";

type DashboardData = {
  documentStatuses: { status: string; count: number }[];
  expiringSoon: { id: number; title: string; category: string; versionNumber: number; expiryDate: string; daysRemaining: number }[];
  accessActivity: { date: string; action: string; count: number; breakGlassCount: number }[];
};
type KeywordAnalytics = { topKeywords: { _id: { category: string; keyword: string }; count: number }[] };

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [keywords, setKeywords] = useState<KeywordAnalytics | null>(null);

  useEffect(() => {
    api<DashboardData>("/dashboard")
      .then(setData)
      .catch(caught => setError(caught instanceof Error ? caught.message : "Dashboard data could not be loaded"));
  }, []);

  useEffect(() => {
    api<{ user: { role: string } }>("/auth/me")
      .then(({ user }) => user.role === "Admin" ? api<KeywordAnalytics>("/analytics/keywords").then(setKeywords) : undefined)
      .catch(() => undefined);
  }, []);

  const activityByDate = useMemo(() => {
    const days = new Map<string, number>();
    for (const event of data?.accessActivity ?? []) {
      const date = new Date(event.date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      days.set(date, (days.get(date) ?? 0) + event.count);
    }
    return [...days].map(([date, events]) => ({ date, events }));
  }, [data]);

  if (error) return <section><h1>Policy and compliance workspace</h1><p role="alert" style={{ color: "#a32929" }}>{error}</p></section>;
  if (!data) return <p aria-live="polite">Loading dashboard…</p>;

  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>WORKSPACE</p>
      <h1>Policy and compliance workspace</h1>
      <p style={{ color: "#5c6d68", maxWidth: 680, lineHeight: 1.6 }}>A live overview of policy status, permitted upcoming expirations, and access activity.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 14, marginTop: 24 }}>
        {data.documentStatuses.map(item => (
          <article key={item.status} style={cardStyle}>
            <p style={{ color: "#5c6d68", textTransform: "capitalize", margin: 0 }}>{item.status.replaceAll("_", " ")} policies</p>
            <strong style={{ display: "block", marginTop: 8, fontSize: 30 }}>{item.count}</strong>
          </article>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 18, marginTop: 22 }}>
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Upcoming policy expirations</h2>
          {data.expiringSoon.length === 0 ? <p style={{ color: "#5c6d68" }}>No permitted policies expire in the next 30 days.</p> : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {data.expiringSoon.map(item => <li key={item.id} style={{ padding: "10px 0", borderTop: "1px solid #e6eeeb" }}>
                <Link href={`/documents/${item.id}`} style={{ color: "#176c59", fontWeight: 700 }}>{item.title}</Link>
                <span style={{ display: "block", color: "#5c6d68", fontSize: 13 }}>{item.category} · v{item.versionNumber} · {item.daysRemaining} days · expires {item.expiryDate}</span>
              </li>)}
            </ul>
          )}
        </section>

        <section style={cardStyle}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Access activity · last 14 days</h2>
          {activityByDate.length === 0 ? <p style={{ color: "#5c6d68" }}>No access events in this period.</p> : (
            <div aria-label="Access events by date" role="img" style={{ width: "100%", height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={activityByDate} margin={{ top: 8, right: 12, left: -18, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="events" name="Access events" fill="#18765f" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>
      </div>
      {keywords && <section style={{ ...cardStyle, marginTop: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Frequently indexed policy terms</h2>
        {keywords.topKeywords.length === 0 ? <p style={{ color: "#5c6d68" }}>No approved policy text is indexed yet.</p> :
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "8px 20px" }}>
            {keywords.topKeywords.slice(0, 8).map(item => <div key={`${item._id.category}-${item._id.keyword}`} style={{ display: "flex", justifyContent: "space-between", gap: 12, borderBottom: "1px solid #edf1ef", padding: "7px 0" }}>
              <span>{item._id.keyword} <small style={{ color: "#687872" }}>· {item._id.category}</small></span>
              <strong>{item.count}</strong>
            </div>)}
          </div>}
      </section>}
    </section>
  );
}

const cardStyle = { background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 20 };
