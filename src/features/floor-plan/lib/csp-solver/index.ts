export { solveMandalaCSP } from "./mandala-csp";
export type { MandalaAssignment, SolveResult, SolveOptions } from "./mandala-csp";
export { solveStage3B } from "./cell-csp";
export type { FinePlacement, Stage3BResult, Stage3BOptions } from "./cell-csp";
export { alignBoundaries } from "./boundary-aligner";
export type { AlignmentResult } from "./boundary-aligner";
export { generateWalls } from "./wall-generator";
export type { WallGenOptions } from "./wall-generator";
export { placeOpenings } from "./opening-placer";
export type { OpeningResult } from "./opening-placer";
export type { ConflictSet } from "./unsat-explainer";
export type { Rect } from "./geometry-utils";
export {
  directionToCell,
  cellToDirection,
  cellCoords,
  cellsAreAdjacent,
  CELL_NW, CELL_N, CELL_NE, CELL_W, CELL_CENTER, CELL_E, CELL_SW, CELL_S, CELL_SE,
  ALL_DIRECTIONS,
  type CellIdx,
  type Domain,
} from "./domains";
