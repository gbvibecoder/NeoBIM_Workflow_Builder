import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { authConfig } from "@/lib/auth.config";
import { trackLogin } from "@/lib/analytics";
import { normalizePhone } from "@/lib/form-validation";

// Throttle DB role lookups: refresh at most once per 60 seconds per user.
// This avoids a DB query on every single authenticated request while still
// catching subscription changes (webhook, manual fix) within ~1 minute.
// Bounded to 10,000 entries to prevent unbounded memory growth.
const MAX_ROLE_CACHE_SIZE = 10_000;
const roleRefreshCache = new Map<string, number>();
const ROLE_REFRESH_INTERVAL_MS = 60_000; // 60 seconds

/** Evict oldest entries when the cache exceeds MAX_ROLE_CACHE_SIZE.
 *  Map iteration order is insertion order, so the first entries are oldest. */
function roleRefreshCacheSet(userId: string, timestamp: number) {
  roleRefreshCache.set(userId, timestamp);
  if (roleRefreshCache.size > MAX_ROLE_CACHE_SIZE) {
    // Delete the oldest 20% to avoid evicting on every insert
    const deleteCount = Math.floor(MAX_ROLE_CACHE_SIZE * 0.2);
    let deleted = 0;
    for (const key of roleRefreshCache.keys()) {
      if (deleted >= deleteCount) break;
      roleRefreshCache.delete(key);
      deleted++;
    }
  }
}

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
        // Google OAuth users have emailVerified set by the adapter automatically
        token.emailVerified = !!(user as { emailVerified?: Date | null }).emailVerified;
        token.phoneNumber = (user as { phoneNumber?: string | null }).phoneNumber ?? null;
        token.phoneVerified = !!(user as { phoneVerified?: Date | null }).phoneVerified;
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
                ? { role: true, name: true, image: true, email: true, emailVerified: true, phoneNumber: true, phoneVerified: true }
                : { role: true, email: true, emailVerified: true, phoneNumber: true, phoneVerified: true },
            });
            if (dbUser) {
              token.role = dbUser.role;
              token.email = (dbUser as { email?: string }).email;
              token.emailVerified = !!dbUser.emailVerified;
              token.phoneNumber = (dbUser as { phoneNumber?: string | null }).phoneNumber ?? null;
              token.phoneVerified = !!(dbUser as { phoneVerified?: Date | null }).phoneVerified;
              if (trigger === "update") {
                token.name = (dbUser as { name?: string | null }).name;
                const img = (dbUser as { image?: string | null }).image;
                token.picture = img?.startsWith("data:") ? "uploaded" : (img ?? null);
              }
              roleRefreshCacheSet(token.sub, now);
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
        phone: { label: "Phone", type: "tel" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        // Dev-friendly tag so the dev terminal shows which case fired on every
        // login attempt. Helps diagnose the canonical "I can't login" cases
        // without having to add ad-hoc logging each time:
        //   no-password-given / no-identifier / phone-bad-format / user-not-found
        //   / no-password-on-account (Google-only) / password-mismatch / ok
        const tag = (reason: string, detail?: string) =>
          console.warn(`[auth] credentials reject — ${reason}${detail ? ` :: ${detail}` : ""}`);

        if (!credentials?.password) {
          tag("no-password-given");
          return null;
        }

        const email = credentials.email as string | undefined;
        const phone = credentials.phone as string | undefined;

        if (!email && !phone) {
          tag("no-identifier");
          return null;
        }

        let user;

        if (phone) {
          const normalizedPhone = normalizePhone(phone);
          if (!normalizedPhone) {
            tag("phone-bad-format", String(phone));
            return null;
          }
          user = await prisma.user.findUnique({
            where: { phoneNumber: normalizedPhone },
          });
          if (!user) {
            tag("user-not-found", `phone=${normalizedPhone}`);
            return null;
          }
          if (!user.password) {
            tag("no-password-on-account", `phone=${normalizedPhone} — likely Google-only account; use 'Continue with Google' instead`);
            return null;
          }
        } else {
          const normalizedEmail = (email as string).trim().toLowerCase();
          user = await prisma.user.findUnique({
            where: { email: normalizedEmail },
          });
          if (!user) {
            tag("user-not-found", `email=${normalizedEmail}`);
            return null;
          }
          if (!user.password) {
            tag("no-password-on-account", `email=${normalizedEmail} — likely Google-only account; use 'Continue with Google' instead`);
            return null;
          }
        }

        const passwordsMatch = await bcrypt.compare(
          credentials.password as string,
          user.password
        );

        if (!passwordsMatch) {
          tag("password-mismatch", `id=${user.id} email=${user.email ?? "-"} phone=${user.phoneNumber ?? "-"}`);
          return null;
        }

        console.log(`[auth] credentials OK — id=${user.id} email=${user.email ?? "-"} role=${user.role}`);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
          emailVerified: user.emailVerified,
          phoneNumber: user.phoneNumber,
          phoneVerified: user.phoneVerified,
        };
      },
    }),
  ],
});
