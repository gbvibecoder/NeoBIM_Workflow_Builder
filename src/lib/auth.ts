import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { trackLogin } from "@/lib/analytics";

// Throttle DB role lookups: refresh at most once per 60 seconds per user.
// This avoids a DB query on every single authenticated request while still
// catching subscription changes (webhook, manual fix) within ~1 minute.
const roleRefreshCache = new Map<string, number>();
const ROLE_REFRESH_INTERVAL_MS = 60_000; // 60 seconds

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, trigger }) {
      // On sign-in, populate token from user object
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        // Don't store data URLs in JWT (too large for cookies)
        token.picture = user.image?.startsWith("data:") ? "uploaded" : (user.image ?? null);
        token.role = (user as { role?: string }).role;
      }
      // Refresh role from DB so subscription changes are reflected without sign-out.
      // Throttled to once per 60s to avoid excessive DB queries. Explicit session
      // updates (trigger === "update") always bypass the throttle.
      if (token.sub) {
        const now = Date.now();
        const lastRefresh = roleRefreshCache.get(token.sub) ?? 0;
        const shouldRefresh = trigger === "update" || (now - lastRefresh) > ROLE_REFRESH_INTERVAL_MS;

        if (shouldRefresh) {
          try {
            const dbUser = await prisma.user.findUnique({
              where: { id: token.sub },
              select: trigger === "update"
                ? { role: true, name: true, image: true }
                : { role: true },
            });
            if (dbUser) {
              token.role = dbUser.role;
              if (trigger === "update") {
                token.name = (dbUser as { name?: string | null }).name;
                const img = (dbUser as { image?: string | null }).image;
                token.picture = img?.startsWith("data:") ? "uploaded" : (img ?? null);
              }
              roleRefreshCache.set(token.sub, now);
            }
          } catch {
            // Keep existing token data if DB lookup fails
          }
        }
      }
      return token;
    },
    async signIn({ user }) {
      try {
        if (user.id) {
          await trackLogin(user.id);
        }
      } catch {
        // Never block sign-in if analytics fails
      }
      return true;
    },
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: false,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const normalizedEmail = (credentials.email as string).trim().toLowerCase();

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (!user || !user.password) {
          console.warn("[auth] Failed login attempt for:", normalizedEmail);
          return null;
        }

        const passwordsMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!passwordsMatch) {
          console.warn("[auth] Invalid password for:", normalizedEmail);
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        };
      },
    }),
  ],
});
