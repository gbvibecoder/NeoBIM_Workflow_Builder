"use client";

import React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const badgeVariants = cva(
  "inline-flex items-center gap-1 font-medium select-none whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-[rgba(255,255,255,0.08)] text-[var(--text-secondary)] border border-[rgba(255,255,255,0.12)]",
        primary: "bg-[rgba(108,92,231,0.12)] text-[#A29BFE] border border-[rgba(108,92,231,0.2)]",
        success: "bg-[rgba(0,184,148,0.12)] text-[#00B894] border border-[rgba(0,184,148,0.2)]",
        danger: "bg-[rgba(255,107,107,0.12)] text-[#FF6B6B] border border-[rgba(255,107,107,0.2)]",
        warning: "bg-[rgba(253,203,110,0.12)] text-[#FDCB6E] border border-[rgba(253,203,110,0.2)]",
        copper: "bg-[rgba(184,115,51,0.12)] text-[#D4956A] border border-[rgba(184,115,51,0.2)]",
        cyan: "bg-[rgba(0,245,255,0.08)] text-[#00F5FF] border border-[rgba(0,245,255,0.15)]",
        new: "bg-[rgba(108,92,231,0.15)] text-[#A29BFE] border border-[rgba(108,92,231,0.25)]",
        beta: "bg-[rgba(0,245,255,0.1)] text-[#00F5FF] border border-[rgba(0,245,255,0.2)]",
        premium: "bg-gradient-to-r from-[#B87333]/15 to-[#FFBF00]/15 text-[#D4956A] border border-[#B87333]/20",
      },
      size: {
        xs: "text-[10px] px-1.5 py-0.5 rounded",
        sm: "text-xs px-2 py-0.5 rounded-md",
        md: "text-xs px-2.5 py-1 rounded-lg",
        lg: "text-sm px-3 py-1 rounded-lg",
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
        className: "shadow-[0_0_12px_rgba(108,92,231,0.2)]",
      },
      {
        variant: "copper",
        glow: true,
        className: "shadow-[0_0_12px_rgba(184,115,51,0.2)]",
      },
      {
        variant: "cyan",
        glow: true,
        className: "shadow-[0_0_12px_rgba(0,245,255,0.15)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      size: "sm",
      glow: false,
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({
  className,
  variant,
  size,
  glow,
  dot,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size, glow }), className)} {...props}>
      {dot && (
        <span
          className="w-1.5 h-1.5 rounded-full animate-pulse"
          style={{
            backgroundColor: "currentColor",
          }}
        />
      )}
      {children}
    </span>
  );
}

export { badgeVariants };
