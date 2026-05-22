"use client";

/**
 * Renders one bot turn: GitHub-flavoured markdown with inline `[N]`
 * citation chips, followed by a collapsible "Sources" disclosure that
 * lives at the bottom of the bot bubble.
 *
 * Citation injection (the tricky bit), two layers:
 *
 *  1. **Escape markers before parsing.** CommonMark treats `[1]` as a
 *     potential link/reference label — and if the answer also contains a
 *     line that looks like a link-reference definition (`[1]: …`), every
 *     inline `[1]` silently turns into an <a> (or vanishes), so the chip
 *     logic never sees it. We pre-escape every `[N]` *outside* code spans
 *     to `\[N\]`, which forces CommonMark to emit a literal "[N]" text
 *     node. Code spans/blocks are left untouched so `[0]` etc. stay
 *     verbatim there.
 *  2. **Walk + swap in the renderers.** We override every block-level
 *     element that can contain inline text (p, li, td, th, h1-h6,
 *     blockquote) and recursively walk their children — so markers nested
 *     inside <strong>/<em>/<a>, adjacent to punctuation, or at line ends
 *     all get caught. The walk is idempotent (already-swapped chips and
 *     marker-free strings pass through untouched).
 *
 * The `[N]` → citation mapping is reconstructed with `buildCitationIndex`
 * from the ORIGINAL (un-escaped) text, mirroring the backend's
 * marker-ordering so chip N maps to the source the server intended.
 */

