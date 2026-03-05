"use client";

import { useState, useEffect } from "react";
import { X, Zap, Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";

interface UpgradeModalProps {
  isOpen: boolean;
  onClose: () => void;
  usedRuns?: number;
  limitRuns?: number;
  resetHours?: number;
}

export function UpgradeModal({
  isOpen,
  onClose,
  usedRuns = 3,
  limitRuns = 3,
  resetHours = 24,
}: UpgradeModalProps) {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
          />

          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", duration: 0.3 }}
              className="relative w-full max-w-2xl rounded-[20px] border border-[rgba(255,255,255,0.1)] bg-[#12121E] shadow-2xl overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Gradient background effects */}
              <div className="absolute top-0 left-0 w-full h-full pointer-events-none overflow-hidden">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#4F8AFF] opacity-10 rounded-full blur-3xl" />
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#8B5CF6] opacity-10 rounded-full blur-3xl" />
              </div>

              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-10 w-8 h-8 rounded-lg flex items-center justify-center bg-[#1A1A2A] border border-[rgba(255,255,255,0.06)] text-[#9898B0] hover:text-[#F0F0F5] hover:border-[rgba(255,255,255,0.12)] transition-all"
              >
                <X size={16} />
              </button>

              <div className="relative p-8">
                {/* Icon */}
                <div className="flex justify-center mb-6">
                  <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#EF4444] to-[#F59E0B] flex items-center justify-center shadow-lg">
                    <Zap size={32} className="text-white" fill="white" />
                  </div>
                </div>

                {/* Title & Message */}
                <div className="text-center mb-8">
                  <h2 className="text-2xl font-bold text-[#F0F0F5] mb-3">
                    You've Reached Your Daily Limit
                  </h2>
                  <p className="text-[#C0C0D0] text-base mb-2">
                    You've used all <strong className="text-[#F0F0F5]">{usedRuns}/{limitRuns}</strong> free workflow runs today.
                  </p>
                  <p className="text-[#9898B0] text-sm">
                    Resets in {resetHours} hours • Upgrade to Pro for unlimited runs
                  </p>
                </div>

                {/* Hackathon Badge */}
                <div className="mb-6 p-4 rounded-[14px] border border-[#F59E0B33] bg-gradient-to-r from-[#F59E0B15] to-[#EF444415] flex items-center gap-3">
                  <Sparkles size={20} className="text-[#F59E0B] flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-[#F0F0F5]">🏆 Hackathon Special</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-[#F59E0B] text-white text-[10px] font-bold">
                        50% OFF
                      </span>
                    </div>
                    <p className="text-xs text-[#C0C0D0]">
                      First 100 users get 50% off Pro for 6 months!
                    </p>
                  </div>
                </div>

                {/* Pro Features */}
                <div className="mb-6 p-5 rounded-[14px] border border-[#4F8AFF33] bg-gradient-to-br from-[#4F8AFF08] to-transparent">
                  <div className="flex items-center gap-2 mb-4">
                    <Zap size={18} className="text-[#4F8AFF]" />
                    <h3 className="text-lg font-bold text-[#F0F0F5]">Upgrade to Pro</h3>
                    <span className="text-2xl font-bold text-[#4F8AFF]">$79/mo</span>
                  </div>

                  <ul className="space-y-2.5">
                    {[
                      "Unlimited workflow runs",
                      "Priority execution queue",
                      "Advanced AI models",
                      "Priority support",
                      "API access",
                    ].map((feature, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm">
                        <Check size={16} className="text-[#10B981] mt-0.5 flex-shrink-0" />
                        <span className="text-[#C0C0D0]">{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[#1A1A2A] text-[#F0F0F5] font-semibold text-sm hover:bg-[#2A2A3E] hover:border-[rgba(255,255,255,0.12)] transition-all"
                  >
                    Maybe Later
                  </button>
                  <Link
                    href="/dashboard/billing"
                    onClick={onClose}
                    className="flex-[2] py-3 rounded-lg bg-gradient-to-r from-[#4F8AFF] to-[#8B5CF6] text-white font-bold text-sm text-center hover:opacity-90 transition-opacity shadow-lg"
                  >
                    Upgrade to Pro →
                  </Link>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
