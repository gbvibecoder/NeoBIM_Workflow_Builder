"use client";

import { motion, AnimatePresence } from "framer-motion";

interface ViewerSkeletonProps {
  visible: boolean;
  progress: number;
  message: string;
}

/**
 * Blueprint-style loading overlay shown during WASM init + IFC parse,
 * before geometry mounts. Fades out when model load completes.
 */
export function ViewerSkeleton({ visible, progress, message }: ViewerSkeletonProps) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="viewer-skeleton"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 16,
            background: "#07070D",
            pointerEvents: "none",
          }}
        >
          {/* Animated grid lines — blueprint feel */}
          <svg
            width="120"
            height="120"
            viewBox="0 0 120 120"
            fill="none"
            style={{ opacity: 0.6 }}
          >
            {/* Building outline — draws on */}
            <motion.rect
              x="20" y="40" width="80" height="60"
              stroke="#0D9488"
              strokeWidth="1.5"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, ease: "easeInOut", repeat: Infinity }}
            />
            {/* Roof */}
            <motion.path
              d="M15 40 L60 15 L105 40"
              stroke="#00F5FF"
              strokeWidth="1.5"
              fill="none"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 2, ease: "easeInOut", repeat: Infinity, delay: 0.3 }}
            />
            {/* Floor lines */}
            <motion.line
              x1="20" y1="65" x2="100" y2="65"
              stroke="#0D9488"
              strokeWidth="0.8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity, delay: 0.6 }}
            />
            <motion.line
              x1="20" y1="80" x2="100" y2="80"
              stroke="#0D9488"
              strokeWidth="0.8"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.5, ease: "easeInOut", repeat: Infinity, delay: 0.9 }}
            />
            {/* Windows */}
            <motion.rect
              x="30" y="45" width="12" height="15"
              stroke="#00F5FF"
              strokeWidth="0.8"
              fill="none"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.6, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 1.2 }}
            />
            <motion.rect
              x="55" y="45" width="12" height="15"
              stroke="#00F5FF"
              strokeWidth="0.8"
              fill="none"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.6, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 1.5 }}
            />
            <motion.rect
              x="80" y="45" width="12" height="15"
              stroke="#00F5FF"
              strokeWidth="0.8"
              fill="none"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.6, 0] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: 1.8 }}
            />
          </svg>

          {/* Progress text */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 500,
                color: "#E2E8F0",
                letterSpacing: "0.04em",
              }}
            >
              {message || "Loading model..."}
            </span>

            {/* Progress bar */}
            <div
              style={{
                width: 160,
                height: 2,
                borderRadius: 1,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
              }}
            >
              <motion.div
                style={{
                  height: "100%",
                  borderRadius: 1,
                  background: "linear-gradient(90deg, #0D9488, #00F5FF)",
                }}
                animate={{ width: `${Math.round(Math.max(progress, 2))}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>

            <span
              style={{
                fontSize: 10,
                color: "rgba(255,255,255,0.3)",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
              }}
            >
              Preparing 3D viewer
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
