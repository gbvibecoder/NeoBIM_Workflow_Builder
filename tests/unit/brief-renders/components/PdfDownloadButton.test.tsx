/**
 * PdfDownloadButton — render-state tests.
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PdfDownloadButton } from "@/features/brief-renders/components/PdfDownloadButton";

describe("PdfDownloadButton", () => {
  it("renders nothing when pdfUrl is null", () => {
    const { container } = render(<PdfDownloadButton pdfUrl={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when pdfUrl is empty string", () => {
    const { container } = render(<PdfDownloadButton pdfUrl="" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders an anchor with href + download when enabled", () => {
    render(<PdfDownloadButton pdfUrl="https://r2/x.pdf" />);
    const link = screen.getByTestId("pdf-download-button") as HTMLAnchorElement;
    expect(link.tagName).toBe("A");
    expect(link.href).toBe("https://r2/x.pdf");
    expect(link.getAttribute("download")).toBe("brief-renders.pdf");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("renders a disabled button when disabled=true (no anchor)", () => {
    render(<PdfDownloadButton pdfUrl="https://r2/x.pdf" disabled />);
    expect(screen.queryByTestId("pdf-download-button")).toBeNull();
    const btn = screen.getByTestId("pdf-download-disabled");
    expect(btn.tagName).toBe("BUTTON");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("respects fileName override", () => {
    render(<PdfDownloadButton pdfUrl="https://r2/x.pdf" fileName="custom.pdf" />);
    expect(screen.getByTestId("pdf-download-button").getAttribute("download")).toBe(
      "custom.pdf",
    );
  });
});
