"use client";

import { motion } from "framer-motion";
import { ArrowLeft, Mail, BookOpen, PenTool, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Metadata is exported from a separate file or handled via layout   */
/*  Since this is a client component, we set the title via <title>    */
/* ------------------------------------------------------------------ */

/* ---------- floating‑particle canvas ---------- */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId: number;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }

    const particles: Particle[] = Array.from({ length: 50 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      size: Math.random() * 2 + 0.5,
      opacity: Math.random() * 0.4 + 0.1,
    }));

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(99,102,241,${p.opacity})`;
        ctx.fill();
      }
      animationId = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-0"
      aria-hidden
    />
  );
}

/* ---------- blueprint grid bg ---------- */
function BlueprintGrid() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.07]"
      aria-hidden
      style={{
        backgroundImage: `
          linear-gradient(rgba(99,102,241,0.5) 1px, transparent 1px),
          linear-gradient(90deg, rgba(99,102,241,0.5) 1px, transparent 1px)
        `,
        backgroundSize: "60px 60px",
      }}
    />
  );
}

/* ---------- floating topic cards ---------- */
const topics = [
  { icon: BookOpen, label: "BIM Workflows" },
  { icon: PenTool, label: "AEC Innovation" },
  { icon: Sparkles, label: "AI in Architecture" },
];

/* ---------- main page ---------- */
export default function BlogComingSoon() {
  return (
    <>
      <title>Blog - Coming Soon | NeoBIM</title>
      <meta
        name="description"
        content="The NeoBIM blog is coming soon. AI in architecture, BIM workflows, and the future of AEC."
      />

      <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#07070D] text-white">
        {/* backgrounds */}
        <BlueprintGrid />
        <ParticleCanvas />

        {/* radial glow */}
        <div
          className="pointer-events-none fixed inset-0 z-0"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(99,102,241,0.08) 0%, transparent 70%)",
          }}
        />

        {/* content */}
        <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-col items-center px-6 py-20 text-center">
          {/* back link */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
            className="mb-12 self-start"
          >
            <Link
              href="/"
              className="group inline-flex items-center gap-2 text-sm text-zinc-400 transition-colors hover:text-white"
            >
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              Back to Home
            </Link>
          </motion.div>

          {/* badge */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <span className="inline-flex items-center gap-2 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs font-medium tracking-wide text-indigo-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
              </span>
              Coming Soon
            </span>
          </motion.div>

          {/* title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15 }}
            className="mt-6 bg-gradient-to-b from-white to-zinc-400 bg-clip-text text-5xl font-bold tracking-tight text-transparent sm:text-6xl"
          >
            Blog
          </motion.h1>

          {/* description */}
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="mt-6 max-w-lg text-lg leading-relaxed text-zinc-400"
          >
            We&apos;re writing about AI in architecture, BIM workflows, and the
            future of AEC. Stay tuned.
          </motion.p>

          {/* topic pills */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.45 }}
            className="mt-8 flex flex-wrap justify-center gap-3"
          >
            {topics.map(({ icon: Icon, label }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.55 + i * 0.1 }}
                className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-4 py-2 text-sm text-zinc-300 backdrop-blur-sm"
              >
                <Icon className="h-4 w-4 text-indigo-400" />
                {label}
              </motion.div>
            ))}
          </motion.div>

          {/* divider */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="my-12 h-px w-full max-w-xs bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent"
          />

          {/* newsletter signup */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.8 }}
            className="w-full max-w-md"
          >
            <h2 className="text-sm font-medium text-zinc-300">
              Get notified when we publish
            </h2>

            <form
              action="#"
              onSubmit={(e) => e.preventDefault()}
              className="mt-4 flex gap-2"
            >
              <div className="relative flex-1">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
                <input
                  type="email"
                  placeholder="you@company.com"
                  className="h-11 w-full rounded-lg border border-white/[0.08] bg-white/[0.04] pl-10 pr-4 text-sm text-white placeholder-zinc-500 outline-none ring-indigo-500/40 transition focus:border-indigo-500/50 focus:ring-2"
                />
              </div>
              <button
                type="submit"
                className="h-11 shrink-0 rounded-lg bg-indigo-600 px-5 text-sm font-medium text-white transition hover:bg-indigo-500 active:scale-[0.97]"
              >
                Subscribe
              </button>
            </form>

            <p className="mt-3 text-xs text-zinc-500">
              No spam. Unsubscribe anytime.
            </p>
          </motion.div>
        </div>

        {/* bottom fade */}
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-0 h-32"
          aria-hidden
          style={{
            background:
              "linear-gradient(to top, #07070D 0%, transparent 100%)",
          }}
        />
      </div>
    </>
  );
}
