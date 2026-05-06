#!/usr/bin/env python3
"""Phase 0 R5 — perceptual-diff a candidate visual matrix against baseline.

Pairs every PNG under `--candidate` with the same-named PNG under
`--baseline`, computes SSIM, and writes a JSON report. Exits non-zero
if any pair scores below `--threshold` AND `--strict` was passed
(release workflow), otherwise it exits 0 even on regression so the
nightly workflow can decide whether to open an issue.

Note: this script is part of the deferred-work scaffolding. It will only
do real work once the nightly job has captured a baseline AND a
candidate. Until then it short-circuits with a "no baseline yet" report.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _list_pngs(root: Path) -> dict[str, Path]:
    """Return {relative-path: absolute-path} for every PNG under root."""
    out: dict[str, Path] = {}
    for p in root.rglob("*.png"):
        rel = p.relative_to(root).as_posix()
        out[rel] = p
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--threshold", type=float, default=0.95)
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--report", type=Path, default=Path("visual-diff-report.json"))
    args = parser.parse_args()

    if not args.baseline.exists():
        report = {
            "status": "no-baseline",
            "message": f"baseline {args.baseline} does not exist — run the nightly job to create it",
            "regressions": [],
        }
        args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(report["message"])
        return 0

    if not args.candidate.exists():
        print(f"candidate {args.candidate} does not exist — nothing to diff")
        return 0 if not args.strict else 1

    baseline_index = _list_pngs(args.baseline)
    candidate_index = _list_pngs(args.candidate)
    if not candidate_index:
        print(f"candidate {args.candidate} contains no PNGs — capture run did not produce output")
        return 0

    try:
        from PIL import Image  # type: ignore[import-not-found]
        import numpy as np  # type: ignore[import-not-found]
        from skimage.metrics import structural_similarity as ssim  # type: ignore[import-not-found]
    except ImportError as exc:
        print(f"perceptual-diff dependencies missing ({exc}); install Pillow + scikit-image + numpy")
        return 0 if not args.strict else 1

    regressions: list[dict] = []
    matched = 0
    for rel, cand_path in sorted(candidate_index.items()):
        base_path = baseline_index.get(rel)
        if base_path is None:
            continue
        matched += 1
        try:
            base_img = np.array(Image.open(base_path).convert("L"))
            cand_img = np.array(Image.open(cand_path).convert("L"))
            if base_img.shape != cand_img.shape:
                regressions.append({
                    "tile": rel,
                    "score": None,
                    "reason": f"shape mismatch baseline={base_img.shape} candidate={cand_img.shape}",
                })
                continue
            score = float(ssim(base_img, cand_img))
        except Exception as exc:  # noqa: BLE001
            regressions.append({"tile": rel, "score": None, "reason": str(exc)})
            continue
        if score < args.threshold:
            regressions.append({"tile": rel, "score": score, "threshold": args.threshold})

    report = {
        "status": "regression" if regressions else "ok",
        "threshold": args.threshold,
        "tiles_compared": matched,
        "regressions": regressions,
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report, indent=2))
    if regressions and args.strict:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
