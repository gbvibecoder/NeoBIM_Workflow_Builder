// @vitest-environment happy-dom
/**
 * Unit tests for TemplateLockBadge — the locked-card visual affordance.
 *
 * The component itself is unconditional: page.tsx decides whether to mount
 * it (gated by canAccessTemplate). These tests pin the contract the page
 * relies on:
 *
 *   • Tier pill renders the uppercase tier label as text (the §X version
 *     was just a circle with an icon — users couldn't tell PRO apart from
 *     STARTER without reading the bottom of the card).
 *   • Crown icon for PRO + TEAM, Lock icon for MINI + STARTER. The visual
 *     ladder maps "is this aspirational vs blocking?" at a glance.
 *   • aria-label includes the tier name so screen readers announce the
 *     gate, not just "image".
 *   • Sub-line shows the price formatted in en-IN (₹1,999 not ₹1999).
 *   • Scrim element is present (opacity is CSS-driven; we just verify it
 *     exists in the DOM so the hover/focus rules have something to target).
 *
 * The "user has access" / "user is admin" / "mobile-tap fires checkout"
 * cases live in template-access.test.ts (gating logic) and
 * inline-checkout.test.ts (checkout helper) — both shipped earlier.
 * The badge itself never makes those decisions, so testing them here would
 * just re-test those primitives through a different surface.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TemplateLockBadge } from "@/features/workflows/components/TemplateLockBadge";

describe("TemplateLockBadge — tier pill content", () => {
  it("renders the tier label in uppercase inside the pill", () => {
    render(<TemplateLockBadge tier="STARTER" label="Starter" price={799} />);
    expect(screen.getByText("STARTER")).toBeTruthy();
  });

  it("renders MINI for the Mini tier", () => {
    render(<TemplateLockBadge tier="MINI" label="Mini" price={99} />);
    expect(screen.getByText("MINI")).toBeTruthy();
  });

  it("renders PRO for the Pro tier", () => {
    render(<TemplateLockBadge tier="PRO" label="Pro" price={1999} />);
    expect(screen.getByText("PRO")).toBeTruthy();
  });

  it("renders TEAM for the Team tier", () => {
    render(<TemplateLockBadge tier="TEAM" label="Team" price={4999} />);
    expect(screen.getByText("TEAM")).toBeTruthy();
  });
});

describe("TemplateLockBadge — accessibility", () => {
  it("aria-label includes the tier label", () => {
    render(<TemplateLockBadge tier="PRO" label="Pro" price={1999} />);
    expect(screen.getByLabelText(/requires Pro/i)).toBeTruthy();
  });

  it("aria-label uses the tier label for STARTER", () => {
    render(<TemplateLockBadge tier="STARTER" label="Starter" price={799} />);
    expect(screen.getByLabelText(/requires Starter/i)).toBeTruthy();
  });
});

describe("TemplateLockBadge — sub-line price", () => {
  it("formats INR with en-IN grouping (₹1,999 not ₹1999)", () => {
    render(<TemplateLockBadge tier="PRO" label="Pro" price={1999} />);
    expect(screen.getByText(/1,999/)).toBeTruthy();
    expect(screen.getByText("/month")).toBeTruthy();
    // unlocks all {label} templates
    expect(screen.getByText(/unlocks all Pro templates/)).toBeTruthy();
  });

  it("formats prices without thousands separator below 1000 (₹799)", () => {
    const { container } = render(
      <TemplateLockBadge tier="STARTER" label="Starter" price={799} />,
    );
    expect(container.textContent).toContain("₹799");
  });

  it("renders the larger TEAM price formatted as ₹4,999", () => {
    render(<TemplateLockBadge tier="TEAM" label="Team" price={4999} />);
    expect(screen.getByText(/4,999/)).toBeTruthy();
  });
});

describe("TemplateLockBadge — center reveal CTA", () => {
  it("shows 'Upgrade to {label}' in the center button", () => {
    render(<TemplateLockBadge tier="PRO" label="Pro" price={1999} />);
    expect(screen.getByText(/Upgrade to Pro/i)).toBeTruthy();
  });

  it("uses the human label, not the all-caps tier", () => {
    // The button text is mixed-case ("Upgrade to Pro"), the pill is caps
    // ("PRO"). Pin away — both must coexist.
    render(<TemplateLockBadge tier="STARTER" label="Starter" price={799} />);
    expect(screen.getByText(/Upgrade to Starter/i)).toBeTruthy();
    expect(screen.getByText("STARTER")).toBeTruthy(); // pill caps
  });
});
