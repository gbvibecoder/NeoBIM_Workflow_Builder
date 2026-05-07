"""Phase 2A Slice 2A.3 — PDF text extraction.

Public entry point: :func:`extract_pdf_text`. Accepts a local file path
or a URL (``http://``, ``https://``, or ``file://``) and returns
``(extracted_text, list[ExtractionWarning])``. The extractor:

1. Resolves the input to a byte stream (``urllib`` for ``http(s)``,
   plain file open otherwise).
2. Tries to parse with ``pypdf.PdfReader``. Encrypted, malformed, or
   un-openable PDFs return an empty string with a single structured
   warning (``MALFORMED_PDF`` / ``PASSWORD_PROTECTED``) — never raise
   to the caller, so the route handler can surface a partial result
   instead of a 500.
3. Iterates pages, extracts text, and concatenates with
   ``=== Page N ===`` markers (1-based to match how a user would
   describe pages out loud).
4. Computes the average chars-per-page over pages that produced any
   text. If the average is below :data:`_VISION_TRIGGER_AVG_CHARS`
   (100), the PDF is image-heavy and a ``VISION_REQUIRED`` warning is
   raised. Slice 2A.3 ships :func:`vision_extract_pdf` as a stub that
   raises ``NotImplementedError`` — the real Claude Vision call wires
   in Slice 2A.4 when the LLM client lands.
5. Per-page failures are tolerated: the surviving text is returned
   with a ``PARTIAL_EXTRACTION`` warning naming the failed page.

Layering rules (mirrors Phase 1)
--------------------------------
* This module imports only stdlib + ``pypdf`` + ``app.services.design_agent.types``.
* No LLM client, no Anthropic SDK. Vision extraction is a forward
  reference: when called, it raises ``NotImplementedError``. Slice
  2A.4 adds a Vision-capable implementation by importing the LLM
  client and rebinding :func:`vision_extract_pdf`.
"""

from __future__ import annotations

import io
import logging
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Optional

import pypdf
import pypdf.errors

from app.services.design_agent.types import ExtractionWarning


log = logging.getLogger(__name__)


# ─── Tunable thresholds ───────────────────────────────────────────────


# Average chars per non-blank page below which we declare the PDF
# image-heavy and require a Vision-capable LLM call. 100 chars is a
# rough lower bound on a meaningful paragraph; below that, what little
# text was extracted is almost certainly just headers / page numbers
# with the architectural content trapped in raster drawings.
_VISION_TRIGGER_AVG_CHARS: int = 100

# A single page must produce > this many chars to count as
# "non-empty" for the average-chars-per-page calculation.
_NON_EMPTY_PAGE_MIN_CHARS: int = 1


# ─── Vision extraction stub (Slice 2A.4 swaps the body) ──────────────


class VisionExtractionUnavailableError(NotImplementedError):
    """Raised when an image-based PDF needs Vision but the LLM client
    is not yet wired in.

    Slice 2A.3 raises this on the image-only path; Slice 2A.4 replaces
    :func:`vision_extract_pdf` with a real Claude Vision implementation,
    at which point this exception class is no longer raised in
    production. We keep the class defined here so the symbol is
    importable for tests + future fallbacks.
    """


def vision_extract_pdf(pdf_bytes: bytes) -> tuple[str, list[ExtractionWarning]]:
    """Vision-fallback PDF extractor — STUB until Slice 2A.4.

    When Slice 2A.4 (LLM client) lands, this function will base64-
    encode the PDF and pass it to ``Claude Opus 4.7`` via the
    Anthropic SDK's ``document`` content block, ask it to transcribe
    the architectural content (drawings labels, dimensions, room
    annotations) into structured prose, and return the result.

    For Slice 2A.3 we raise a clear, structured error so the route
    handler can surface "this brief contains drawings; the AI needs
    Vision to read them — please retry once Slice 2A.4 ships" rather
    than silently returning an empty string.
    """
    raise VisionExtractionUnavailableError(
        "Vision extraction requires LLM client (Slice 2A.4). "
        "The PDF is image-heavy (avg < 100 chars/page) so pypdf alone "
        "cannot recover its architectural content."
    )


# ─── URL / path resolution ────────────────────────────────────────────


def _looks_like_url(s: str) -> bool:
    """Return True for ``http://``, ``https://``, or ``file://``."""
    parsed = urllib.parse.urlparse(s)
    return parsed.scheme in ("http", "https", "file")


def _read_pdf_bytes(pdf_path_or_url: str) -> tuple[bytes, list[ExtractionWarning]]:
    """Resolve the input to PDF bytes. Returns (bytes, warnings).

    On unrecoverable I/O errors (network failure, missing file, decode
    error) returns ``(b"", [warning])`` — never raises — so callers can
    surface a structured warning rather than a 500.
    """
    if _looks_like_url(pdf_path_or_url):
        try:
            with urllib.request.urlopen(pdf_path_or_url, timeout=30) as resp:
                return resp.read(), []
        except (urllib.error.URLError, TimeoutError) as exc:
            return b"", [
                ExtractionWarning(
                    code="MALFORMED_PDF",
                    message=(
                        f"Failed to fetch PDF from URL {pdf_path_or_url}: "
                        f"{type(exc).__name__}: {exc}"
                    ),
                )
            ]
    # Local path
    p = Path(pdf_path_or_url)
    if not p.exists():
        return b"", [
            ExtractionWarning(
                code="MALFORMED_PDF",
                message=f"PDF file not found at path: {pdf_path_or_url}",
            )
        ]
    try:
        return p.read_bytes(), []
    except OSError as exc:
        return b"", [
            ExtractionWarning(
                code="MALFORMED_PDF",
                message=(
                    f"OS error reading PDF at {pdf_path_or_url}: "
                    f"{type(exc).__name__}: {exc}"
                ),
            )
        ]


# ─── Page-level extraction ────────────────────────────────────────────


def _extract_page(
    page: pypdf.PageObject, page_index: int
) -> tuple[Optional[str], Optional[ExtractionWarning]]:
    """Extract text from one page. Returns (text_or_none, warning_or_none).

    A page returning zero chars yields an EMPTY_PAGE warning with no
    text; a page that crashes pypdf yields a PARTIAL_EXTRACTION warning
    with no text; a page with text that also has substantial raster
    content (heuristic: image XObjects on the page resources) carries
    a MIXED_CONTENT warning alongside its text so the caller knows the
    extraction may understate the page's actual content.
    """
    try:
        text = page.extract_text() or ""
    except Exception as exc:  # pypdf can raise from many internals
        log.warning(
            "pdf_page_extract_failed",
            extra={"page_index": page_index, "error": str(exc)},
        )
        return None, ExtractionWarning(
            code="PARTIAL_EXTRACTION",
            page_index=page_index,
            message=(
                f"page {page_index} raised {type(exc).__name__} during "
                f"text extraction: {exc}"
            ),
        )

    if len(text.strip()) < _NON_EMPTY_PAGE_MIN_CHARS:
        return text, ExtractionWarning(
            code="EMPTY_PAGE",
            page_index=page_index,
            message=f"page {page_index} produced no extractable text",
        )

    # Mixed-content heuristic: page declares image XObjects in its
    # resource dictionary alongside text. We do not attempt to parse
    # the image content here; the warning is purely informational.
    if _page_has_images(page):
        return text, ExtractionWarning(
            code="MIXED_CONTENT",
            page_index=page_index,
            message=(
                f"page {page_index} has both extracted text and raster "
                f"image XObjects; text alone may understate the brief's "
                f"actual content"
            ),
        )
    return text, None


def _page_has_images(page: pypdf.PageObject) -> bool:
    """Return True if the page's resources reference at least one image XObject.

    Tolerant of malformed resource dictionaries — any AttributeError /
    KeyError / TypeError lands on False (no images detected) rather
    than propagating, so a quirky PDF doesn't cause the whole
    extraction to fail just because we wanted to flag mixed content.
    """
    try:
        resources = page.get("/Resources")
        if resources is None:
            return False
        xobjects = resources.get("/XObject")
        if xobjects is None:
            return False
        for _name, xobj in xobjects.items():
            obj = xobj.get_object() if hasattr(xobj, "get_object") else xobj
            if obj.get("/Subtype") == "/Image":
                return True
    except (AttributeError, KeyError, TypeError):
        return False
    return False


