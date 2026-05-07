"""Phase 2A Slice 2A.3 — PDF extractor tests.

Covers :func:`extract_pdf_text` against PDFs we author at test time
with reportlab + pypdf. Each test creates a disposable PDF in
``tmp_path``, calls the extractor, and asserts on the returned
``(text, warnings)`` tuple. Plus the sentinel test verifying all 7
sample-brief fixtures exist on disk so the BriefAnalyst /
ProgramArchitect stages (Slices 2A.5 / 2A.6) have stable filenames to
read against once Govind drops in real content.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import pypdf
from reportlab.pdfgen import canvas

from app.services.design_agent import (
    ExtractionWarning,
    ExtractionWarningCode,
    extract_pdf_text,
)
from app.services.design_agent.pdf_extractor import (
    VisionExtractionUnavailableError,
    vision_extract_pdf,
)


# ─── Helpers ──────────────────────────────────────────────────────────


def _make_text_pdf(out_path: Path, pages: list[str]) -> Path:
    """Author a tiny test PDF with the given page contents.

    Each page renders the given text at a fixed location. The text
    body is intentionally chosen long enough (~150 chars) so the
    average-chars-per-page heuristic does NOT trip ``VISION_REQUIRED``
    on text PDFs.
    """
    c = canvas.Canvas(str(out_path))
    for body in pages:
        # Wrap to ~80 chars per drawn line so reportlab does not clip
        for i, line in enumerate(_split_lines(body, 80)):
            c.drawString(72, 800 - i * 14, line)
        c.showPage()
    c.save()
    return out_path


def _split_lines(text: str, width: int) -> list[str]:
    out: list[str] = []
    for paragraph in text.splitlines():
        while len(paragraph) > width:
            out.append(paragraph[:width])
            paragraph = paragraph[width:]
        out.append(paragraph)
    return out


def _make_blank_pdf(out_path: Path, num_pages: int = 1) -> Path:
    """Author an image-only-equivalent PDF — pages with no text content."""
    writer = pypdf.PdfWriter()
    for _ in range(num_pages):
        writer.add_blank_page(width=612, height=792)
    with out_path.open("wb") as f:
        writer.write(f)
    return out_path


def _make_malformed_pdf(out_path: Path) -> Path:
    out_path.write_bytes(b"this is not a PDF")
    return out_path


# ─── Tests ────────────────────────────────────────────────────────────


def test_extract_text_pdf_single_page(tmp_path: Path) -> None:
    """A 1-page text PDF returns its text with the page-1 marker."""
    body = (
        "This is a 2BHK design brief for a 24x50 plot in Pune. "
        "The user wants a master bedroom and a separate kitchen. "
        "RCC frame, vastu compliant layout, modern aesthetic."
    )
    pdf = _make_text_pdf(tmp_path / "single.pdf", [body])
    text, warnings = extract_pdf_text(str(pdf))
    assert "=== Page 1 ===" in text
    assert "2BHK" in text
    assert "Pune" in text
    # No vision warning on a text-rich page
    assert not any(w.code == "VISION_REQUIRED" for w in warnings), warnings


def test_extract_multipage_pdf_concatenates_with_markers(tmp_path: Path) -> None:
    """A 3-page PDF concatenates with 1-based page markers."""
    pages = [
        "Page one content with at least one hundred characters of substantive design brief content for verification.",
        "Page two content describing the second floor program with an extensive paragraph of building details.",
        "Page three content covering services and finishes with several sentences of architectural detail content.",
    ]
    pdf = _make_text_pdf(tmp_path / "multi.pdf", pages)
    text, warnings = extract_pdf_text(str(pdf))
    assert "=== Page 1 ===" in text
    assert "=== Page 2 ===" in text
    assert "=== Page 3 ===" in text
    assert text.index("=== Page 1 ===") < text.index("=== Page 2 ===") < text.index("=== Page 3 ===")
    assert not any(w.code == "VISION_REQUIRED" for w in warnings)


def test_extract_blank_pdf_triggers_vision_required(tmp_path: Path) -> None:
    """An all-blank-page PDF fires VISION_REQUIRED + EMPTY_PAGE warnings."""
    pdf = _make_blank_pdf(tmp_path / "blank.pdf", num_pages=2)
    text, warnings = extract_pdf_text(str(pdf))
    codes = [w.code for w in warnings]
    assert "VISION_REQUIRED" in codes
    # Each blank page also gets its own EMPTY_PAGE warning
    assert codes.count("EMPTY_PAGE") == 2


def test_extract_malformed_pdf_returns_warning(tmp_path: Path) -> None:
    """Garbage bytes → MALFORMED_PDF warning, never raise."""
    pdf = _make_malformed_pdf(tmp_path / "bad.pdf")
    text, warnings = extract_pdf_text(str(pdf))
    assert text == ""
    assert len(warnings) == 1
    assert warnings[0].code == "MALFORMED_PDF"


def test_extract_missing_file_returns_malformed_warning(tmp_path: Path) -> None:
    """Path to non-existent file → MALFORMED_PDF, no exception."""
    text, warnings = extract_pdf_text(str(tmp_path / "no_such_file.pdf"))
    assert text == ""
    assert any(w.code == "MALFORMED_PDF" for w in warnings)


def test_extract_file_url_treated_as_local_path(tmp_path: Path) -> None:
    """``file://`` URL routes through the URL fetch but reads a local file."""
    pdf = _make_text_pdf(
        tmp_path / "fileurl.pdf",
        ["File URL routing test with adequate text content for the extraction heuristics to be happy with the sample size."],
    )
    file_url = pdf.as_uri()  # file:// URL
    assert file_url.startswith("file://")
    text, warnings = extract_pdf_text(file_url)
    assert "File URL" in text
    assert not any(w.code == "MALFORMED_PDF" for w in warnings)


