/* ─── IFC Enhance — Tier 3 slab visibility cloak ─────────────────────────
   Hides the original flat roof-slab(s) by flipping `mesh.visible` to false
   and remembers which meshes were actually flipped so reset can restore
   exactly that set — no guessing, no material mutation. */

import type { Mesh } from "three";

export class SlabHider {
  private hidden: Mesh[] = [];

  /** Hide every visible mesh and record the list for restore(). */
  hide(meshes: Mesh[]): void {
    for (const m of meshes) {
      if (m.visible) {
        this.hidden.push(m);
        m.visible = false;
      }
    }
  }

  /**
   * Flip every previously-hidden mesh back to visible. Idempotent: after
   * restore the internal list is empty, so calling restore a second time
   * is a no-op even if apply() failed halfway through.
   */
  restore(): void {
    for (const m of this.hidden) m.visible = true;
    this.hidden = [];
  }

  /** Diagnostic — how many meshes are currently cloaked. */
  get size(): number {
    return this.hidden.length;
  }
}
