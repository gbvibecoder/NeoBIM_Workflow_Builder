"""Generate top-down + isometric PNG previews of any IFC.

Uses `ifcopenshell.geom` + `matplotlib` (mpl_toolkits.mplot3d) — both are
already in the Railway requirements. No new dependencies. Top view is a
2D scatter/quad render in the XY plane; iso view is the same triangles
in 3D with a fixed elevation/azimuth.

Usage:
    python3 scripts/forensics/ifc-render-preview.py <file.ifc> [more.ifc ...]

Writes:
    forensics/<stem>-top.png
    forensics/<stem>-iso.png
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import List, Tuple

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.util.shape
import matplotlib
matplotlib.use("Agg")  # non-interactive backend; required for CI / headless
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Polygon
from matplotlib.collections import PatchCollection
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


# Pleasant default palette by IFC class — matches the brief-renders style.
_PALETTE = {
    "IfcSlab": "#9b8a78",
    "IfcWall": "#cfd6d4",
    "IfcColumn": "#7a7a7a",
    "IfcBeam": "#5a5a5a",
    "IfcCovering": "#b58c5a",
    "IfcFurnishingElement": "#7a9bd6",
    "IfcBuildingElementProxy": "#bd6b89",
    "IfcDoor": "#8c6a4a",
    "IfcWindow": "#a7cce3",
    "IfcLightFixture": "#f5e07a",
    "IfcSpace": "#dcdcdc",
}


def _collect_meshes(f) -> List[Tuple[str, np.ndarray, np.ndarray]]:
    """Return [(ifc_class, verts_xyz, face_indices)] for every product
    with a geometry representation."""
    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    meshes: List[Tuple[str, np.ndarray, np.ndarray]] = []
    classes = [
        "IfcSlab", "IfcWall", "IfcColumn", "IfcBeam", "IfcCovering",
        "IfcFurnishingElement", "IfcDoor", "IfcWindow", "IfcRailing",
        "IfcStair", "IfcStairFlight", "IfcBuildingElementProxy",
    ]
    for klass in classes:
        try:
            es = f.by_type(klass)
        except RuntimeError:
            continue
        for e in es:
            if not getattr(e, "Representation", None):
                continue
            try:
                shape = ifcopenshell.geom.create_shape(settings, e)
                verts = ifcopenshell.util.shape.get_vertices(shape.geometry)
                faces = ifcopenshell.util.shape.get_faces(shape.geometry)
                if verts is None or faces is None:
                    continue
                v_arr = np.asarray(verts, dtype=float).reshape(-1, 3)
                f_arr = np.asarray(faces, dtype=int).reshape(-1, 3)
                if v_arr.size == 0 or f_arr.size == 0:
                    continue
                meshes.append((klass, v_arr, f_arr))
            except Exception:
                continue
    return meshes


def _scene_bounds(meshes) -> Tuple[float, float, float, float, float, float]:
    if not meshes:
        return 0, 0, 0, 1, 1, 1
    all_v = np.concatenate([m[1] for m in meshes])
    return (
        float(all_v[:, 0].min()),
        float(all_v[:, 1].min()),
        float(all_v[:, 2].min()),
        float(all_v[:, 0].max()),
        float(all_v[:, 1].max()),
        float(all_v[:, 2].max()),
    )


def render_top(meshes, out_path: Path, title: str) -> None:
    """Top-down view in the XY plane — triangle silhouettes per element."""
    fig, ax = plt.subplots(figsize=(8, 8))
    fig.suptitle(title, fontsize=12)

    xmin, ymin, _zmin, xmax, ymax, _zmax = _scene_bounds(meshes)
    margin = max(xmax - xmin, ymax - ymin) * 0.05 + 0.01
    ax.set_xlim(xmin - margin, xmax + margin)
    ax.set_ylim(ymin - margin, ymax + margin)
    ax.set_aspect("equal", adjustable="box")
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.grid(True, linewidth=0.3, alpha=0.4)

    for klass, verts, faces in meshes:
        color = _PALETTE.get(klass, "#888888")
        patches = []
        for tri in faces:
            poly_pts = verts[tri, :2]
            patches.append(Polygon(poly_pts, closed=True))
        pc = PatchCollection(
            patches, facecolor=color, edgecolor="#222222",
            linewidth=0.2, alpha=0.7,
        )
        ax.add_collection(pc)

    fig.tight_layout()
    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    plt.close(fig)


def render_iso(meshes, out_path: Path, title: str) -> None:
    """Isometric view — Poly3DCollection of all element triangles."""
    fig = plt.figure(figsize=(9, 8))
    ax = fig.add_subplot(111, projection="3d")
    fig.suptitle(title, fontsize=12)

    xmin, ymin, zmin, xmax, ymax, zmax = _scene_bounds(meshes)
    # Equal aspect ratio across axes (matplotlib doesn't have set_aspect("equal") for 3D)
    max_range = max(xmax - xmin, ymax - ymin, zmax - zmin) / 2.0
    midx = (xmax + xmin) / 2.0
    midy = (ymax + ymin) / 2.0
    midz = (zmax + zmin) / 2.0
    ax.set_xlim(midx - max_range, midx + max_range)
    ax.set_ylim(midy - max_range, midy + max_range)
    ax.set_zlim(midz - max_range, midz + max_range)
    ax.view_init(elev=30, azim=-60)
    ax.set_xlabel("X (m)")
    ax.set_ylabel("Y (m)")
    ax.set_zlabel("Z (m)")

    for klass, verts, faces in meshes:
        color = _PALETTE.get(klass, "#888888")
        tris = verts[faces]
        coll = Poly3DCollection(
            tris, facecolor=color, edgecolor="#333333",
            linewidth=0.15, alpha=0.85,
        )
        ax.add_collection3d(coll)

    fig.tight_layout()
    fig.savefig(out_path, dpi=120, bbox_inches="tight")
    plt.close(fig)


def main(argv: List[str]) -> int:
    if len(argv) < 2:
        print(
            "usage: ifc-render-preview.py [--out-dir <dir>] <file.ifc> [more.ifc ...]",
            file=sys.stderr,
        )
        return 2
    out_dir = Path("forensics")
    args = list(argv[1:])
    if args and args[0] == "--out-dir":
        if len(args) < 2:
            print("--out-dir requires a path", file=sys.stderr)
            return 2
        out_dir = Path(args[1])
        args = args[2:]
    out_dir.mkdir(parents=True, exist_ok=True)

    for arg in args:
        path = Path(arg)
        if not path.exists():
            print(f"skip {path}: not found", file=sys.stderr)
            continue
        f = ifcopenshell.open(str(path))
        meshes = _collect_meshes(f)
        if not meshes:
            print(f"skip {path}: no geometric elements")
            continue
        title = path.stem
        top_path = out_dir / f"{path.stem}-top.png"
        iso_path = out_dir / f"{path.stem}-iso.png"
        render_top(meshes, top_path, f"{title} — top view")
        render_iso(meshes, iso_path, f"{title} — iso view")
        print(f"  {path.stem}: wrote {top_path} + {iso_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
