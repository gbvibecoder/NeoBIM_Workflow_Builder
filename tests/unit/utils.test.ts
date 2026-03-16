import { describe, it, expect, vi, beforeEach } from "vitest";
import { cn, formatBytes, generateId, slugify, truncate, formatRelativeTime } from "@/lib/utils";

describe("Utils — cn (class name merger)", () => {
  it("should merge simple class names", () => {
    expect(cn("px-4", "py-2")).toBe("px-4 py-2");
  });

  it("should merge and deduplicate conflicting tailwind classes", () => {
    // twMerge removes conflicting classes — last one wins
    expect(cn("px-4", "px-8")).toBe("px-8");
  });

  it("should handle conditional classes", () => {
    const isActive = true;
    const isDisabled = false;
    expect(cn("base", isActive && "active", isDisabled && "disabled")).toBe(
      "base active"
    );
  });

  it("should handle undefined and null inputs", () => {
    expect(cn("px-4", undefined, null, "py-2")).toBe("px-4 py-2");
  });

  it("should handle empty string input", () => {
    expect(cn("")).toBe("");
  });

  it("should handle no arguments", () => {
    expect(cn()).toBe("");
  });

  it("should handle array inputs", () => {
    expect(cn(["px-4", "py-2"])).toBe("px-4 py-2");
  });

  it("should handle object inputs", () => {
    expect(cn({ "px-4": true, "py-2": false })).toBe("px-4");
  });

  it("should merge text color conflicts", () => {
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("should keep non-conflicting classes", () => {
    expect(cn("text-sm", "font-bold", "mt-4")).toBe("text-sm font-bold mt-4");
  });
});

describe("Utils — formatBytes", () => {
  it("should format 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 Bytes");
  });

  it("should format bytes (< 1KB)", () => {
    expect(formatBytes(500)).toBe("500 Bytes");
  });

  it("should format exactly 1 KB", () => {
    expect(formatBytes(1024)).toBe("1 KB");
  });

  it("should format kilobytes", () => {
    expect(formatBytes(2048)).toBe("2 KB");
  });

  it("should format megabytes", () => {
    expect(formatBytes(1234567)).toBe("1.18 MB");
  });

  it("should format gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1 GB");
  });

  it("should format terabytes", () => {
    expect(formatBytes(1099511627776)).toBe("1 TB");
  });

  it("should respect custom decimal places", () => {
    expect(formatBytes(1234567, 0)).toBe("1 MB");
    expect(formatBytes(1234567, 1)).toBe("1.2 MB");
    expect(formatBytes(1234567, 3)).toBe("1.177 MB");
  });

  it("should treat negative decimals as 0", () => {
    expect(formatBytes(1234567, -1)).toBe("1 MB");
  });

  it("should handle 1 byte", () => {
    expect(formatBytes(1)).toBe("1 Bytes");
  });

  it("should handle large numbers", () => {
    const result = formatBytes(5 * 1024 * 1024 * 1024);
    expect(result).toBe("5 GB");
  });
});

describe("Utils — generateId", () => {
  it("should return a 7-character string", () => {
    const id = generateId();
    expect(id).toHaveLength(7);
  });

  it("should contain only alphanumeric characters", () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it("should generate unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    // With 36^7 possible values, 100 IDs should be unique
    expect(ids.size).toBe(100);
  });
});

