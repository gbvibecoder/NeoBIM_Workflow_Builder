/**
 * Enhanced API client with automatic error handling
 * Provides user-friendly error messages for all API calls
 */

import { toast } from "sonner";

export interface APIError {
  title: string;
  message: string;
  code: string;
  action?: string;
  actionUrl?: string;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: APIError;
}

/**
 * Enhanced fetch with automatic error handling
 */
export async function apiCall<T = any>(
  endpoint: string,
  options?: RequestInit
): Promise<APIResponse<T>> {
  try {
    // Check if online
    if (!navigator.onLine) {
      const offlineError = {
        title: "You're offline",
        message: "No internet connection. Please connect and try again.",
        code: "NET_003",
      };
      toast.error(offlineError.title, { description: offlineError.message });
      return { success: false, error: offlineError };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

    try {
      const response = await fetch(endpoint, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });

      clearTimeout(timeoutId);

      // Handle successful response
      if (response.ok) {
        const data = await response.json();
        return { success: true, data };
      }

      // Handle error response
      const errorData = await response.json().catch(() => ({
        error: {
          title: "Request failed",
          message: `Server returned ${response.status}`,
          code: "HTTP_" + response.status,
        },
      }));

      const error: APIError = errorData.error || {
        title: "Request failed",
        message: "An unexpected error occurred",
        code: "UNKNOWN",
      };

      // Show toast for errors (except 401 which handles redirect)
      if (response.status !== 401) {
        toast.error(error.title, {
          description: error.message,
          duration: 6000,
          action: error.action && error.actionUrl
            ? {
                label: error.action,
                onClick: () => (window.location.href = error.actionUrl!),
              }
            : undefined,
        });
      }

      return { success: false, error };
    } catch (fetchError: any) {
      clearTimeout(timeoutId);

      // Handle timeout
      if (fetchError.name === "AbortError") {
        const timeoutError = {
          title: "Request timed out",
          message: "The request took too long. Please try again.",
          code: "NET_002",
        };
        toast.error(timeoutError.title, { description: timeoutError.message });
        return { success: false, error: timeoutError };
      }

      throw fetchError;
    }
  } catch (error: any) {
    // Handle network errors
    const networkError = {
      title: "Connection failed",
      message: "Unable to reach the server. Please check your connection and try again.",
      code: "NET_001",
    };
    toast.error(networkError.title, { description: networkError.message });
    return { success: false, error: networkError };
  }
}

/**
 * Convenience methods for common HTTP verbs
 */
export const api = {
  get: <T = any>(endpoint: string, options?: RequestInit) =>
    apiCall<T>(endpoint, { ...options, method: "GET" }),

  post: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiCall<T>(endpoint, {
      ...options,
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
    }),

  put: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiCall<T>(endpoint, {
      ...options,
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
    }),

  delete: <T = any>(endpoint: string, options?: RequestInit) =>
    apiCall<T>(endpoint, { ...options, method: "DELETE" }),

  patch: <T = any>(endpoint: string, body?: any, options?: RequestInit) =>
    apiCall<T>(endpoint, {
      ...options,
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
    }),
};

/**
 * Example usage:
 * 
 * const result = await api.post("/api/workflows", { name: "My Workflow" });
 * if (result.success) {
 *   console.log("Created:", result.data);
 * } else {
 *   // Error toast already shown automatically
 *   console.error("Error:", result.error);
 * }
 */