def test_extract_low_avg_chars_triggers_vision_required(tmp_path: Path) -> None:
    """Avg chars/page < 100 → VISION_REQUIRED.

    A page with fewer than 100 chars falls below the heuristic's
    threshold; this simulates the floor-plan-only PDF whose text
    layer carries only sparse labels.
    """
    pdf = _make_text_pdf(tmp_path / "tiny.pdf", ["A"])  # 1 char
    text, warnings = extract_pdf_text(str(pdf))
    codes = [w.code for w in warnings]
    assert "VISION_REQUIRED" in codes


def test_vision_extract_pdf_stub_raises_unavailable() -> None:
    """The stub in Slice 2A.3 must clearly signal Slice 2A.4 ownership."""
    with pytest.raises(VisionExtractionUnavailableError) as exc:
        vision_extract_pdf(b"%PDF-1.4 fake")
    assert "Slice 2A.4" in str(exc.value)


def test_extraction_warning_schema_immutable() -> None:
    """ExtractionWarning is frozen and validates code literals."""
    w = ExtractionWarning(code="EMPTY_PAGE", page_index=2, message="x")
    assert w.code == "EMPTY_PAGE"
    assert w.page_index == 2
    # Frozen
    from pydantic import ValidationError as _VE
    with pytest.raises(_VE):
        w.message = "y"  # type: ignore[misc]
    # Bad code rejected
    with pytest.raises(_VE):
        ExtractionWarning(code="UNKNOWN_CODE", message="x")  # type: ignore[arg-type]


def test_extraction_warning_codes_match_schema_literal() -> None:
    """Every documented warning code in the extractor maps to the Literal."""
    from typing import get_args
    declared = set(get_args(ExtractionWarningCode))
    expected = {
        "EMPTY_PAGE", "VISION_REQUIRED", "MALFORMED_PDF",
        "PASSWORD_PROTECTED", "MIXED_CONTENT", "PARTIAL_EXTRACTION",
    }
    assert declared == expected, (
        f"ExtractionWarningCode literal drift: declared={declared}, "
        f"expected={expected}"
    )


