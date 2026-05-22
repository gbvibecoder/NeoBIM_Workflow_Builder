/**
 * KOS — authenticated customer app placeholder (Week 1).
 *
 * Phone-OTP gate, cross-channel conversation history, drawing upload
 * (Stage B) — all Week 5+. Today this page is unauthenticated and
 * intentionally empty; no `kos_session` cookie check yet.
 */

export default function KosApp() {
  return (
    <section style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 32, fontWeight: 800, marginBottom: 12, letterSpacing: "-0.02em" }}>
        Customer app
      </h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, opacity: 0.75 }}>
        Coming in Week 5 — phone-verified customer dashboard with
        cross-channel conversation history and project drawings.
      </p>
    </section>
  );
}
