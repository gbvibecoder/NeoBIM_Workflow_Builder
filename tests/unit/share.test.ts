import { describe, it, expect, vi, beforeEach } from "vitest";

// We test the URL generation logic directly since the actual functions use window.open
const SITE_URL = "https://trybuildflow.in";
const HANDLE = "@BuildFlowAI";

function buildTwitterIntentUrl(text: string): string {
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
}

function buildExecutionShareText(workflowName: string, nodeCount: number): string {
  return (
    `I just turned "${workflowName}" into a full building concept using ${HANDLE}\n\n` +
    `${nodeCount} AI steps — from text to 3D massing, renders, and cost estimates.\n\n` +
    `Try it free: ${SITE_URL}`
  );
}

function buildLinkedInShareUrl(): string {
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(SITE_URL)}`;
}

describe("Share — Twitter Intent URL", () => {
  it("should generate valid Twitter intent URL", () => {
    const url = buildTwitterIntentUrl("Hello world");
    expect(url).toContain("https://twitter.com/intent/tweet?text=");
    expect(url).toContain("Hello%20world");
  });

  it("should encode special characters in share text", () => {
    const url = buildTwitterIntentUrl('Test "quotes" & <tags> #hashtag');
    expect(url).not.toContain('"');
    expect(url).not.toContain("<");
    expect(url).not.toContain("&");
    expect(url).toContain("%22"); // encoded "
    expect(url).toContain("%26"); // encoded &
    expect(url).toContain("%3C"); // encoded <
  });

  it("should encode newlines correctly", () => {
    const url = buildTwitterIntentUrl("Line 1\nLine 2");
    expect(url).toContain("%0A");
  });

  it("should handle unicode characters", () => {
    const url = buildTwitterIntentUrl("Building in München 🏗️");
    expect(url).toContain("M%C3%BCnchen");
  });
});

describe("Share — Execution Share Text", () => {
  it("should include workflow name and node count", () => {
    const text = buildExecutionShareText("My Office", 5);
    expect(text).toContain('"My Office"');
    expect(text).toContain("5 AI steps");
    expect(text).toContain(HANDLE);
    expect(text).toContain(SITE_URL);
  });

  it("should handle empty workflow name", () => {
    const text = buildExecutionShareText("", 3);
    expect(text).toContain('""');
    expect(text).toContain("3 AI steps");
  });

  it("should handle zero node count", () => {
    const text = buildExecutionShareText("Test", 0);
    expect(text).toContain("0 AI steps");
  });
});

describe("Share — LinkedIn URL", () => {
  it("should generate valid LinkedIn share URL", () => {
    const url = buildLinkedInShareUrl();
    expect(url).toContain("linkedin.com/sharing/share-offsite/");
    expect(url).toContain(encodeURIComponent(SITE_URL));
  });
});
