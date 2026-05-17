"""POST /api/v3/generator/render-previews

Renders top-down + isometric PNG previews of any IFC by URL. Wraps the
same `ifcopenshell.geom` + `matplotlib` logic that powers the local
forensics script (`scripts/forensics/ifc-render-preview.py`), but
adapted to:

  1. Stream the IFC bytes from R2 (or any public URL) into a temp file.
  2. Render top + iso PNGs in-process (matplotlib Agg backend).
  3. Return both PNGs as base64 strings — the caller (Next.js) uploads
     to R2 so we keep R2 credentials in one process only.

This router DOES NOT touch `buildflow_ifc.py`, `validate.py`, or
`v3_generator.py` — it adds a NEW capability alongside them. The
existing v3 agent loop is unchanged. Canvas calls it via the new
`/api/brief-to-ifc/v3/render-previews` Next.js route.

Auth: inherits `ApiKeyMiddleware` at the app level (Bearer token).

NOTE: the renderer is **best-effort**. Some IFCs include elements
whose Representation can't be triangulated by `ifcopenshell.geom`
(rare). Each per-element failure is caught and logged; the render
proceeds with whatever meshes did materialise. An IFC with zero
renderable elements returns `{ ok: false, error: "no_meshes" }`.
"""

from __future__ import annotations

import base64
import io
import os
import tempfile
import time
from typing import List, Optional, Tuple
from urllib.request import Request as UrlRequest, urlopen

import structlog
from fastapi import APIRouter
from pydantic import BaseModel, Field

log = structlog.get_logger()

router = APIRouter(tags=["v3-previews"])

# Module-level matplotlib import + Agg backend selection. Imported lazily
# inside the request body so importing the router on a system without
# matplotlib doesn't crash app boot — the endpoint just returns 503.


# ── Pleasant default palette matching the forensics script ────────────
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


class RenderPreviewsRequest(BaseModel):
    """Body for POST /api/v3/generator/render-previews."""

    ifc_url: str = Field(..., min_length=8, max_length=2000)
    # Render size knobs — optional; defaults match the forensics script.
    top_figsize: Optional[Tuple[float, float]] = None
    iso_figsize: Optional[Tuple[float, float]] = None
    dpi: int = Field(120, ge=72, le=300)


class RenderPreviewsResponse(BaseModel):
    ok: bool
    top_png_b64: Optional[str] = None
    iso_png_b64: Optional[str] = None
    mesh_count: int = 0
    duration_ms: int = 0
    error: Optional[str] = None
    error_detail: Optional[str] = None


def _download_ifc(url: str) -> bytes:
    """Fetch the IFC bytes. Public R2 URLs; no auth header."""
    # Cloudflare R2 public URLs accept normal HTTP GET — no presign needed.
    # Cap at 50 MB to avoid runaway downloads. v3 outputs typically <2 MB.
    req = UrlRequest(url, headers={"User-Agent": "neobim-ifc-service/v3-previews"})
    with urlopen(req, timeout=30) as r:  # noqa: S310 — trusted public URL
        chunks: List[bytes] = []
        total = 0
        while True:
            piece = r.read(64 * 1024)
            if not piece:
                break
            total += len(piece)
            if total > 50 * 1024 * 1024:
                raise ValueError("IFC exceeds 50MB cap")
            chunks.append(piece)
        return b"".join(chunks)


def _collect_meshes(f):
    """Return [(ifc_class, verts_xyz, face_indices)] for every renderable product."""
    import ifcopenshell  # noqa: F401 — type only, imported by caller
    import ifcopenshell.geom
    import ifcopenshell.util.shape
    import numpy as np

    settings = ifcopenshell.geom.settings()
    settings.set(settings.USE_WORLD_COORDS, True)

    meshes = []
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
                # Per-element failures (rare). Skip; don't fail the whole render.
                continue
    return meshes


def _scene_bounds(meshes):
    import numpy as np
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


def _render_top(meshes, dpi: int, figsize: Optional[Tuple[float, float]]) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon
    from matplotlib.collections import PatchCollection

    size = figsize or (8.0, 8.0)
    fig, ax = plt.subplots(figsize=size)

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
    buf = io.BytesIO()
    fig.savefig(buf, dpi=dpi, bbox_inches="tight", format="png")
    plt.close(fig)
    return buf.getvalue()


def _render_iso(meshes, dpi: int, figsize: Optional[Tuple[float, float]]) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    size = figsize or (9.0, 8.0)
    fig = plt.figure(figsize=size)
    ax = fig.add_subplot(111, projection="3d")

    xmin, ymin, zmin, xmax, ymax, zmax = _scene_bounds(meshes)
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
    buf = io.BytesIO()
    fig.savefig(buf, dpi=dpi, bbox_inches="tight", format="png")
    plt.close(fig)
    return buf.getvalue()


@router.post("/render-previews", response_model=RenderPreviewsResponse)
async def render_previews(body: RenderPreviewsRequest) -> RenderPreviewsResponse:
    """Render top+iso PNG previews of an IFC at `ifc_url`."""
    started = time.monotonic()

    # Defensive: import heavy deps inside the handler so a missing module
    # surfaces as a structured 503-shaped response instead of crashing app boot.
    try:
        import ifcopenshell  # noqa: F401
        import matplotlib  # noqa: F401
    except Exception as e:
        log.error("preview_imports_failed", error=str(e))
        return RenderPreviewsResponse(
            ok=False,
            error="dependencies_missing",
            error_detail=f"{type(e).__name__}: {e}",
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    # 1. Download the IFC.
    try:
        ifc_bytes = _download_ifc(body.ifc_url)
    except Exception as e:
        log.warning("preview_download_failed", url=body.ifc_url, error=str(e))
        return RenderPreviewsResponse(
            ok=False,
            error="download_failed",
            error_detail=f"{type(e).__name__}: {e}",
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    # 2. Open via ifcopenshell — requires a real file path on disk.
    tmp_dir = tempfile.mkdtemp(prefix="bf-render-")
    try:
        tmp_path = os.path.join(tmp_dir, "in.ifc")
        with open(tmp_path, "wb") as fh:
            fh.write(ifc_bytes)

        f = ifcopenshell.open(tmp_path)
        meshes = _collect_meshes(f)
        if not meshes:
            log.warning("preview_no_meshes", url=body.ifc_url)
            return RenderPreviewsResponse(
                ok=False,
                error="no_meshes",
                error_detail="IFC has no renderable elements (no Representation).",
                duration_ms=int((time.monotonic() - started) * 1000),
            )

        top_png = _render_top(meshes, body.dpi, body.top_figsize)
        iso_png = _render_iso(meshes, body.dpi, body.iso_figsize)

        return RenderPreviewsResponse(
            ok=True,
            top_png_b64=base64.b64encode(top_png).decode("ascii"),
            iso_png_b64=base64.b64encode(iso_png).decode("ascii"),
            mesh_count=len(meshes),
            duration_ms=int((time.monotonic() - started) * 1000),
        )

    except Exception as e:
        log.error("preview_render_failed", url=body.ifc_url, error=str(e), exc_info=True)
        return RenderPreviewsResponse(
            ok=False,
            error="render_failed",
            error_detail=f"{type(e).__name__}: {e}",
            duration_ms=int((time.monotonic() - started) * 1000),
        )
    finally:
        try:
            import shutil
            shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass
