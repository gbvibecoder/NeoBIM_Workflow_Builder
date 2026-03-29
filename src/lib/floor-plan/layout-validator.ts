/**
 * Stage 2b: Layout Validator
 *
 * Validates AI-generated room positions for architectural correctness.
 * Returns structured error messages that can be fed back to GPT-4o
 * for a retry attempt.
 *
 * Checks:
 * 1. Overlap detection (no two rooms share interior area)
 * 2. Boundary check (all rooms within footprint)
 * 3. Reachability (BFS flood fill — every room reachable from entrance)
 * 4. Aspect ratio (no room thinner than 1:3)
 * 5. Area coverage (rooms fill ≥85% of footprint)
 * 6. Adjacency satisfaction (required adjacencies from Stage 1)
 */

import type { AdjacencyRequirement } from "./ai-room-programmer";

export interface PositionedRoomForValidation {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  depth: number;
  area?: number;
}

export interface ValidationError {
  type: "overlap" | "out_of_bounds" | "unreachable" | "bad_aspect_ratio" | "low_coverage" | "adjacency_missing";
  severity: "error" | "warning";
  message: string;
  rooms: string[]; // room names involved
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  score: number; // 0-100, higher is better
}

const OVERLAP_TOLERANCE = 0.15; // meters — ignore overlaps smaller than this
const ADJACENCY_TOLERANCE = 0.3; // meters — rooms within this distance are "adjacent"

/**
 * Validate a set of positioned rooms against architectural rules.
 */
export function validateRoomLayout(
  rooms: PositionedRoomForValidation[],
  fpW: number,
  fpH: number,
  requiredAdjacency?: AdjacencyRequirement[],
  entranceRoom?: string,
): ValidationResult {
  const errors: ValidationError[] = [];
  let score = 100;

  // 1. Overlap detection
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.depth, b.y + b.depth) - Math.max(a.y, b.y);
      if (overlapX > OVERLAP_TOLERANCE && overlapY > OVERLAP_TOLERANCE) {
        const overlapArea = overlapX * overlapY;
        errors.push({
          type: "overlap",
          severity: "error",
          message: `"${a.name}" and "${b.name}" overlap by ${overlapArea.toFixed(1)}m² (${overlapX.toFixed(1)}m × ${overlapY.toFixed(1)}m)`,
          rooms: [a.name, b.name],
        });
        score -= 15;
      }
    }
  }

  // 2. Boundary check
  for (const r of rooms) {
    const issues: string[] = [];
    if (r.x < -0.1) issues.push(`x=${r.x.toFixed(1)} < 0`);
    if (r.y < -0.1) issues.push(`y=${r.y.toFixed(1)} < 0`);
    if (r.x + r.width > fpW + 0.2) issues.push(`right edge ${(r.x + r.width).toFixed(1)} > footprint width ${fpW}`);
    if (r.y + r.depth > fpH + 0.2) issues.push(`bottom edge ${(r.y + r.depth).toFixed(1)} > footprint depth ${fpH}`);
    if (issues.length > 0) {
      errors.push({
        type: "out_of_bounds",
        severity: "error",
        message: `"${r.name}" extends outside footprint: ${issues.join(", ")}`,
        rooms: [r.name],
      });
      score -= 10;
    }
  }

  // 3. Aspect ratio check (no room thinner than 1:3)
  for (const r of rooms) {
    const ratio = Math.max(r.width, r.depth) / Math.min(r.width, r.depth);
    if (ratio > 3.0 && r.type !== "hallway" && r.type !== "corridor" && r.type !== "balcony") {
      errors.push({
        type: "bad_aspect_ratio",
        severity: "warning",
        message: `"${r.name}" has extreme aspect ratio ${ratio.toFixed(1)}:1 (${r.width.toFixed(1)}m × ${r.depth.toFixed(1)}m)`,
        rooms: [r.name],
      });
      score -= 5;
    }
  }

  // 4. Area coverage (rooms should fill most of the footprint)
  const totalRoomArea = rooms.reduce((s, r) => s + r.width * r.depth, 0);
  const footprintArea = fpW * fpH;
  const coverage = totalRoomArea / footprintArea;
  if (coverage < 0.85) {
    errors.push({
      type: "low_coverage",
      severity: "warning",
      message: `Rooms cover only ${(coverage * 100).toFixed(0)}% of footprint (${totalRoomArea.toFixed(1)}m² / ${footprintArea.toFixed(1)}m²). ${((1 - coverage) * footprintArea).toFixed(1)}m² of gaps.`,
      rooms: [],
    });
    score -= 10;
  }

  // 5. Reachability (BFS from entrance)
  const adjacencyGraph = buildAdjacencyGraph(rooms);
  const startRoom = entranceRoom
    ? rooms.find(r => r.name.toLowerCase() === entranceRoom.toLowerCase())?.name
    : rooms[0]?.name;

  if (startRoom) {
    const visited = new Set<string>();
    const queue = [startRoom];
    visited.add(startRoom);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacencyGraph.get(current) ?? [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }
    const unreachable = rooms.filter(r => !visited.has(r.name));
    if (unreachable.length > 0) {
      errors.push({
        type: "unreachable",
        severity: "warning",
        message: `${unreachable.length} room(s) not reachable from "${startRoom}": ${unreachable.map(r => `"${r.name}"`).join(", ")}. Move them adjacent to a connected room.`,
        rooms: unreachable.map(r => r.name),
      });
      score -= 5 * unreachable.length;
    }
  }

  // 6. Required adjacency satisfaction
  if (requiredAdjacency && requiredAdjacency.length > 0) {
    for (const req of requiredAdjacency) {
      const neighbors = adjacencyGraph.get(req.roomA);
      if (!neighbors || !neighbors.has(req.roomB)) {
        errors.push({
          type: "adjacency_missing",
          severity: "warning",
          message: `Required adjacency missing: "${req.roomA}" ↔ "${req.roomB}" (${req.reason}). They must share a wall.`,
          rooms: [req.roomA, req.roomB],
        });
        score -= 5;
      }
    }
  }

  return {
    valid: errors.filter(e => e.severity === "error").length === 0,
    errors,
    score: Math.max(0, Math.min(100, score)),
  };
}

