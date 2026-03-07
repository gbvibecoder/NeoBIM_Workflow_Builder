import type { NextAuthConfig } from "next-auth";

// Lightweight config — no DB imports, safe for edge middleware
export const authConfig = {
  // Accept both NextAuth v4 (NEXTAUTH_SECRET) and v5 (AUTH_SECRET) naming
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const isDashboard = nextUrl.pathname.startsWith("/dashboard");
      if (isDashboard) return isLoggedIn;
      return true;
    },
    session({ session, token }) {
      if (session.user) {
        // Explicitly set ALL user fields from token — never rely on defaults
        session.user.id = token.sub as string;
        session.user.email = token.email as string;
        session.user.name = (token.name as string) ?? null;
        session.user.image = (token.picture as string) ?? null;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
    jwt({ token, user }) {
      if (user) {
        // Force-overwrite token on every sign-in to prevent stale data
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.picture = user.image;
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
