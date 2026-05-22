/**
 * KOS — BD console sign-in page.
 *
 * Server component shell. The interactive form lives in
 * `./LoginForm.tsx` as a client component so the page itself stays
 * cheap (no React hydration cost for the visual chrome).
 *
 * Route group: `(unauthenticated)`. The sibling `(authenticated)`
 * layout is what enforces "must be signed in to see /bd, /bd/documents,
 * etc."; this segment has NO such guard. Keeping the two groups in
 * separate folders is the canonical Next.js App Router pattern for
 * "public route inside a mostly-private feature" — see also
 * `src/app/(auth)/login` vs `src/app/dashboard`.
 */

import LoginForm from "./LoginForm";

export const metadata = {
  title: "BD Sign-In · KOS",
};

export default function KosBdLoginPage() {
  return (
    <section
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "calc(100vh - 120px)",
        padding: "16px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "rgba(10,10,10,0.7)",
          border: "1px solid rgba(201,165,90,0.18)",
          borderRadius: 16,
          padding: "32px 28px",
          boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
        }}
      >
        <h1
          style={{
            fontSize: 24,
            fontWeight: 800,
            marginBottom: 8,
            letterSpacing: "-0.02em",
          }}
        >
          BD sign-in
        </h1>
        <p style={{ fontSize: 13, lineHeight: 1.6, opacity: 0.72, marginBottom: 24 }}>
          Authorized business-development access only. Sign in with your tenant
          email and password.
        </p>
        <LoginForm />
      </div>
    </section>
  );
}