# ─── Main entry point ────────────────────────────────────────────────


def extract_pdf_text(
    pdf_path_or_url: str,
) -> tuple[str, list[ExtractionWarning]]:
    """Extract text from a PDF. Returns (text, warnings).

    Never raises on extraction failure — every failure mode (malformed
    PDF, password-protected PDF, image-only PDF, per-page crashes)
    produces a structured :class:`ExtractionWarning` and a possibly-
    empty text result. The route handler decides how to surface
    warnings to the user.

    Pages are concatenated with ``=== Page N ===`` markers (1-based).
    Empty pages still contribute a marker so downstream consumers can
    refer to specific pages by number.

    Vision-required PDFs (image-heavy, avg < 100 chars/page) trigger
    a single ``VISION_REQUIRED`` warning. Slice 2A.3 stops there;
    Slice 2A.4 will optionally retry through :func:`vision_extract_pdf`
    when the LLM client is available.
    """
    pdf_bytes, io_warnings = _read_pdf_bytes(pdf_path_or_url)
    if not pdf_bytes:
        return "", io_warnings

    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    except (
        pypdf.errors.PdfReadError,
        pypdf.errors.EmptyFileError,
        ValueError,
    ) as exc:
        return "", [
            ExtractionWarning(
                code="MALFORMED_PDF",
                message=(
                    f"pypdf failed to parse PDF: {type(exc).__name__}: {exc}"
                ),
            )
        ]

    if reader.is_encrypted:
        return "", [
            ExtractionWarning(
                code="PASSWORD_PROTECTED",
                message=(
                    "PDF is encrypted / password-protected; the design "
                    "agent does not attempt to decrypt. Re-upload an "
                    "unprotected version."
                ),
            )
        ]

    if len(reader.pages) == 0:
        return "", [
            ExtractionWarning(
                code="MALFORMED_PDF",
                message="PDF has zero pages",
            )
        ]

    warnings: list[ExtractionWarning] = []
    page_texts: list[str] = []
    non_empty_chars: list[int] = []

    for idx, page in enumerate(reader.pages):
        text, warning = _extract_page(page, idx)
        if warning is not None:
            warnings.append(warning)
        if text is None:
            page_texts.append(f"=== Page {idx + 1} ===\n[extraction failed]")
            continue
        page_texts.append(f"=== Page {idx + 1} ===\n{text.strip()}")
        if len(text.strip()) >= _NON_EMPTY_PAGE_MIN_CHARS:
            non_empty_chars.append(len(text.strip()))

    combined = "\n\n".join(page_texts)

    # Vision trigger: average across non-empty pages, OR every page
    # was empty. If every page was empty, the PDF is almost certainly
    # image-only.
    if not non_empty_chars:
        warnings.append(
            ExtractionWarning(
                code="VISION_REQUIRED",
                message=(
                    f"All {len(reader.pages)} pages produced no extractable "
                    f"text. The PDF is image-only; Vision-capable LLM "
                    f"extraction (Slice 2A.4) is required to recover "
                    f"its content."
                ),
            )
        )
    else:
        avg = sum(non_empty_chars) / len(non_empty_chars)
        if avg < _VISION_TRIGGER_AVG_CHARS:
            warnings.append(
                ExtractionWarning(
                    code="VISION_REQUIRED",
                    message=(
                        f"Average {avg:.1f} chars per non-empty page (over "
                        f"{len(non_empty_chars)} pages) is below the "
                        f"{_VISION_TRIGGER_AVG_CHARS}-char vision threshold; "
                        f"the PDF is image-heavy. Vision-capable LLM "
                        f"extraction (Slice 2A.4) is required to recover "
                        f"its content."
                    ),
                )
            )

    return combined, warnings


__all__ = [
    "extract_pdf_text",
    "vision_extract_pdf",
    "VisionExtractionUnavailableError",
]
