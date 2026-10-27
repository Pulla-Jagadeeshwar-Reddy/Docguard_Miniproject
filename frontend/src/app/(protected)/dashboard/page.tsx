export default function DashboardPage() {
  return (
    <section>
      <p style={{ color: "#18765f", fontWeight: 700 }}>WORKSPACE</p>
      <h1>Policy and compliance workspace</h1>
      <p style={{ color: "#5c6d68", maxWidth: 680, lineHeight: 1.6 }}>
        Your DocuGuard session is active. Document workflows, search, audit, and compliance panels will appear here as their project phases are delivered.
      </p>
      <div style={{ marginTop: 28, background: "white", border: "1px solid #dce5e2", borderRadius: 12, padding: 22 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Signed-in access</h2>
        <p style={{ color: "#5c6d68", marginBottom: 0 }}>Every protected API request checks the current account, role, and database permissions.</p>
      </div>
    </section>
  );
}
