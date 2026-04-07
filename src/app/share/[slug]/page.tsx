import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import Link from "next/link";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || "https://trybuildflow.in";

interface Props {
  params: Promise<{ slug: string }>;
}

// ─── OG / Twitter metadata so the link unfurls nicely on Slack/X/LinkedIn ──
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const link = await prisma.videoShareLink.findUnique({
    where: { slug },
    select: { title: true, videoUrl: true, expiresAt: true },
  });

  const nowMs = new Date().getTime();
  if (!link || (link.expiresAt && link.expiresAt.getTime() < nowMs)) {
    return { title: "Walkthrough Not Found — BuildFlow" };
  }

  const title = link.title ? `${link.title} — BuildFlow Walkthrough` : "3D Walkthrough — BuildFlow";
  const description = "Watch this AI-generated cinematic 3D walkthrough produced with BuildFlow.";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: `${SITE_URL}/share/${slug}`,
      siteName: "BuildFlow",
      type: "video.other",
      videos: [{ url: link.videoUrl, width: 1280, height: 720, type: "video/mp4" }],
    },
    twitter: {
      card: "player",
      title,
      description,
      players: [{ playerUrl: link.videoUrl, streamUrl: link.videoUrl, width: 1280, height: 720 }],
      creator: "@BuildFlowAI",
    },
  };
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params;

  const link = await prisma.videoShareLink.findUnique({
    where: { slug },
    select: {
      slug: true,
      title: true,
      videoUrl: true,
      expiresAt: true,
      viewCount: true,
      createdAt: true,
    },
  });

  if (!link) notFound();
  const nowMs = new Date().getTime();
  if (link.expiresAt && link.expiresAt.getTime() < nowMs) notFound();

  // Best-effort view count increment — never block render on failure.
  // (No await — fire-and-forget so a slow DB write doesn't slow page load.)
  prisma.videoShareLink
    .update({ where: { slug }, data: { viewCount: { increment: 1 } } })
    .catch(() => {
      /* swallow — analytics, not critical */
    });

  const headerTitle = link.title || "3D Walkthrough";
  const createdDate = new Date(link.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(145deg, #07070D 0%, #0B0B13 100%)",
        color: "#F0F0F5",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ─── Header ─── */}
      <header
        style={{
          padding: "20px 32px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            textDecoration: "none",
            color: "#F0F0F5",
            fontSize: 16,
            fontWeight: 700,
            letterSpacing: "-0.01em",
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #8B5CF6, #6366F1)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 800,
              color: "#fff",
            }}
          >
            B
          </span>
          BuildFlow
        </Link>
        <div style={{ fontSize: 11, color: "#5C5C78", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Shared {createdDate} · {link.viewCount + 1} {link.viewCount === 0 ? "view" : "views"}
        </div>
      </header>

      {/* ─── Main video stage ─── */}
      <main
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "32px clamp(16px, 4vw, 48px)",
          gap: 24,
        }}
      >
        <h1
          style={{
            fontSize: "clamp(20px, 3vw, 28px)",
            fontWeight: 700,
            margin: 0,
            letterSpacing: "-0.02em",
            textAlign: "center",
            maxWidth: 900,
          }}
        >
          {headerTitle}
        </h1>

        <div
          style={{
            width: "100%",
            maxWidth: 1200,
            borderRadius: 16,
            overflow: "hidden",
            background: "#000",
            boxShadow: "0 20px 80px rgba(139,92,246,0.18), 0 0 0 1px rgba(255,255,255,0.05)",
          }}
        >
          <video
            controls
            autoPlay
            muted
            playsInline
            crossOrigin="anonymous"
            src={link.videoUrl}
            style={{
              width: "100%",
              maxHeight: "78vh",
              display: "block",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
          <a
            href={link.videoUrl}
            download
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 18px",
              borderRadius: 10,
              background: "linear-gradient(135deg, #8B5CF6 0%, #6366F1 100%)",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 4px 20px rgba(139,92,246,0.35)",
            }}
          >
            Download MP4
          </a>
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "10px 18px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.12)",
              color: "#F0F0F5",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Make your own with BuildFlow
          </Link>
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer
        style={{
          padding: "20px 32px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          textAlign: "center",
          fontSize: 11,
          color: "#5C5C78",
        }}
      >
        Generated with BuildFlow · AI-powered architectural walkthroughs
      </footer>
    </div>
  );
}
