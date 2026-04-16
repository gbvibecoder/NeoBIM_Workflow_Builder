import type { CenterDirection } from "../structured-parser";

export type CellIdx = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type Domain = number;

// 3×3 mandala grid. Row 0 = north, row 2 = south. Col 0 = west, col 2 = east.
// Index layout:
//   NW=0   N=1   NE=2
//   W=3    C=4   E=5
//   SW=6   S=7   SE=8
export const CELL_NW: CellIdx = 0;
export const CELL_N: CellIdx = 1;
export const CELL_NE: CellIdx = 2;
export const CELL_W: CellIdx = 3;
export const CELL_CENTER: CellIdx = 4;
export const CELL_E: CellIdx = 5;
export const CELL_SW: CellIdx = 6;
export const CELL_S: CellIdx = 7;
export const CELL_SE: CellIdx = 8;

export const ALL_CELLS: Domain = 0b111111111;
export const CORNER_CELLS: Domain = (1 << CELL_NW) | (1 << CELL_NE) | (1 << CELL_SW) | (1 << CELL_SE);

export const ALL_DIRECTIONS: CenterDirection[] = [
  "NW", "N", "NE", "W", "CENTER", "E", "SW", "S", "SE",
];

const DIR_TO_CELL: Record<string, CellIdx> = {
  NW: CELL_NW, N: CELL_N, NE: CELL_NE,
  W: CELL_W, CENTER: CELL_CENTER, E: CELL_E,
  SW: CELL_SW, S: CELL_S, SE: CELL_SE,
};

export function directionToCell(dir: CenterDirection): CellIdx {
  return DIR_TO_CELL[dir];
}

export function cellToDirection(cell: CellIdx): CenterDirection {
  return ALL_DIRECTIONS[cell];
}

export function cellCoords(cell: CellIdx): { col: number; row: number } {
  return { col: cell % 3, row: Math.floor(cell / 3) };
}

export function cellsAreAdjacent(a: CellIdx, b: CellIdx): boolean {
  if (a === b) return true;
  const ca = cellCoords(a);
  const cb = cellCoords(b);
  return Math.max(Math.abs(ca.col - cb.col), Math.abs(ca.row - cb.row)) <= 1;
}

export function cellsChebyshevDistance(a: CellIdx, b: CellIdx): number {
  const ca = cellCoords(a);
  const cb = cellCoords(b);
  return Math.max(Math.abs(ca.col - cb.col), Math.abs(ca.row - cb.row));
}

export function isCornerCell(cell: CellIdx): boolean {
  return (CORNER_CELLS >> cell) & 1 ? true : false;
}

export function singleton(cell: CellIdx): Domain {
  return 1 << cell;
}

export function maskOf(cells: CellIdx[]): Domain {
  let d: Domain = 0;
  for (const c of cells) d |= 1 << c;
  return d;
}

export function domainAdd(d: Domain, cell: CellIdx): Domain {
  return d | (1 << cell);
}

export function domainRemove(d: Domain, cell: CellIdx): Domain {
  return d & ~(1 << cell);
}

export function domainIntersect(a: Domain, b: Domain): Domain {
  return a & b;
}

export function domainContains(d: Domain, cell: CellIdx): boolean {
  return ((d >> cell) & 1) === 1;
}

export function domainSize(d: Domain): number {
  // Kernighan bitcount for 9-bit domain
  let count = 0;
  let x = d;
  while (x !== 0) {
    x &= x - 1;
    count++;
  }
  return count;
}

export function domainIsEmpty(d: Domain): boolean {
  return d === 0;
}

export function domainToCells(d: Domain): CellIdx[] {
  const out: CellIdx[] = [];
  for (let i = 0; i < 9; i++) {
    if ((d >> i) & 1) out.push(i as CellIdx);
  }
  return out;
}
