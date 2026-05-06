#!/usr/bin/env python3
"""Phase 0 R4 — visual rendering matrix runner (deferred).

Builds each fixture's combined-discipline IFC and drives external viewers
to capture isometric NE / NW / SE / SW screenshots. Output structure:

    tests/baselines/visual-matrix/
      <viewer>/
        <fixture>_<angle>.png

Plus a manifest at the root of the matrix:

    tests/baselines/visual-matrix/MANIFEST.json

The manifest records every PNG + its SHA-256 hash, so the nightly +
release CI jobs can perceptual-diff against the committed baseline.

This script CANNOT capture screenshots from BIMVision (no CLI mode in
the BIMVision GUI as of Phase 0 commit). The script logs a placeholder
and the human running the matrix must capture those tiles manually,
following the procedure documented in the SUMMARY.md the script emits.

This script never modifies builders or IDS files. It is purely a
producer of `tests/baselines/visual-matrix/**`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from app.models.request import ExportIFCRequest  # noqa: E402
from app.services.ifc_builder import build_multi_discipline  # noqa: E402

FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "tests" / "baselines" / "visual-matrix"

ANGLES = ["iso-ne", "iso-nw", "iso-se", "iso-sw"]


def _load_fixture(name: str, rich_mode: str) -> ExportIFCRequest:
    raw = json.loads((FIXTURE_DIR / f"{name}.json").read_text())
    raw.pop("_comment", None)
    raw.setdefault("options", {})["richMode"] = rich_mode
    raw["options"]["disciplines"] = ["combined"]
    return ExportIFCRequest.model_validate(raw)


def _build_ifc(req: ExportIFCRequest) -> bytes:
    results = build_multi_discipline(req)
    ifc_bytes, _, _ = results["combined"]
    return ifc_bytes


# ── Per-viewer drivers ──────────────────────────────────────────────


def _capture_blenderbim(ifc_path: Path, output_dir: Path, fixture: str) -> list[Path]:
    """Run Blender headless with the Bonsai (BlenderBIM) add-on.

    Drives a one-shot Python script inside Blender that loads the IFC,
    sets up an isometric camera + orthographic projection, and renders
    one PNG per angle.
    """
    blender = shutil.which("blender")
    if blender is None:
        print(f"[blenderbim] blender CLI not found — skipping {fixture}")
        return []

    angles = {
        "iso-ne": (45.0, 35.0),
        "iso-nw": (-45.0, 35.0),
        "iso-se": (135.0, 35.0),
        "iso-sw": (-135.0, 35.0),
    }
    captured: list[Path] = []
    for angle_name, (yaw, pitch) in angles.items():
        out_path = output_dir / f"{fixture}_{angle_name}.png"
        # The Blender driver script is generated inline so this single
        # file is self-contained.
        driver = (
            "import bpy, math\n"
            f"bpy.ops.wm.read_factory_settings(use_empty=True)\n"
            f"try:\n"
            f"    bpy.ops.bim.load_project(filepath=r'{ifc_path}')\n"
            f"except Exception as e:\n"
            f"    print('BIM load failed:', e)\n"
            f"    raise SystemExit(2)\n"
            f"# Set up an isometric ortho camera\n"
            f"cam_data = bpy.data.cameras.new('iso')\n"
            f"cam_data.type = 'ORTHO'\n"
            f"cam_data.ortho_scale = 60\n"
            f"cam = bpy.data.objects.new('iso', cam_data)\n"
            f"bpy.context.collection.objects.link(cam)\n"
            f"yaw = math.radians({yaw}); pitch = math.radians({pitch})\n"
            f"cam.location = (40 * math.cos(pitch) * math.cos(yaw),\n"
            f"                40 * math.cos(pitch) * math.sin(yaw),\n"
            f"                40 * math.sin(pitch))\n"
            f"cam.rotation_euler = (math.pi/2 - pitch, 0, yaw + math.pi/2)\n"
            f"bpy.context.scene.camera = cam\n"
            f"bpy.context.scene.render.resolution_x = 1024\n"
            f"bpy.context.scene.render.resolution_y = 768\n"
            f"bpy.context.scene.render.image_settings.file_format = 'PNG'\n"
            f"bpy.context.scene.render.filepath = r'{out_path}'\n"
            f"bpy.ops.render.render(write_still=True)\n"
        )
        with tempfile.NamedTemporaryFile(suffix=".py", delete=False, mode="w") as t:
            t.write(driver)
            t.flush()
            script_path = t.name
        try:
            subprocess.run(
                [blender, "--background", "--python", script_path],
                check=True,
                capture_output=True,
                timeout=180,
            )
        except subprocess.CalledProcessError as exc:
            print(f"[blenderbim] {fixture}/{angle_name}: render failed:\n  {exc.stderr.decode()[:400]}")
            continue
        except subprocess.TimeoutExpired:
            print(f"[blenderbim] {fixture}/{angle_name}: timed out")
            continue
        if out_path.exists():
            captured.append(out_path)
            print(f"[blenderbim] captured {out_path.relative_to(REPO_ROOT)}")
    return captured


def _capture_fzk(ifc_path: Path, output_dir: Path, fixture: str) -> list[Path]:
    """FZK Viewer has a documented but Windows-only CLI. On non-Windows
    we emit a placeholder + log; the release matrix runner is expected
    to handle FZK in a separate Windows-runner job."""
    if sys.platform == "win32":
        # Real FZK CLI invocation belongs here. Placeholder until a Windows
        # runner is provisioned in CI.
        print(f"[fzk] Windows path not yet implemented — skipping {fixture}")
        return []
    print(f"[fzk] non-Windows host ({sys.platform}); FZK requires a Windows runner — skipping {fixture}")
    return []


def _capture_bimvision(ifc_path: Path, output_dir: Path, fixture: str) -> list[Path]:
    """BIMVision has NO CLI mode. Capture is a manual GUI step. This
    function only writes a README pointing the human at what to do."""
    readme = output_dir / "BIMVISION_MANUAL_CAPTURE.md"
    if not readme.exists():
        readme.write_text(
            "# BIMVision manual capture\n\n"
            "BIMVision (https://bimvision.eu/) does not expose a CLI for\n"
            "headless screenshot capture. For each fixture × each angle,\n"
            "open the IFC in BIMVision, set the camera to ortho ISO, save\n"
            "a 1024×768 PNG with the filename pattern\n"
            "`<fixture>_<angle>.png` into this directory.\n"
            "\n"
            "Angles: iso-ne (yaw +45°), iso-nw (yaw -45°),\n"
            "iso-se (yaw +135°), iso-sw (yaw -135°). Pitch +35°.\n"
        )
    print(f"[bimvision] {fixture}: manual capture required (see BIMVISION_MANUAL_CAPTURE.md)")
    return []


def _capture_web_ifc(ifc_path: Path, output_dir: Path, fixture: str) -> list[Path]:
    """web-ifc capture via Puppeteer.

    The Puppeteer driver lives at scripts/puppeteer/visual-matrix.js
    (to be authored alongside the existing NeoBIM IFC viewer at
    src/features/ifc/components/IFCViewer.tsx). For Phase 0 v1 we
    bail-with-log if the driver is missing; the release matrix runner
    will fail loudly until the driver lands.
    """
    driver = REPO_ROOT.parent / "scripts" / "puppeteer" / "visual-matrix.js"
    node = shutil.which("node")
    if node is None or not driver.exists():
        print(f"[web-ifc] puppeteer driver missing — skipping {fixture}")
        return []

    captured: list[Path] = []
    for angle in ANGLES:
        out_path = output_dir / f"{fixture}_{angle}.png"
        try:
            subprocess.run(
                [
                    node, str(driver),
                    "--ifc", str(ifc_path),
                    "--angle", angle,
                    "--out", str(out_path),
                ],
                check=True,
                capture_output=True,
                timeout=120,
            )
        except subprocess.CalledProcessError as exc:
            print(f"[web-ifc] {fixture}/{angle}: failed:\n  {exc.stderr.decode()[:300]}")
            continue
        if out_path.exists():
            captured.append(out_path)
            print(f"[web-ifc] captured {out_path.relative_to(REPO_ROOT)}")
    return captured


VIEWER_DRIVERS = {
    "blenderbim": _capture_blenderbim,
    "fzk": _capture_fzk,
    "bimvision": _capture_bimvision,
    "web-ifc": _capture_web_ifc,
}


# ── Manifest ────────────────────────────────────────────────────────


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_manifest(output_dir: Path, captured: dict[str, list[Path]]) -> Path:
    entries = []
    for viewer, paths in sorted(captured.items()):
        for p in sorted(paths):
            entries.append({
                "viewer": viewer,
                "path": str(p.relative_to(output_dir.parent.parent)),
                "size_bytes": p.stat().st_size,
                "sha256": _sha256(p),
            })
    manifest = {
        "captured_at": date.today().isoformat(),
        "total_screenshots": len(entries),
        "entries": entries,
    }
    path = output_dir / "MANIFEST.json"
    path.write_text(json.dumps(manifest, indent=2) + "\n")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--fixtures",
        default="simple_box,multistorey_residential,non_rectangular",
    )
    parser.add_argument(
        "--viewers",
        default="blenderbim,fzk,bimvision,web-ifc",
        help="Comma-separated subset of viewers to drive.",
    )
    parser.add_argument("--rich-mode", default="full")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Root output directory (per-viewer subdirs are created beneath).",
    )
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)

    fixtures = [f.strip() for f in args.fixtures.split(",") if f.strip()]
    viewers = [v.strip() for v in args.viewers.split(",") if v.strip()]
    captured: dict[str, list[Path]] = {v: [] for v in viewers}

    for fixture in fixtures:
        print(f"[matrix] {fixture}: building IFC…")
        req = _load_fixture(fixture, args.rich_mode)
        ifc_bytes = _build_ifc(req)

        with tempfile.NamedTemporaryFile(suffix=".ifc", delete=False) as tmp:
            tmp.write(ifc_bytes)
            tmp.flush()
            ifc_path = Path(tmp.name)

        for viewer in viewers:
            driver = VIEWER_DRIVERS.get(viewer)
            if driver is None:
                print(f"[matrix] unknown viewer '{viewer}' — skipping")
                continue
            sub_out = args.output / viewer
            sub_out.mkdir(parents=True, exist_ok=True)
            captured[viewer].extend(driver(ifc_path, sub_out, fixture))

        try:
            os.unlink(ifc_path)
        except OSError:
            pass

    manifest_path = _write_manifest(args.output, captured)
    print(f"[matrix] manifest written to {manifest_path.relative_to(REPO_ROOT)}")

    expected = len(fixtures) * len(viewers) * len(ANGLES)
    actual = sum(len(v) for v in captured.values())
    print(f"[matrix] {actual}/{expected} screenshots captured")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
