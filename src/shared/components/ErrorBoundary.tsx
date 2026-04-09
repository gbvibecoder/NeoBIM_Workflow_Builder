"use client";

import React from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RotateCcw, Home, MessageSquare } from "lucide-react";
import Link from "next/link";
import { t as translate, getLocaleFromStorage } from "@/lib/i18n";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showHomeButton?: boolean;
  showSupportButton?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.setState({ errorInfo });

    Sentry.captureException(error, {
      extra: {
        componentStack: errorInfo.componentStack,
      },
    });
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    // Force a re-render of the component tree
    window.location.reload();
  };

  copyError = () => {
    const errorText = `Error: ${this.state.error?.message}\n\nStack: ${this.state.error?.stack}\n\nComponent Stack: ${this.state.errorInfo?.componentStack}`;
    navigator.clipboard.writeText(errorText);
    
    // Show toast (if available)
    if (typeof window !== "undefined" && (window as unknown as Record<string, unknown>).toast) {
      ((window as unknown as Record<string, { success: (msg: string) => void }>).toast).success("Error details copied to clipboard");
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const isDev = process.env.NODE_ENV === "development";
    const { showHomeButton = true, showSupportButton = false } = this.props;
    const locale = typeof window !== 'undefined' ? getLocaleFromStorage() : 'en';

    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 320,
          gap: 20,
          padding: 32,
          background: "#0A0A0F",
          color: "#F0F0F5",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: "rgba(239,68,68,0.1)",
            border: "1.5px solid rgba(239,68,68,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#EF4444",
          }}
        >
          <AlertTriangle size={24} strokeWidth={1.5} />
        </div>

        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 10, color: "#F0F0F5" }}>
            {translate('errorBoundary.title', locale)}
          </h2>
          <p style={{ fontSize: 14, color: "#9898B0", lineHeight: 1.6, marginBottom: 6 }}>
            {this.state.error?.message || translate('errorBoundary.fallbackDesc', locale)}
          </p>
          
          {isDev && this.state.error?.stack && (
            <details style={{ 
              marginTop: 16, 
              padding: 12, 
              background: "rgba(255,255,255,0.03)",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              textAlign: "left",
              fontSize: 11,
              fontFamily: "monospace",
              color: "#F87171",
              maxWidth: 500,
              overflow: "auto",
            }}>
              <summary style={{ cursor: "pointer", marginBottom: 8, fontWeight: 600 }}>
                {translate('errorBoundary.stackTrace', locale)}
              </summary>
              <pre style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
        </div>

        <div style={{ 
          display: "flex", 
          flexDirection: "column", 
          gap: 10, 
          alignItems: "center",
          width: "100%",
          maxWidth: 320,
        }}>
          {/* Primary action: Try again */}
          <button
            onClick={this.reset}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 20px",
              borderRadius: 8,
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
              border: "none",
              color: "#fff",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 2px 8px rgba(79,138,255,0.2)",
            }}
          >
            <RotateCcw size={14} strokeWidth={2} />
            {translate('errorBoundary.reload', locale)}
          </button>

          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            {/* Home button */}
            {showHomeButton && (
              <Link
                href="/dashboard"
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "9px 16px",
                  borderRadius: 8,
                  background: "rgba(79,138,255,0.08)",
                  border: "1px solid rgba(79,138,255,0.25)",
                  color: "#4F8AFF",
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: "none",
                  cursor: "pointer",
                }}
              >
                <Home size={13} strokeWidth={1.5} />
                {translate('errorBoundary.goHome', locale)}
              </Link>
            )}

            {/* Support button */}
            {showSupportButton && (
              <button
                onClick={this.copyError}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "9px 16px",
                  borderRadius: 8,
                  background: "rgba(79,138,255,0.08)",
                  border: "1px solid rgba(79,138,255,0.25)",
                  color: "#4F8AFF",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <MessageSquare size={13} strokeWidth={1.5} />
                {translate('errorBoundary.copyError', locale)}
              </button>
            )}
          </div>
        </div>

        <p style={{ 
          fontSize: 12, 
          color: "#3A3A50", 
          marginTop: 8,
          textAlign: "center",
        }}>
          {translate('errorBoundary.supportMsg', locale)}
        </p>
      </div>
    );
  }
}