import {
  cloneElement,
  createElement,
  Fragment,
  isValidElement,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { CitationMarker, openSourceTab } from "./CitationMarker";
import { buildCitationIndex } from "@/features/kos/lib/kos-citations";
import type { KosCitation } from "@/features/kos/types/chat";

const MARKER_SPLIT_RE = /(\[\d+\])/g;
const MARKER_EXACT_RE = /^\[(\d+)\]$/;
// Fenced code blocks OR inline code spans — used to skip escaping inside code.
const CODE_SEGMENT_RE = /(```[\s\S]*?```|`[^`\n]*`)/g;
// A citation marker NOT immediately followed by `(` or `[` (i.e. not a real
// inline link `[1](url)` or reference link `[1][ref]`).
const ESCAPE_MARKER_RE = /\[(\d+)\](?![([])/g;

type Resolver = (n: number) => KosCitation | undefined;

/**
 * Escape `[N]` → `\[N\]` everywhere except inside code, so markdown can't
 * reinterpret citation markers as links/reference definitions.
 */
function escapeCitationsOutsideCode(md: string): string {
  return md
    .split(CODE_SEGMENT_RE)
    .map((segment, i) =>
      // Odd indices are the captured code segments — leave verbatim.
      i % 2 === 1 ? segment : segment.replace(ESCAPE_MARKER_RE, "\\[$1\\]"),
    )
    .join("");
}

/** Element types whose text we must NOT rewrite (code keeps `[1]` literal). */
function isCodeElement(el: ReactElement): boolean {
  return el.type === "code" || el.type === "pre";
}

function renderWithCitations(
  children: ReactNode,
  resolve: Resolver,
): ReactNode {
  if (typeof children === "string") {
    if (!children.includes("[")) return children;
    const parts = children.split(MARKER_SPLIT_RE);
    return parts.map((part, i) => {
      const match = part.match(MARKER_EXACT_RE);
      if (match) {
        const n = Number.parseInt(match[1], 10);
        // Only 1-indexed markers are citations; "[0]" stays literal text.
        if (n >= 1) {
          return (
            <CitationMarker
              key={`c-${i}-${n}`}
              number={n}
              citation={resolve(n)}
            />
          );
        }
      }
      return part ? <Fragment key={`t-${i}`}>{part}</Fragment> : null;
    });
  }

  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <Fragment key={`f-${i}`}>{renderWithCitations(child, resolve)}</Fragment>
    ));
  }

  if (isValidElement(children)) {
    const el = children as ReactElement<{ children?: ReactNode }>;
    if (isCodeElement(el) || el.props.children == null) return children;
    return cloneElement(
      el,
      undefined,
      renderWithCitations(el.props.children, resolve),
    );
  }

  return children;
}

function buildMarkdownComponents(resolve: Resolver): Components {
  const withCitations = (tag: keyof React.JSX.IntrinsicElements) => {
    const Cited = ({ children }: { children?: ReactNode }) =>
      createElement(tag, null, renderWithCitations(children, resolve));
    Cited.displayName = `Cited(${tag})`;
    return Cited;
  };

  return {
    // Every block-level container of inline text — recursion handles
    // nested <strong>/<em>/<code> inside these.
    p: withCitations("p"),
    li: withCitations("li"),
    td: withCitations("td"),
    th: withCitations("th"),
    blockquote: withCitations("blockquote"),
    h1: withCitations("h3"),
    h2: withCitations("h3"),
    h3: withCitations("h4"),
    h4: withCitations("h4"),
    h5: withCitations("h5"),
    h6: withCitations("h6"),
    // Author-supplied links: open in a new tab, and still scan the link
    // text for markers (cheap + idempotent).
    a: ({ href, children }) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "var(--kos-secondary, #c9a55a)",
          textDecoration: "underline",
        }}
      >
        {renderWithCitations(children, resolve)}
      </a>
    ),
  };
}

export function BotMessage({
  content,
  citations,
}: {
  content: string;
  citations?: KosCitation[];
}) {
  // Index from the ORIGINAL text (markers intact); render from the
  // escaped text (markers forced to literal nodes).
  const resolve = useMemo<Resolver>(() => {
    const index = buildCitationIndex(content, citations ?? []);
    return (n: number) => index.get(n);
  }, [content, citations]);

  const renderSource = useMemo(
    () => escapeCitationsOutsideCode(content),
    [content],
  );

  const components = useMemo(
    () => buildMarkdownComponents(resolve),
    [resolve],
  );

  const sourceCount = citations?.length ?? 0;

  return (
    <div
      className="kos-bot-markdown"
      style={{ fontSize: 14.5, lineHeight: 1.6 }}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {renderSource}
      </ReactMarkdown>

      {sourceCount > 0 && (
        <details
          style={{
            marginTop: 14,
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: 12,
          }}
        >
          <summary
            aria-label={`View ${sourceCount} source${sourceCount === 1 ? "" : "s"}`}
            style={{
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--kos-secondary, #c9a55a)",
              userSelect: "none",
              listStyle: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span aria-hidden style={{ fontSize: 11 }}>▸</span>
            View {sourceCount} source{sourceCount === 1 ? "" : "s"}
          </summary>
          <ol
            style={{
              margin: "12px 0 0",
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {(citations ?? []).map((c, i) => (
              <li key={c.chunkId || `${c.documentId}-${i}`}>
                <button
                  type="button"
                  onClick={() => openSourceTab(c)}
                  aria-label={`Open source: ${c.title}${c.pageNum ? `, page ${c.pageNum}` : ""}`}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    display: "block",
                    padding: "9px 11px",
                    borderRadius: 9,
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(255,255,255,0.03)",
                    color: "#e8e8e8",
                    cursor: "pointer",
                    transition:
                      "background 120ms ease, border-color 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(201,165,90,0.1)";
                    e.currentTarget.style.borderColor = "rgba(201,165,90,0.35)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span
                      style={{
                        color: "var(--kos-secondary, #c9a55a)",
                        fontWeight: 700,
                        fontFamily: "var(--font-jetbrains), monospace",
                        fontSize: 12,
                      }}
                    >
                      {`[${i + 1}]`}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>
                      {c.title}
                    </span>
                    {c.pageNum != null && (
                      <span style={{ fontSize: 11, opacity: 0.6 }}>
                        page {c.pageNum}
                      </span>
                    )}
                    <span
                      aria-hidden
                      style={{
                        marginLeft: "auto",
                        fontSize: 11,
                        color: "var(--kos-secondary, #c9a55a)",
                        opacity: 0.7,
                      }}
                    >
                      Open ↗
                    </span>
                  </span>
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      fontSize: 12,
                      lineHeight: 1.5,
                      opacity: 0.7,
                    }}
                  >
                    {c.snippet}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
