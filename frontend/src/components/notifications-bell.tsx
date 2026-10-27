"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

type Notification = {
  id: number;
  documentId: number | null;
  documentTitle: string | null;
  type: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

type NotificationResponse = { notifications: Notification[]; unreadCount: number };

export function NotificationsBell() {
  const [items, setItems] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await api<NotificationResponse>("/notifications?limit=10");
      setItems(result.notifications);
      setUnreadCount(result.unreadCount);
      setError("");
    } catch {
      setError("Notifications could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function markRead(item: Notification) {
    if (item.isRead) return;
    try {
      await api(`/notifications/${item.id}/read`, { method: "PATCH" });
      setItems(current => current.map(value => value.id === item.id ? { ...value, isRead: true } : value));
      setUnreadCount(value => Math.max(0, value - 1));
    } catch {
      setError("This notification could not be marked as read.");
    }
  }

  async function markAllRead() {
    try {
      await api("/notifications/read-all", { method: "PATCH" });
      setItems(current => current.map(item => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch {
      setError("Notifications could not be updated.");
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`}
        aria-expanded={open}
        aria-controls="notification-menu"
        onClick={() => { setOpen(value => !value); if (!open) void refresh(); }}
        style={{ border: "1px solid #b9c9c4", borderRadius: 7, background: "white", padding: "8px 12px", cursor: "pointer", color: "#17342d" }}
      >
        Notifications{unreadCount > 0 && <span aria-hidden="true" style={{ marginLeft: 6, color: "#a32929", fontWeight: 700 }}>({unreadCount})</span>}
      </button>
      {open && (
        <section id="notification-menu" aria-label="Recent notifications" style={{ position: "absolute", zIndex: 20, right: 0, top: 44, width: "min(90vw, 380px)", maxHeight: 440, overflow: "auto", padding: 14, border: "1px solid #dce5e2", borderRadius: 10, background: "white", boxShadow: "0 12px 32px #193d3220" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>Notifications</h2>
            <button type="button" onClick={() => void markAllRead()} disabled={unreadCount === 0} style={{ border: 0, background: "transparent", color: "#176c59", cursor: unreadCount ? "pointer" : "default" }}>Mark all read</button>
          </div>
          {error && <p role="alert" style={{ color: "#a32929" }}>{error}</p>}
          {!error && items.length === 0 && <p style={{ color: "#5c6d68" }}>You’re all caught up.</p>}
          <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
            {items.map(item => (
              <li key={item.id} style={{ borderTop: "1px solid #e6eeeb", background: item.isRead ? "white" : "#f4f9f7", padding: "10px 8px" }}>
                {item.documentId ? (
                  <Link href={`/documents/${item.documentId}`} onClick={() => void markRead(item)} style={{ display: "block", color: "inherit", textDecoration: "none" }}>
                    <strong>{item.documentTitle ?? "Policy notification"}</strong>
                    <span style={{ display: "block", marginTop: 4, fontSize: 13 }}>{item.message}</span>
                    <time dateTime={item.createdAt} style={{ display: "block", marginTop: 5, color: "#657670", fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</time>
                  </Link>
                ) : (
                  <div>
                    <strong>{item.type.replaceAll("_", " ")}</strong>
                    <span style={{ display: "block", marginTop: 4, fontSize: 13 }}>{item.message}</span>
                    <time dateTime={item.createdAt} style={{ display: "block", marginTop: 5, color: "#657670", fontSize: 12 }}>{new Date(item.createdAt).toLocaleString()}</time>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
