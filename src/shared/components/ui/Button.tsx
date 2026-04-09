"use client";

import React, { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, type HTMLMotionProps } from "framer-motion";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  // Base styles
  [
    "relative inline-flex items-center justify-center gap-2",
    "font-medium select-none cursor-pointer",
    "transition-all duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgba(108,92,231,0.6)]",
    "disabled:pointer-events-none disabled:opacity-40",
    "overflow-hidden",
  ].join(" "),
  {
    variants: {
      variant: {
        primary: [
          "bg-[#6C5CE7] text-white",
          "hover:bg-[#5A4BD6]",
          "shadow-[0_2px_8px_rgba(108,92,231,0.3)]",
          "hover:shadow-[0_4px_16px_rgba(108,92,231,0.4)]",
        ].join(" "),
        secondary: [
          "bg-[var(--bg-elevated)] text-[var(--text-primary)]",
          "border border-[var(--border-default)]",
          "hover:bg-[var(--bg-hover)] hover:border-[var(--border-hover)]",
        ].join(" "),
        ghost: [
          "bg-transparent text-[var(--text-secondary)]",
          "hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--text-primary)]",
        ].join(" "),
        danger: [
          "bg-[#FF6B6B]/10 text-[#FF6B6B]",
          "border border-[#FF6B6B]/20",
          "hover:bg-[#FF6B6B]/20 hover:border-[#FF6B6B]/30",
        ].join(" "),
        success: [
          "bg-[#00B894] text-white",
          "hover:bg-[#00A383]",
          "shadow-[0_2px_8px_rgba(0,184,148,0.3)]",
          "hover:shadow-[0_4px_16px_rgba(0,184,148,0.4)]",
        ].join(" "),
        copper: [
          "bg-[#B87333]/10 text-[#D4956A]",
          "border border-[#B87333]/20",
          "hover:bg-[#B87333]/20 hover:border-[#B87333]/30",
        ].join(" "),
        outline: [
          "bg-transparent text-[var(--text-primary)]",
          "border border-[rgba(255,255,255,0.1)]",
          "hover:border-[rgba(108,92,231,0.4)] hover:bg-[rgba(108,92,231,0.06)]",
        ].join(" "),
      },
      size: {
        sm: "h-8 px-3 text-xs rounded-lg",
        md: "h-9 px-4 text-sm rounded-lg",
        lg: "h-11 px-6 text-sm rounded-xl",
        xl: "h-12 px-8 text-base rounded-xl font-semibold",
        icon: "h-9 w-9 rounded-lg",
        "icon-sm": "h-7 w-7 rounded-md",
        "icon-lg": "h-11 w-11 rounded-xl",
      },
      glow: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "primary",
        glow: true,
        className: "glow-pulse-primary",
      },
      {
        variant: "copper",
        glow: true,
        className: "glow-pulse-copper",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "md",
      glow: false,
    },
  }
);

export interface ButtonProps
  extends Omit<HTMLMotionProps<"button">, "children">,
    VariantProps<typeof buttonVariants> {
  children?: React.ReactNode;
  shimmer?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, glow, shimmer, children, ...props }, ref) => {
    return (
      <motion.button
        ref={ref}
        className={cn(buttonVariants({ variant, size, glow }), className)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        {...props}
      >
        {children}
        {shimmer && (
          <span
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)",
              animation: "cta-shimmer 2.5s ease-in-out infinite",
            }}
          />
        )}
      </motion.button>
    );
  }
);

Button.displayName = "Button";

export { buttonVariants };
