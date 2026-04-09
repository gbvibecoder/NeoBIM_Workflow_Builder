"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";

const dotVariants = {
  initial: { y: 0 },
  animate: { y: [0, -6, 0] },
};

export function TypingIndicator() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "#1A1A2E",
          borderRadius: 16,
          padding: "10px 16px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 3,
            marginRight: 8,
          }}
        >
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              variants={dotVariants}
              initial="initial"
              animate={prefersReducedMotion ? "initial" : "animate"}
              transition={{
                duration: 0.6,
                repeat: Infinity,
                repeatDelay: 0.2,
                delay: i * 0.15,
                ease: "easeInOut",
              }}
              style={{
                display: "block",
                width: 6,
                height: 6,
                borderRadius: "50%",
                backgroundColor: "#4F8AFF",
              }}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 12,
            color: "#6B7280",
            fontStyle: "italic",
          }}
        >
          BuildFlow AI is thinking...
        </span>
      </div>
    </div>
  );
}
