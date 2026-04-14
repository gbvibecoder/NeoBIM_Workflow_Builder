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
      const isProtected = isDashboard
        || nextUrl.pathname.startsWith("/thank-you");
      if (isProtected) return isLoggedIn;
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).emailVerified = !!token.emailVerified;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).phoneNumber = (token.phoneNumber as string) ?? null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (session.user as any).phoneVerified = !!token.phoneVerified;
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
        token.emailVerified = !!(user as { emailVerified?: Date | null }).emailVerified;
        token.phoneNumber = (user as { phoneNumber?: string | null }).phoneNumber ?? null;
        token.phoneVerified = !!(user as { phoneVerified?: Date | null }).phoneVerified;
      }
      return token;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
