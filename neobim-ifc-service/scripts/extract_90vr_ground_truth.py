"""Phase 5C-3 PR 4 — one-shot ground-truth extraction for 90VR PDFs.

Walks each 90VR PDF, finds every PyMuPDF text span whose stripped text is an
EXACT (whole-word) match for a Team2 opening label (SD, DW1, DW2), and emits
a JSON record per occurrence.

Output is intended to be reviewed by hand before being committed as a test
fixture. The detector's runtime behaviour is independent of this script —
this script ONLY freezes ground truth from the real PDF, so the detector
can be measured against it.

Run:

    python3.11 scripts/extract_90vr_ground_truth.py

Outputs are written next to the source PDFs (in temp_folder/reference/...)
as `.ground_truth.json` files. Move/copy them into
tests/fixtures/openings/ once verified.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import fitz

# Team2 opening allowlist — keep in sync with TEAM2_OPENING_LIBRARY labels.
TEAM2_OPENING_LABELS_RE = re.compile(r"^(SD|DW1|DW2)$")

# Default per-label dimensions (mirrors AnnotationEntry defaults; if the
# library changes, regenerate fixtures).
TEAM2_DEFAULTS = {
    "SD":  {"opening_type": "sliding_door", "width_mm": 2400.0, "height_mm": 2100.0, "sill_height_mm": 0.0},
    "DW1": {"opening_type": "door",          "width_mm": 1200.0, "height_mm": 2100.0, "sill_height_mm": 0.0},
    "DW2": {"opening_type": "door",          "width_mm":  900.0, "height_mm": 2100.0, "sill_height_mm": 0.0},
}

REFERENCE_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "temp_folder" / "reference"
)

PDFS = [
    "90VR-MR-AD-2501[J]-Concrete Setout Plan-Basement-Part 2.pdf",
    "90VR-TC-AD-2501[A]-Concrete Setout Plan-Basement-Part 2.pdf",
]


def extract_one(pdf_path: Path) -> dict:
    doc = fitz.open(pdf_path)
    page = doc[0]
    spans = []
    for block in page.get_text("dict").get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if TEAM2_OPENING_LABELS_RE.match(text):
                    bbox = span.get("bbox") or (0.0, 0.0, 0.0, 0.0)
                    cx = (bbox[0] + bbox[2]) / 2.0
                    cy = (bbox[1] + bbox[3]) / 2.0
                    defaults = TEAM2_DEFAULTS[text]
                    spans.append({
                        "label": text,
                        "opening_type": defaults["opening_type"],
                        "expected_width_mm": defaults["width_mm"],
                        "expected_height_mm": defaults["height_mm"],
                        "expected_sill_height_mm": defaults["sill_height_mm"],
                        "position_x_pt": round(cx, 2),
                        "position_y_pt": round(cy, 2),
                        "tolerance_position_mm": 500,
                    })
    return {
        "drawing": pdf_path.stem,
        "source": "Team2 Architects — 90 Victoria Road (basement setout)",
        "source_pdf": f"temp_folder/reference/{pdf_path.name}",
        "extraction_method": (
            "PyMuPDF page.get_text('dict') text spans; whole-word match "
            "against Team2 opening allowlist (SD|DW1|DW2); dimensions are "
            "Team2 library defaults pending per-drawing dimension extraction."
        ),
        "expected_openings": spans,
        "tolerance_position_mm": 500,
        "tolerance_width_mm": 200,
        "notes": (
            "Position values are PDF-point center coordinates of the LABEL "
            "TEXT (not the opening centre on the wall). Position tolerance is "
            "generous (500mm) because architectural callouts are positionally "
            "fuzzy. Width/height are Team2 library defaults pending Karthik "
            "confirmation of per-drawing dimensions."
        ),
    }


def main() -> int:
    if not REFERENCE_DIR.exists():
        print(f"ERROR: reference dir not found: {REFERENCE_DIR}")
        return 1
    for name in PDFS:
        pdf_path = REFERENCE_DIR / name
        if not pdf_path.exists():
            print(f"WARN: missing {pdf_path}")
            continue
        result = extract_one(pdf_path)
        out_path = pdf_path.with_suffix(".ground_truth.json")
        out_path.write_text(json.dumps(result, indent=2))
        print(f"{pdf_path.name}: {len(result['expected_openings'])} openings → {out_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
