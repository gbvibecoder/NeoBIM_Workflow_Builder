"use client";

import React, { forwardRef, useState } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { motion, AnimatePresence } from "framer-motion";

function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const inputVariants = cva(
  [
    "w-full bg-[var(--bg-surface)] text-[var(--text-primary)]",
    "border transition-all duration-200",
    "placeholder:text-[var(--text-disabled)]",
    "disabled:opacity-40 disabled:pointer-events-none",
    "focus:outline-none",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "border-[var(--border-subtle)]",
          "focus:border-[rgba(108,92,231,0.5)]",
          "focus:shadow-[0_0_0_3px_rgba(108,92,231,0.1)]",
        ].join(" "),
        ghost: [
          "bg-transparent border-transparent",
          "focus:bg-[rgba(255,255,255,0.03)]",
          "focus:border-[rgba(108,92,231,0.3)]",
        ].join(" "),
        error: [
          "border-[rgba(255,107,107,0.5)]",
          "focus:border-[rgba(255,107,107,0.7)]",
          "focus:shadow-[0_0_0_3px_rgba(255,107,107,0.1)]",
        ].join(" "),
      },
      inputSize: {
        sm: "h-8 px-3 text-xs rounded-lg",
        md: "h-10 px-4 text-sm rounded-xl",
        lg: "h-12 px-5 text-base rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      inputSize: "md",
    },
  }
);

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  label?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      variant,
      inputSize,
      label,
      error,
      leftIcon,
      rightIcon,
      onFocus,
      onBlur,
      ...props
    },
    ref
  ) => {
    const [focused, setFocused] = useState(false);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <motion.label
            className="text-xs font-medium text-[var(--text-secondary)]"
            animate={{
              color: focused
                ? "#A29BFE"
                : "var(--text-secondary)",
            }}
            transition={{ duration: 0.15 }}
          >
            {label}
          </motion.label>
        )}
        <div className="relative">
          {leftIcon && (
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]">
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            className={cn(
              inputVariants({ variant: error ? "error" : variant, inputSize }),
              leftIcon ? "pl-10" : undefined,
              rightIcon ? "pr-10" : undefined,
              className
            )}
            onFocus={(e) => {
              setFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setFocused(false);
              onBlur?.(e);
            }}
            {...props}
          />
          {rightIcon && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]">
              {rightIcon}
            </div>
          )}
        </div>
        <AnimatePresence>
          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              className="text-xs text-[#FF6B6B]"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    );
  }
);

Input.displayName = "Input";

export { inputVariants };
