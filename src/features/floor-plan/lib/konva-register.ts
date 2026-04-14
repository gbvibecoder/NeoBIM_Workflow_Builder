/**
 * Konva shape registration — MUST be imported before any <Stage>, <Layer>,
 * <Rect>, <Line>, <Text>, <Circle>, <Arc>, <Arrow>, <Path> renders.
 *
 * Background
 * ----------
 * react-konva creates Konva nodes via `new Konva[type](props)`. Each shape
 * class is supposed to self-register on the `Konva` namespace at module
 * load time via a top-level `_registerNode(Shape)` call. The registration
 * is a side effect — no one *reads* the shape module's exports, they just
 * need the module to evaluate.
 *
 * Next.js 16 + Turbopack (and SWC in prod) aggressively tree-shake
 * side-effect-only imports because konva's `package.json` has no
 * `sideEffects: true` declaration. Result: shape modules never evaluate,
 * `Konva.Rect`/`.Line`/`.Text`/… are undefined, and react-konva silently
 * falls back to `Group` for every shape — so nothing visible renders.
 *
 * Fix
 * ---
 * 1. Import every shape class by name (named imports, not side-effect).
 * 2. Assign each to the `Konva` singleton under its expected key. This
 *    is an observable runtime side effect the bundler cannot eliminate.
 * 3. Export a sentinel (`KONVA_READY`) so callers must *reference* this
 *    module — any side-effect-only import would itself be tree-shakeable.
 *
 * Callers must import `{ KONVA_READY }` and reference the value so this
 * module's body is guaranteed to execute before any Konva node is rendered.
 */

import Konva from "konva";
import { Rect } from "konva/lib/shapes/Rect";
import { Line } from "konva/lib/shapes/Line";
import { Text } from "konva/lib/shapes/Text";
import { Circle } from "konva/lib/shapes/Circle";
import { Arc } from "konva/lib/shapes/Arc";
import { Arrow } from "konva/lib/shapes/Arrow";
import { Path } from "konva/lib/shapes/Path";

// Assign every shape to the Konva namespace that react-konva's
// `createInstance` consults via `Konva[type]`. These mutations are
// observable and keep the bundler from eliminating the imports.
const K = Konva as unknown as Record<string, unknown>;
K.Rect = Rect;
K.Line = Line;
K.Text = Text;
K.Circle = Circle;
K.Arc = Arc;
K.Arrow = Arrow;
K.Path = Path;

// Runtime sanity check — fails loudly if registration somehow didn't stick.
if (typeof window !== "undefined") {
  const shapes = ["Rect", "Line", "Text", "Circle", "Arc", "Arrow", "Path"] as const;
  const missing = shapes.filter((name) => typeof K[name] !== "function");
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[konva-register] shapes missing after registration: ${missing.join(", ")}`);
  }
}

/** Sentinel. Import and reference this value before rendering any Konva node. */
export const KONVA_READY = true as const;