/**
 * Build adjacency graph: two rooms are adjacent if they share a wall edge
 * (their edges touch within tolerance and overlap for at least 0.5m).
 */
function buildAdjacencyGraph(rooms: PositionedRoomForValidation[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  for (const r of rooms) graph.set(r.name, new Set());

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      if (areAdjacent(a, b)) {
        graph.get(a.name)!.add(b.name);
        graph.get(b.name)!.add(a.name);
      }
    }
  }

  return graph;
}

function areAdjacent(a: PositionedRoomForValidation, b: PositionedRoomForValidation): boolean {
  // Check vertical shared wall (a's right edge ≈ b's left edge or vice versa)
  const verticalShared =
    (Math.abs((a.x + a.width) - b.x) < ADJACENCY_TOLERANCE ||
     Math.abs((b.x + b.width) - a.x) < ADJACENCY_TOLERANCE);
  if (verticalShared) {
    const yStart = Math.max(a.y, b.y);
    const yEnd = Math.min(a.y + a.depth, b.y + b.depth);
    if (yEnd - yStart > 0.5) return true;
  }

  // Check horizontal shared wall (a's bottom edge ≈ b's top edge or vice versa)
  const horizontalShared =
    (Math.abs((a.y + a.depth) - b.y) < ADJACENCY_TOLERANCE ||
     Math.abs((b.y + b.depth) - a.y) < ADJACENCY_TOLERANCE);
  if (horizontalShared) {
    const xStart = Math.max(a.x, b.x);
    const xEnd = Math.min(a.x + a.width, b.x + b.width);
    if (xEnd - xStart > 0.5) return true;
  }

  return false;
}

/**
 * Format validation errors as a string for GPT-4o retry prompt.
 */
export function formatValidationErrors(result: ValidationResult): string {
  if (result.errors.length === 0) return "Layout is valid.";

  const lines = result.errors.map(e => {
    const prefix = e.severity === "error" ? "ERROR" : "WARNING";
    return `[${prefix}] ${e.message}`;
  });

  return `Layout validation score: ${result.score}/100\n\nIssues found:\n${lines.join("\n")}`;
}
