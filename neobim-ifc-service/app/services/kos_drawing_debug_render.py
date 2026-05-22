"""KOS drawing debug renderer (Week 5C-1, Phase 1).

Renders a DXF to a PNG overlay so a human can eyeball whether wall detection
landed: all LINEs in light gray, detected walls in red with their ids, plus
the drawing bounds box.

Coordinates are rendered in **millimetres** so the gray base layer (read
straight from the DXF and scaled by the same ``detect_units`` multiplier the
parser used) lines up exactly with the red wall layer (already in mm).

matplotlib runs headless via the Agg backend. The function returns raw PNG
bytes, or ``None`` if the result exceeds ``max_size_kb`` (too large to ship
in an HTTP response) — the caller base64-encodes whatever it gets back.
"""

from __future__ import annotations

import io

import structlog

from app.services.kos_dxf_parser import detect_units, open_dxf

log = structlog.get_logger()


def render_debug_png(dxf_path: str, walls: list, max_size_kb: int = 5000) -> bytes | None:
    """Render gray DXF lines + red walls to a PNG. None if over the size cap."""
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.collections import LineCollection
    except Exception as exc:  # noqa: BLE001
        log.warning("debug_render_matplotlib_missing", error=str(exc))
        return None

    try:
        doc, msp, _ = open_dxf(dxf_path)
        _name, mult, _w = detect_units(doc)
    except Exception as exc:  # noqa: BLE001
        log.warning("debug_render_open_failed", error=str(exc))
        return None

    # Base layer: every LINE + LWPOLYLINE segment in mm, as one LineCollection
    # (one artist → fast even with 100k+ segments).
    base_segments: list[list[tuple[float, float]]] = []
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")

    def _track(x: float, y: float) -> None:
        nonlocal min_x, min_y, max_x, max_y
        min_x, min_y = min(min_x, x), min(min_y, y)
        max_x, max_y = max(max_x, x), max(max_y, y)

    try:
        for entity in msp:
            try:
                etype = entity.dxftype()
                if etype == "LINE":
                    s, e = entity.dxf.start, entity.dxf.end
                    p0 = (s.x * mult, s.y * mult)
                    p1 = (e.x * mult, e.y * mult)
                    base_segments.append([p0, p1])
                    _track(*p0)
                    _track(*p1)
                elif etype == "LWPOLYLINE":
                    pts = [(p[0] * mult, p[1] * mult) for p in entity.get_points("xy")]
                    if entity.closed and len(pts) > 2:
                        pts = pts + [pts[0]]
                    for i in range(len(pts) - 1):
                        base_segments.append([pts[i], pts[i + 1]])
                        _track(*pts[i])
                        _track(*pts[i + 1])
            except Exception:  # noqa: BLE001
                continue
    except Exception as exc:  # noqa: BLE001
        log.warning("debug_render_iteration_failed", error=str(exc))
        return None

    if min_x == float("inf"):
        log.warning("debug_render_no_geometry")
        return None

    fig, ax = plt.subplots(figsize=(11, 11))
    try:
        if base_segments:
            ax.add_collection(LineCollection(
                base_segments, colors="#c8c8c8", linewidths=0.3,
            ))

        # Wall overlay (red) + ids at midpoints.
        wall_segments = []
        for w in walls:
            try:
                sx, sy = w["start"]
                ex, ey = w["end"]
                wall_segments.append([(sx, sy), (ex, ey)])
                _track(sx, sy)
                _track(ex, ey)
            except Exception:  # noqa: BLE001
                continue
        if wall_segments:
            ax.add_collection(LineCollection(
                wall_segments, colors="#e02020", linewidths=1.5,
            ))
            # Label up to 200 walls — beyond that the ids are unreadable noise.
            for w in walls[:200]:
                try:
                    sx, sy = w["start"]
                    ex, ey = w["end"]
                    ax.text((sx + ex) / 2, (sy + ey) / 2, w["id"],
                            fontsize=3, color="#900000", ha="center", va="center")
                except Exception:  # noqa: BLE001
                    continue

        # Bounds box.
        ax.plot(
            [min_x, max_x, max_x, min_x, min_x],
            [min_y, min_y, max_y, max_y, min_y],
            color="#3050d0", linewidth=0.6, linestyle="--",
        )

        pad = max(max_x - min_x, max_y - min_y) * 0.03 + 1.0
        ax.set_xlim(min_x - pad, max_x + pad)
        ax.set_ylim(min_y - pad, max_y + pad)
        ax.set_aspect("equal", adjustable="box")
        ax.set_title(
            f"KOS DXF debug — {len(walls)} walls (red) over geometry (gray)",
            fontsize=9,
        )
        ax.set_xlabel("X (mm)")
        ax.set_ylabel("Y (mm)")

        buf = io.BytesIO()
        fig.savefig(buf, dpi=150, bbox_inches="tight", format="png")
        png = buf.getvalue()
    except Exception as exc:  # noqa: BLE001
        log.warning("debug_render_savefig_failed", error=str(exc))
        return None
    finally:
        plt.close(fig)

    if len(png) > max_size_kb * 1024:
        log.warning(
            "debug_render_too_large",
            png_kb=round(len(png) / 1024, 1),
            cap_kb=max_size_kb,
        )
        return None
    return png