# ─── Sample brief fixtures sentinel ───────────────────────────────────


def test_all_sample_brief_fixtures_exist() -> None:
    """All 7 fixture files named in the Slice 2A.3 spec exist on disk.

    Content tests (assertions on extracted brief / room program) run
    in Slices 2A.5 / 2A.6 once Govind authors the real briefs. Slice
    2A.3 only pins the filenames so the later slices' tests can
    reference stable paths.
    """
    fixtures_dir = (
        Path(__file__).parent / "fixtures" / "sample_briefs"
    )
    assert fixtures_dir.is_dir(), f"missing fixture dir: {fixtures_dir}"
    expected = {
        "2bhk_24x50.pdf",
        "circular_futuristic.txt",
        "g_plus_5_apartment_form.json",
        "4_storey_office_curtainwall.txt",
        "bungalow_gable.txt",
        "warehouse.txt",
        "hospital_3floor.txt",
    }
    actual_files = {p.name for p in fixtures_dir.iterdir()}
    missing = expected - actual_files
    assert not missing, f"missing fixtures: {sorted(missing)}"


# ─── PAGE_MARKER constants (Slice 2A.3 follow-up) ─────────────────────


def test_page_marker_format_produces_one_based_marker() -> None:
    """PAGE_MARKER_FORMAT renders the 1-based ``=== Page N ===`` literal."""
    from app.services.design_agent.pdf_extractor import PAGE_MARKER_FORMAT
    assert PAGE_MARKER_FORMAT.format(page_number=1) == "=== Page 1 ==="
    assert PAGE_MARKER_FORMAT.format(page_number=42) == "=== Page 42 ==="


def test_page_marker_re_matches_format_output() -> None:
    """PAGE_MARKER_RE recovers the page number from PAGE_MARKER_FORMAT.

    Drift between the two would mean an extracted document's markers
    no longer match the prompt's instructions in Slice 2A.5 — pin
    both directions.
    """
    from app.services.design_agent.pdf_extractor import (
        PAGE_MARKER_FORMAT, PAGE_MARKER_RE,
    )
    for n in (1, 7, 42, 1000):
        line = PAGE_MARKER_FORMAT.format(page_number=n)
        m = PAGE_MARKER_RE.search(line)
        assert m is not None, f"PAGE_MARKER_RE missed line: {line!r}"
        assert int(m.group(1)) == n


def test_page_marker_re_finds_all_markers_in_extracted_text(tmp_path: Path) -> None:
    """A multi-page extracted document produces markers PAGE_MARKER_RE
    can finditer across — verifies the publicly-exported regex is
    actually usable on real extractor output, not just synthetic
    strings."""
    from app.services.design_agent.pdf_extractor import PAGE_MARKER_RE
    pages = ["page one body content " * 20, "page two body content " * 20]
    pdf = _make_text_pdf(tmp_path / "marker.pdf", pages)
    text, _ = extract_pdf_text(str(pdf))
    page_numbers = [int(m.group(1)) for m in PAGE_MARKER_RE.finditer(text)]
    assert page_numbers == [1, 2]


def test_placeholder_pdf_extracts_with_no_warnings(tmp_path: Path) -> None:
    """The committed placeholder PDF parses cleanly via the extractor.

    Once Govind replaces it with a real brief, this test still acts as
    a regression guard: the file must remain a valid PDF that pypdf can
    open, even if the content changes.
    """
    fixture = (
        Path(__file__).parent / "fixtures" / "sample_briefs" / "2bhk_24x50.pdf"
    )
    text, warnings = extract_pdf_text(str(fixture))
    assert "=== Page 1 ===" in text
    assert not any(w.code == "MALFORMED_PDF" for w in warnings)
