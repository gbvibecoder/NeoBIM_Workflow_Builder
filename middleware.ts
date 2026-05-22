import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/lib/auth.config";
import {
  KOS_TENANT_HEADER,
  KOS_TENANT_OVERRIDE_HEADER,
  resolveTenantSlugFromHost,
} from "@/features/kos/lib/tenant-host";

// NextAuth v5 wrapped-handler pattern. `auth(callback)` runs the
// NextAuth pipeline (populates `req.auth`, evaluates `authorized()`
// from auth.config.ts) and then hands off to the callback for any
// extra middleware logic. We use that hook to layer KOS host-routing
// on top WITHOUT changing the behaviour of the existing BuildFlow
// `/dashboard|/onboard|/thank-you` protection — those routes still
// run their `authorized()` check first.
//
// IMPORTANT — edge-safety:
//   • This file runs in the edge runtime. It MUST NOT import anything
//     that pulls in Prisma. `tenant-host.ts` is the pure host parser
//     with zero runtime side effects; the DB-touching tenant-resolver
//     stays out of the import graph here.
//   • The matcher below is extended to include `/api/kos/:path*` so
//     KOS API routes also get the tenant-header injection. NextAuth's
//     `authorized()` callback only gates `/dashboard|/onboard|/thank-you`,
//     so wrapping /api/kos is a no-op for auth — the callback returns
//     `true` and the request flows through.

const { auth } = NextAuth(authConfig);

export default auth(async (req) => {
  const host = req.headers.get("host") ?? "";

  // Dev-only override so localhost requests can pretend to be on a
  // tenant subdomain without rewriting Host. The wrapped header is
  // only honoured outside production.
  const overrideHeader = req.headers.get(KOS_TENANT_OVERRIDE_HEADER);
  const isProd = process.env.NODE_ENV === "production";

  const tenantSlug =
    !isProd && overrideHeader
      ? overrideHeader
      : resolveTenantSlugFromHost(host);

  if (tenantSlug) {
    const url = req.nextUrl.clone();
    const newHeaders = new Headers(req.headers);
    newHeaders.set(KOS_TENANT_HEADER, tenantSlug);

    // Two flavours of KOS-bound request:
    //   • Page route (`/`, `/chat`, `/app`, `/bd/login`, ...) — rewrite
    //     to the `(kos)` route group internally. The browser keeps the
    //     clean `kalzen.trybuildflow.in/chat` URL; Next.js renders
    //     `src/app/(kos)/chat/page.tsx`.
    //   • API route (`/api/kos/...`) — leave the path untouched; just
    //     inject the tenant header so downstream `requireTenantOrThrow`
    //     can read it. Rewriting the path would break Next's API
    //     resolver.
    const isApiKos = url.pathname.startsWith("/api/kos");
    const isAlreadyKos = url.pathname === "/kos" || url.pathname.startsWith("/kos/");

    if (!isApiKos && !isAlreadyKos) {
      // Map `/` → `/kos`, `/foo` → `/kos/foo`. Empty path edge-case:
      // when pathname is exactly `/`, the concatenation produces
      // `/kos/` which Next happily resolves to the route-group root.
      url.pathname = url.pathname === "/" ? "/kos" : `/kos${url.pathname}`;
    }

    return NextResponse.rewrite(url, { request: { headers: newHeaders } });
  }

  // Non-KOS host: let NextAuth's default response (already computed
  // before this callback runs) carry through unchanged.
  return NextResponse.next();
});

// Matcher: keep the existing exclusions for static assets, and add
// `/api/kos/:path*` so KOS API routes get the tenant-header injection
// (the default exclusion of `/api` would otherwise skip them).
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.svg$).*)",
    "/api/kos/:path*",
  ],
};
