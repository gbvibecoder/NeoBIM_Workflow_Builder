"use client";

import React, { forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, type HTMLMotionProps } from "framer-motion";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const cardVariants = cva(
  [
    "relative rounded-2xl",
    "transition-all duration-200",
    "overflow-hidden",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-[var(--bg-card)]",
          "border border-[var(--border-subtle)]",
        ].join(" "),
        elevated: [
          "bg-[var(--bg-elevated)]",
          "border border-[var(--border-subtle)]",
          "shadow-[var(--shadow-md)]",
        ].join(" "),
        glass: [
          "glass-panel",
        ].join(" "),
        outline: [
          "bg-transparent",
          "border border-[rgba(255,255,255,0.08)]",
        ].join(" "),
        gradient: [
          "bg-[var(--bg-card)]",
          "gradient-border-card",
        ].join(" "),
      },
      hover: {
        lift: "hover-lift",
        glow: "",
        tilt: "tilt-card",
        shimmer: "card-shimmer",
        none: "",
      },
      padding: {
        none: "p-0",
        sm: "p-3",
        md: "p-5",
        lg: "p-6",
        xl: "p-8",
      },
    },
    compoundVariants: [
      {
        hover: "glow",
        className:
          "hover:border-[rgba(108,92,231,0.3)] hover:shadow-[0_0_32px_rgba(108,92,231,0.1)]",
      },
    ],
    defaultVariants: {
      variant: "default",
      hover: "none",
      padding: "md",
    },
  }
);

export interface CardProps
  extends Omit<HTMLMotionProps<"div">, "children">,
    VariantProps<typeof cardVariants> {
  children?: React.ReactNode;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, hover, padding, children, ...props }, ref) => {
    const easeOutExpo: [number, number, number, number] = [0.16, 1, 0.3, 1];
    const motionProps =
      hover === "lift"
        ? {
            whileHover: {
              y: -4,
              transition: { duration: 0.2, ease: easeOutExpo },
            },
          }
        : hover === "tilt"
        ? {
            whileHover: {
              y: -8,
              rotateX: 2,
              rotateY: -2,
              transition: { duration: 0.3, ease: easeOutExpo },
            },
            style: {
              transformStyle: "preserve-3d" as const,
              perspective: 1000,
            },
          }
        : {};

    return (
      <motion.div
        ref={ref}
        className={cn(cardVariants({ variant, hover, padding }), className)}
        {...motionProps}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = "Card";

// ── Card sub-components ─────────────────────────────────────────────

export function CardHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5 pb-4", className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h3
      className={cn(
        "font-[var(--font-space-grotesk)] text-base font-bold text-[var(--text-primary)]",
        className
      )}
    >
      {children}
    </h3>
  );
}

export function CardDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p
      className={cn("text-sm text-[var(--text-secondary)]", className)}
    >
      {children}
    </p>
  );
}

export function CardContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("", className)}>{children}</div>;
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 pt-4 border-t border-[var(--border-subtle)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export { cardVariants };
