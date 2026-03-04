import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign In",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "radial-gradient(ellipse 50% 40% at 50% 0%, rgba(79, 138, 255, 0.06), transparent), #07070D",
        padding: "24px",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>{children}</div>
    </div>
  );
}
