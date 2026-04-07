"use client";

import React, { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, type HTMLMotionProps } from "framer-motion";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const glassPanelVariants = cva(
  [
    "relative",
    "backdrop-blur-[20px] backdrop-saturate-[1.4]",
    "border border-[rgba(255,255,255,0.06)]",
    "transition-all duration-200",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-[rgba(13,15,17,0.7)]",
        heavy: "bg-[rgba(10,12,14,0.85)] backdrop-blur-[24px]",
        light: "bg-[rgba(18,20,24,0.5)] backdrop-blur-[16px]",
        sidebar: "bg-[rgba(10,12,14,0.9)] backdrop-blur-[24px] backdrop-saturate-[1.6]",
      },
      rounded: {
        none: "rounded-none",
        sm: "rounded-lg",
        md: "rounded-xl",
        lg: "rounded-2xl",
        xl: "rounded-3xl",
        full: "rounded-full",
      },
      padding: {
        none: "p-0",
        sm: "p-3",
        md: "p-5",
        lg: "p-6",
        xl: "p-8",
      },
      border: {
        subtle: "border-[rgba(255,255,255,0.06)]",
        default: "border-[rgba(255,255,255,0.1)]",
        glow: "border-[rgba(108,92,231,0.2)]",
        copper: "border-[rgba(184,115,51,0.15)]",
        none: "border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
      rounded: "lg",
      padding: "md",
      border: "subtle",
    },
  }
);

export interface GlassPanelProps
  extends Omit<HTMLMotionProps<"div">, "children">,
    VariantProps<typeof glassPanelVariants> {
  children?: React.ReactNode;
}

export const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  ({ className, variant, rounded, padding, border, children, ...props }, ref) => {
    return (
      <motion.div
        ref={ref}
        className={cn(
          glassPanelVariants({ variant, rounded, padding, border }),
          className
        )}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

GlassPanel.displayName = "GlassPanel";

export { glassPanelVariants };
