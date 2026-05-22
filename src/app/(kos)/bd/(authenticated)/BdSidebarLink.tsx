"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function BdSidebarLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const pathname = usePathname();
  // Active when exact match OR (for non-root) pathname starts with href.
  const isActive =
    pathname === href ||
    (href !== "/bd" && pathname?.startsWith(href + "/"));

  return (
    <Link
      href={href}
      style={{
        display: "block",
        padding: "8px 12px",
        borderRadius: 8,
        fontSize: 13,
        fontWeight: isActive ? 700 : 500,
        color: isActive ? "var(--kos-secondary, #c9a55a)" : "#fafafa",
        textDecoration: "none",
        background: isActive ? "rgba(201,165,90,0.08)" : "transparent",
        border: isActive
          ? "1px solid rgba(201,165,90,0.25)"
          : "1px solid transparent",
      }}
    >
      {label}
    </Link>
  );
}
