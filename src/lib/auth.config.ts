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
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      if (token.role && session.user) {
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
    jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
      }
      return token;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