describe("Utils — slugify", () => {
  it("should convert text to lowercase", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should replace spaces with hyphens", () => {
    expect(slugify("my workflow name")).toBe("my-workflow-name");
  });

  it("should remove special characters", () => {
    expect(slugify("Hello! World@2024")).toBe("hello-world2024");
  });

  it("should collapse multiple hyphens", () => {
    expect(slugify("hello---world")).toBe("hello-world");
  });

  it("should handle empty string", () => {
    expect(slugify("")).toBe("");
  });

  it("should handle whitespace-only string", () => {
    expect(slugify("   ")).toBe("");
  });

  it("should trim leading/trailing whitespace", () => {
    expect(slugify("  hello world  ")).toBe("hello-world");
  });

  it("should handle multiple consecutive spaces", () => {
    expect(slugify("hello   world")).toBe("hello-world");
  });

  it("should handle unicode characters", () => {
    // Unicode non-word chars get stripped, but letters/digits stay
    expect(slugify("cafe-design")).toBe("cafe-design");
  });

  it("should handle tabs and newlines", () => {
    expect(slugify("hello\tworld\nnew")).toBe("hello-world-new");
  });

  it("should handle already slugified text", () => {
    expect(slugify("already-slugified")).toBe("already-slugified");
  });

  it("should remove parentheses and brackets", () => {
    expect(slugify("project (v2) [final]")).toBe("project-v2-final");
  });
});

describe("Utils — truncate", () => {
  it("should return original string when shorter than maxLength", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("should return original string when exactly maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
  });

  it("should truncate and add ellipsis when longer than maxLength", () => {
    expect(truncate("hello world", 5)).toBe("hello...");
  });

  it("should handle empty string", () => {
    expect(truncate("", 5)).toBe("");
  });

  it("should handle maxLength of 0", () => {
    expect(truncate("hello", 0)).toBe("...");
  });

  it("should handle maxLength of 1", () => {
    expect(truncate("hello", 1)).toBe("h...");
  });

  it("should handle very long strings", () => {
    const long = "A".repeat(1000);
    const result = truncate(long, 50);
    expect(result).toBe("A".repeat(50) + "...");
    expect(result.length).toBe(53); // 50 + "..."
  });
});

describe("Utils — formatRelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-16T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "just now" for less than 60 seconds ago', () => {
    const date = new Date("2026-03-16T11:59:30Z"); // 30 seconds ago
    expect(formatRelativeTime(date)).toBe("just now");
  });

  it('should return "just now" for 0 seconds ago', () => {
    const date = new Date("2026-03-16T12:00:00Z");
    expect(formatRelativeTime(date)).toBe("just now");
  });

  it("should return minutes ago", () => {
    const date = new Date("2026-03-16T11:55:00Z"); // 5 minutes ago
    expect(formatRelativeTime(date)).toBe("5m ago");
  });

  it("should return 1m ago for 60-119 seconds", () => {
    const date = new Date("2026-03-16T11:59:00Z"); // 1 minute ago
    expect(formatRelativeTime(date)).toBe("1m ago");
  });

  it("should return 59m ago for 59 minutes", () => {
    const date = new Date("2026-03-16T11:01:00Z"); // 59 minutes ago
    expect(formatRelativeTime(date)).toBe("59m ago");
  });

  it("should return hours ago", () => {
    const date = new Date("2026-03-16T09:00:00Z"); // 3 hours ago
    expect(formatRelativeTime(date)).toBe("3h ago");
  });

  it("should return 1h ago for exactly 1 hour", () => {
    const date = new Date("2026-03-16T11:00:00Z");
    expect(formatRelativeTime(date)).toBe("1h ago");
  });

  it("should return days ago for 1-6 days", () => {
    const date = new Date("2026-03-14T12:00:00Z"); // 2 days ago
    expect(formatRelativeTime(date)).toBe("2d ago");
  });

  it("should return 1d ago for exactly 1 day", () => {
    const date = new Date("2026-03-15T12:00:00Z");
    expect(formatRelativeTime(date)).toBe("1d ago");
  });

  it("should return locale date string for 7+ days", () => {
    const date = new Date("2026-03-01T12:00:00Z"); // 15 days ago
    const result = formatRelativeTime(date);
    // Should be a locale date string, not "Xd ago"
    expect(result).not.toContain("d ago");
    expect(result).not.toContain("just now");
  });

  it("should return locale date string for very old dates", () => {
    const date = new Date("2025-01-01T00:00:00Z");
    const result = formatRelativeTime(date);
    expect(result).not.toContain("ago");
  });
});

// Cleanup the import of afterEach for the module scope
import { afterEach } from "vitest";
