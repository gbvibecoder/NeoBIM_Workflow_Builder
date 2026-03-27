"use client";

import React, { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallbackLabel?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class FloorPlanErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[FloorPlan] ${this.props.fallbackLabel ?? "Component"} error:`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 6V10M10 14H10.01" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="10" cy="10" r="8" stroke="#EF4444" strokeWidth="1.5"/>
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-700">
              {this.props.fallbackLabel ?? "Component"} encountered an error
            </p>
            <p className="mt-1 text-[10px] text-gray-400">
              {this.state.error?.message ?? "Unknown error"}
            </p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition-colors"
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
