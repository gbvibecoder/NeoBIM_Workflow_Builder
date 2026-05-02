import DOMPurify from "dompurify";

/**
 * Lightweight Markdown-to-HTML renderer for feedback descriptions.
 * Supports: **bold**, *italic*, `code`, line breaks, bullet lists.
 * Sanitised via DOMPurify (already in project deps).
 */
export function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  // Bold: **text**
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic: *text*
  html = html.replace(/\*([^*]+?)\*/g, "<em>$1</em>");
  // Inline code: `text`
  html = html.replace(/`([^`]+?)`/g, "<code>$1</code>");
  // Line breaks
  html = html.replace(/\n/g, "<br>");
  // Bullet lists: lines starting with "- "
  html = html.replace(/(?:^|<br>)- (.+?)(?=<br>|$)/g, "<br>\u2022 $1");

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["strong", "em", "code", "br"],
    ALLOWED_ATTR: [],
  });
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (c) => map[c]);
}
