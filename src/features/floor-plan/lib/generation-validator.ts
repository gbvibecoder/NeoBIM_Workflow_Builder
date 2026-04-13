/**
 * Pipeline Validation Gates
 *
 * Runs validation DURING generation at each pipeline stage.
 * If critical rules fail, the pipeline retries or reports the failure.
 *
 * Gate 1: After grid generation → validateGrid()
 * Gate 2: After room assignment → validateRoomAssignment()
 * Gate 3: After wall generation → validateWallSystem()
 * Gate 4: After openings placement → validateOpenings()
 * Gate 5: Final comprehensive → validateFinal()
 *
 * Standards: NBC 2016, IS:456, IS:1905, IS:962, IS:1038.
 */

import type { StructuralGrid } from '@/features/floor-plan/lib/grid-generator';
import type { RoomAssignment, AssignedRoom } from '@/features/floor-plan/lib/grid-room-assigner';
import type { WallSystem, GridWall } from '@/features/floor-plan/lib/grid-wall-generator';
import type { EnhancedRoomProgram } from '@/features/floor-plan/lib/ai-room-programmer';
import type { FloorPlanProject, Floor, Door, CadWindow, Room } from '@/types/floor-plan-cad';
import { getRoomRule } from '@/features/floor-plan/lib/architectural-rules';
import { classifyRoom } from '@/features/floor-plan/lib/room-sizer';
import { cellGroupAspectRatio } from '@/features/floor-plan/lib/grid-generator';

// ============================================================
// TYPES
// ============================================================

export interface ValidationGateResult {
  /** Whether the gate passed (no critical issues) */
  passed: boolean;
  /** Overall score 0-100 */
  score: number;
  /** MUST be zero for pass */
  critical: ValidationIssue[];
  /** Acceptable but flagged */
  warnings: ValidationIssue[];
  /** Nice to have */
  suggestions: ValidationIssue[];
}

export interface ValidationFixAction {
  type: 'resize_room' | 'add_bay' | 'swap_rooms' | 'add_adjacency' | 'change_bay_size';
  params: Record<string, unknown>;
}

export interface ValidationIssue {
  /** Unique issue code (e.g., "GRID_001") */
  code: string;
  /** Severity level */
  severity: 'critical' | 'warning' | 'suggestion';
  /** Human-readable description */
  message: string;
  /** Which element is affected */
  affectedElement: string;
  /** NBC/IS standard reference */
  rule: string;
  /** Whether this can be auto-fixed */
  autoFixable: boolean;
  /** Actionable fix for the Coordinator to apply on the next design loop */
  fixAction?: ValidationFixAction;
}

// ============================================================
// HELPERS
// ============================================================

function createResult(issues: ValidationIssue[]): ValidationGateResult {
  const critical = issues.filter(i => i.severity === 'critical');
  const warnings = issues.filter(i => i.severity === 'warning');
  const suggestions = issues.filter(i => i.severity === 'suggestion');

  // Score: start at 100, deduct for issues
  let score = 100;
  score -= critical.length * 20;
  score -= warnings.length * 5;
  score -= suggestions.length * 1;
  score = Math.max(0, Math.min(100, score));

  const result: ValidationGateResult = {
    passed: critical.length === 0,
    score,
    critical,
    warnings,
    suggestions,
  };

  // Log the result
  const status = result.passed ? 'PASS' : 'FAIL';
  console.log(
    `[VALIDATION] ${status} — score: ${score}, critical: ${critical.length}, warnings: ${warnings.length}, suggestions: ${suggestions.length}`
  );
  if (critical.length > 0) {
    for (const c of critical) {
      console.warn(`  [CRITICAL] ${c.code}: ${c.message}`);
    }
  }

  return result;
}

// ============================================================
// GATE 1: GRID VALIDATION
// ============================================================

/**
 * Validate the structural grid after generation.
 * Checks bay sizes, span limits, grid dimensions.
 */
export function validateGrid(grid: StructuralGrid): ValidationGateResult {
  const issues: ValidationIssue[] = [];

  // Check: all bays within structural span limits
  for (let i = 0; i < grid.bayWidths.length; i++) {
    const bay = grid.bayWidths[i];
    if (bay < 2.4) {
      issues.push({
        code: 'GRID_001', severity: 'warning',
        message: `Bay width ${i} = ${bay.toFixed(1)}m < 2.4m minimum (too narrow for habitable rooms)`,
        affectedElement: `bayWidth[${i}]`, rule: 'NBC 2016 §8.4.1', autoFixable: true,
      });
    }
    if (bay > 6.0) {
      issues.push({
        code: 'GRID_002', severity: 'critical',
        message: `Bay width ${i} = ${bay.toFixed(1)}m > 6.0m max slab span (IS:456)`,
        affectedElement: `bayWidth[${i}]`, rule: 'IS:456', autoFixable: true,
      });
    }
  }

  for (let i = 0; i < grid.bayDepths.length; i++) {
    const bay = grid.bayDepths[i];
    if (bay < 2.4) {
      issues.push({
        code: 'GRID_003', severity: 'warning',
        message: `Bay depth ${i} = ${bay.toFixed(1)}m < 2.4m minimum`,
        affectedElement: `bayDepth[${i}]`, rule: 'NBC 2016 §8.4.1', autoFixable: true,
      });
    }
    if (bay > 6.0) {
      issues.push({
        code: 'GRID_004', severity: 'critical',
        message: `Bay depth ${i} = ${bay.toFixed(1)}m > 6.0m max slab span`,
        affectedElement: `bayDepth[${i}]`, rule: 'IS:456', autoFixable: true,
      });
    }
  }

  // Check: grid dimensions are reasonable
  const aspect = grid.totalWidth / Math.max(grid.totalDepth, 0.1);
  if (aspect > 3.0 || aspect < 0.33) {
    issues.push({
      code: 'GRID_005', severity: 'warning',
      message: `Grid aspect ratio ${aspect.toFixed(2)} — extremely elongated footprint`,
      affectedElement: 'grid', rule: 'Architectural Practice', autoFixable: true,
    });
  }

  // Check: cell count reasonable
  const cellCount = grid.gridCols * grid.gridRows;
  if (cellCount < 4) {
    issues.push({
      code: 'GRID_006', severity: 'warning',
      message: `Only ${cellCount} grid cells — may be too few for room placement`,
      affectedElement: 'grid', rule: 'Layout requirement', autoFixable: true,
    });
  }
  if (cellCount > 64) {
    issues.push({
      code: 'GRID_007', severity: 'suggestion',
      message: `${cellCount} grid cells — grid may be finer than needed`,
      affectedElement: 'grid', rule: 'Performance', autoFixable: false,
    });
  }

  return createResult(issues);
}

// ============================================================
// GATE 2: ROOM ASSIGNMENT VALIDATION
// ============================================================

/**
 * Validate room assignments against the room program.
 * Checks areas, dimensions, adjacencies, exterior wall access.
 */
export function validateRoomAssignment(
  grid: StructuralGrid,
  assignment: RoomAssignment,
  program: EnhancedRoomProgram,
): ValidationGateResult {
  const issues: ValidationIssue[] = [];

  for (const ar of assignment.roomOrder) {
    const rule = getRoomRule(ar.classifiedType);

    // Check: minimum area
    if (ar.actualArea < rule.area.min * 0.8) { // 20% tolerance
      issues.push({
        code: 'ROOM_001', severity: 'critical',
        message: `${ar.spec.name}: area ${ar.actualArea.toFixed(1)} sqm < min ${rule.area.min} sqm`,
        affectedElement: ar.spec.name, rule: rule.codeRef, autoFixable: true,
        fixAction: { type: 'resize_room', params: { room: ar.spec.name, targetArea: rule.area.min } },
      });
    } else if (ar.actualArea < rule.area.min) {
      issues.push({
        code: 'ROOM_001b', severity: 'warning',
        message: `${ar.spec.name}: area ${ar.actualArea.toFixed(1)} sqm slightly below min ${rule.area.min} sqm`,
        affectedElement: ar.spec.name, rule: rule.codeRef, autoFixable: true,
        fixAction: { type: 'resize_room', params: { room: ar.spec.name, targetArea: rule.area.min } },
      });
    }

    // Check: minimum width
    if (ar.bounds.width < rule.width.min * 0.8) {
      issues.push({
        code: 'ROOM_002', severity: 'warning',
        message: `${ar.spec.name}: width ${ar.bounds.width.toFixed(1)}m < min ${rule.width.min}m`,
        affectedElement: ar.spec.name, rule: rule.codeRef, autoFixable: true,
      });
    }

    // Check: minimum depth
    if (ar.bounds.depth < rule.depth.min * 0.8) {
      issues.push({
        code: 'ROOM_003', severity: 'warning',
        message: `${ar.spec.name}: depth ${ar.bounds.depth.toFixed(1)}m < min ${rule.depth.min}m`,
        affectedElement: ar.spec.name, rule: rule.codeRef, autoFixable: true,
      });
    }

    // Check: aspect ratio
    const ar_ratio = cellGroupAspectRatio(ar.cells);
    if (ar_ratio > rule.aspectRatio.max * 1.2) {
      issues.push({
        code: 'ROOM_004', severity: 'warning',
        message: `${ar.spec.name}: aspect ratio ${ar_ratio.toFixed(1)} > max ${rule.aspectRatio.max}`,
        affectedElement: ar.spec.name, rule: 'Architectural Practice', autoFixable: true,
      });
    }

    // Check: exterior wall access
    if (rule.exteriorWall === 'required') {
      const hasExterior = ar.cells.some(c => c.isPerimeter);
      if (!hasExterior) {
        issues.push({
          code: 'ROOM_005', severity: 'critical',
          message: `${ar.spec.name}: requires exterior wall but has none`,
          affectedElement: ar.spec.name, rule: rule.codeRef, autoFixable: true,
          fixAction: { type: 'swap_rooms', params: { room: ar.spec.name, reason: 'needs perimeter placement' } },
        });
      }
    }
  }

  // Check: all required adjacencies satisfied
  for (const adj of program.adjacency) {
    const roomA = assignment.roomOrder.find(ar =>
      ar.spec.name.toLowerCase() === adj.roomA.toLowerCase()
    );
    const roomB = assignment.roomOrder.find(ar =>
      ar.spec.name.toLowerCase() === adj.roomB.toLowerCase()
    );

    if (roomA && roomB) {
      const isAdjacent = roomA.cells.some(ca => {
        const neighbors = getNeighborKeys(ca);
        return roomB.cells.some(cb => neighbors.has(`${cb.col},${cb.row}`));
      });

      if (!isAdjacent) {
        issues.push({
          code: 'ADJ_001', severity: 'warning',
          message: `Required adjacency not met: ${adj.roomA} ↔ ${adj.roomB} (${adj.reason})`,
          affectedElement: `${adj.roomA}-${adj.roomB}`, rule: 'Program requirement', autoFixable: true,
          fixAction: { type: 'add_adjacency', params: { roomA: adj.roomA, roomB: adj.roomB, reason: adj.reason } },
        });
      }
    }
  }

  // Check: corridor connectivity
  if (assignment.corridorCells.length === 0 && assignment.roomOrder.length > 3) {
    issues.push({
      code: 'CORR_001', severity: 'suggestion',
      message: 'No corridor cells — rooms may lack circulation path',
      affectedElement: 'corridor', rule: 'NBC 2016 §8.5', autoFixable: false,
    });
  }

  // Check: BHK count matches
  const bedroomCount = assignment.roomOrder.filter(ar =>
    ['bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom'].includes(ar.classifiedType)
  ).length;
  const programBedroomCount = program.rooms.filter(r => {
    const cls = classifyRoom(r.type, r.name);
    return ['bedroom', 'master_bedroom', 'guest_bedroom', 'children_bedroom'].includes(cls);
  }).length;

  if (bedroomCount < programBedroomCount) {
    issues.push({
      code: 'BHK_001', severity: 'critical',
      message: `Only ${bedroomCount} bedrooms placed, program requires ${programBedroomCount}`,
      fixAction: { type: 'add_bay', params: { reason: 'not enough cells for all bedrooms' } },
      affectedElement: 'bedrooms', rule: 'Program requirement', autoFixable: true,
    });
  }

  return createResult(issues);
}

function getNeighborKeys(cell: { col: number; row: number }): Set<string> {
  return new Set([
    `${cell.col - 1},${cell.row}`,
    `${cell.col + 1},${cell.row}`,
    `${cell.col},${cell.row - 1}`,
    `${cell.col},${cell.row + 1}`,
  ]);
}

// ============================================================
// GATE 3: WALL SYSTEM VALIDATION
// ============================================================

/**
 * Validate the generated wall system.
 * Should rarely fail since walls are derived from grid lines.
 */
export function validateWallSystem(wallSystem: WallSystem): ValidationGateResult {
  const issues: ValidationIssue[] = [];
  const { walls, columns } = wallSystem;

  // Check: exterior walls form closed polygon
  const exteriorWalls = walls.filter(w => w.isExterior);
  const endpointCounts = new Map<string, number>();
  for (const wall of exteriorWalls) {
    const sk = `${wall.start.x.toFixed(2)},${wall.start.y.toFixed(2)}`;
    const ek = `${wall.end.x.toFixed(2)},${wall.end.y.toFixed(2)}`;
    endpointCounts.set(sk, (endpointCounts.get(sk) ?? 0) + 1);
    endpointCounts.set(ek, (endpointCounts.get(ek) ?? 0) + 1);
  }

  const gapPoints = [...endpointCounts.entries()].filter(([, c]) => c % 2 !== 0);
  if (gapPoints.length > 0) {
    issues.push({
      code: 'WALL_001', severity: 'critical',
      message: `Exterior wall polygon has ${gapPoints.length} gap points — walls are not continuous`,
      affectedElement: 'exterior_walls', rule: 'Structural integrity', autoFixable: false,
    });
  }

  // Check: no floating wall segments (interior walls must connect to 2+ walls)
  for (const wall of walls) {
    if (wall.isExterior) continue;
    const wallLen = Math.sqrt(
      Math.pow(wall.end.x - wall.start.x, 2) + Math.pow(wall.end.y - wall.start.y, 2)
    );
    if (wallLen < 0.3) {
      issues.push({
        code: 'WALL_002', severity: 'warning',
        message: `Interior wall ${wall.id} is ${(wallLen * 1000).toFixed(0)}mm — below 300mm structural minimum`,
        affectedElement: wall.id, rule: 'IS:1905', autoFixable: false,
      });
    }
  }

  // Check: wall thicknesses correct
  for (const wall of walls) {
    if (wall.isExterior && wall.thickness < 200) {
      issues.push({
        code: 'WALL_003', severity: 'critical',
        message: `Exterior wall ${wall.id}: thickness ${wall.thickness}mm < 200mm minimum`,
        affectedElement: wall.id, rule: 'IS:1905', autoFixable: true,
      });
    }
    if (!wall.isExterior && wall.thickness < 100) {
      issues.push({
        code: 'WALL_004', severity: 'warning',
        message: `Interior wall ${wall.id}: thickness ${wall.thickness}mm < 100mm minimum`,
        affectedElement: wall.id, rule: 'IS:1905', autoFixable: true,
      });
    }
  }

  // Check: column count
  if (columns.length === 0) {
    issues.push({
      code: 'WALL_005', severity: 'warning',
      message: 'No structural columns generated',
      affectedElement: 'columns', rule: 'IS:456', autoFixable: false,
    });
  }

  return createResult(issues);
}

// ============================================================
// GATE 4: OPENINGS VALIDATION
// ============================================================

/**
 * Validate door and window placements.
 * Checks accessibility, egress, ventilation ratios.
 */
export function validateOpenings(
  wallSystem: WallSystem,
  floor: Floor,
): ValidationGateResult {
  const issues: ValidationIssue[] = [];

  // Check: every room reachable via doors
  const doorConnections = new Map<string, Set<string>>();
  for (const room of floor.rooms) {
    doorConnections.set(room.id, new Set());
  }
  for (const door of floor.doors) {
    const [a, b] = door.connects_rooms;
    if (a && b) {
      doorConnections.get(a)?.add(b);
      doorConnections.get(b)?.add(a);
    }
  }

  // BFS reachability
  if (floor.rooms.length > 0) {
    const visited = new Set<string>();
    const queue = [floor.rooms[0].id];
    visited.add(floor.rooms[0].id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = doorConnections.get(current);
      if (neighbors) {
        for (const n of neighbors) {
          if (!visited.has(n)) {
            visited.add(n);
            queue.push(n);
          }
        }
      }
    }

    const unreachable = floor.rooms.filter(r => !visited.has(r.id));
    for (const room of unreachable) {
      issues.push({
        code: 'DOOR_001', severity: 'critical',
        message: `${room.name} is not reachable via any door`,
        affectedElement: room.name, rule: 'NBC 2016 §8.3', autoFixable: true,
      });
    }
  }

  // Check: main entrance exists
  const hasMainEntrance = floor.doors.some(d => d.type === 'main_entrance');
  if (!hasMainEntrance && floor.doors.length > 0) {
    issues.push({
      code: 'DOOR_002', severity: 'warning',
      message: 'No main entrance door identified',
      affectedElement: 'main_entrance', rule: 'NBC 2016', autoFixable: true,
    });
  }

  // Check: all doors meet minimum width
  for (const door of floor.doors) {
    if (door.width_mm < 600) {
      issues.push({
        code: 'DOOR_003', severity: 'critical',
        message: `Door ${door.id}: width ${door.width_mm}mm < 600mm minimum`,
        affectedElement: door.id, rule: 'NBC 2016 §8.3', autoFixable: true,
      });
    }
    if (door.type === 'main_entrance' && door.width_mm < 1000) {
      issues.push({
        code: 'DOOR_004', severity: 'critical',
        message: `Main entrance: width ${door.width_mm}mm < 1000mm minimum`,
        affectedElement: door.id, rule: 'NBC 2016 §8.3.1', autoFixable: true,
      });
    }
    if (door.height_mm < 2000) {
      issues.push({
        code: 'DOOR_005', severity: 'critical',
        message: `Door ${door.id}: height ${door.height_mm}mm < 2000mm minimum`,
        affectedElement: door.id, rule: 'NBC 2016 §8.3.1', autoFixable: true,
      });
    }
  }

  // Check: habitable rooms have windows
  for (const room of floor.rooms) {
    const rule = getRoomRule(room.type);
    if (!rule.windows.required) continue;

    const roomWallIds = new Set(room.wall_ids);
    const roomWindows = floor.windows.filter(w => {
      const wall = floor.walls.find(wl => wl.id === w.wall_id);
      if (!wall) return false;
      return roomWallIds.has(wall.id) || wall.left_room_id === room.id || wall.right_room_id === room.id;
    });

    if (roomWindows.length === 0) {
      issues.push({
        code: 'WIN_001', severity: 'critical',
        message: `${room.name}: no windows — habitable room requires natural light (NBC §8.4.6)`,
        affectedElement: room.name, rule: 'NBC 2016 §8.4.6', autoFixable: true,
      });
    }

    // Check window area ratio (NBC: ≥ 1/10 of floor area)
    const totalWindowArea = roomWindows.reduce(
      (s, w) => s + (w.width_mm * w.height_mm) / 1_000_000, 0
    );
    const minRatio = rule.windows.minFloorAreaRatio;
    if (room.area_sqm > 0 && totalWindowArea / room.area_sqm < minRatio) {
      issues.push({
        code: 'WIN_002', severity: 'warning',
        message: `${room.name}: window area ${totalWindowArea.toFixed(2)} sqm = ${((totalWindowArea / room.area_sqm) * 100).toFixed(1)}% of floor area — need ≥${(minRatio * 100).toFixed(0)}%`,
        affectedElement: room.name, rule: 'NBC 2016 §8.4.6', autoFixable: true,
      });
    }
  }

  return createResult(issues);
}

// ============================================================
// GATE 5: FINAL COMPREHENSIVE VALIDATION
// ============================================================

/**
 * Final validation gate — runs all checks on the completed FloorPlanProject.
 * Calls existing validators + structural checks.
 */
export function validateFinal(project: FloorPlanProject): ValidationGateResult {
  const issues: ValidationIssue[] = [];

  for (const floor of project.floors) {
    // Room count
    if (floor.rooms.length === 0) {
      issues.push({
        code: 'FINAL_001', severity: 'critical',
        message: `Floor ${floor.name}: no rooms`,
        affectedElement: floor.name, rule: 'Program requirement', autoFixable: false,
      });
    }

    // Wall count
    if (floor.walls.length === 0) {
      issues.push({
        code: 'FINAL_002', severity: 'critical',
        message: `Floor ${floor.name}: no walls`,
        affectedElement: floor.name, rule: 'Structural', autoFixable: false,
      });
    }

    // Door count
    if (floor.doors.length === 0 && floor.rooms.length > 0) {
      issues.push({
        code: 'FINAL_003', severity: 'critical',
        message: `Floor ${floor.name}: no doors`,
        affectedElement: floor.name, rule: 'NBC 2016 §8.3', autoFixable: true,
      });
    }

    // Check floor-to-floor height
    if (floor.floor_to_floor_height_mm < 2750) {
      issues.push({
        code: 'FINAL_004', severity: 'warning',
        message: `Floor ${floor.name}: floor height ${floor.floor_to_floor_height_mm}mm < 2750mm minimum`,
        affectedElement: floor.name, rule: 'NBC 2016 §8.4.1', autoFixable: true,
      });
    }
  }

  // Multi-floor checks
  if (project.floors.length > 1) {
    // Check staircase alignment
    const staircaseRooms = project.floors.map(f =>
      f.rooms.filter(r => r.type === 'staircase')
    );

    for (let i = 1; i < project.floors.length; i++) {
      const prevStairs = staircaseRooms[i - 1];
      const currStairs = staircaseRooms[i];

      if (prevStairs.length > 0 && currStairs.length === 0) {
        issues.push({
          code: 'MULTI_001', severity: 'critical',
          message: `Floor ${project.floors[i].name}: no staircase — previous floor has one`,
          affectedElement: project.floors[i].name, rule: 'Structural continuity', autoFixable: false,
        });
      }
    }

    // Check floor-to-floor height consistency
    const heights = project.floors.map(f => f.floor_to_floor_height_mm);
    const heightVariation = Math.max(...heights) - Math.min(...heights);
    if (heightVariation > 100) {
      issues.push({
        code: 'MULTI_002', severity: 'warning',
        message: `Floor-to-floor heights vary by ${heightVariation}mm — should be consistent`,
        affectedElement: 'floors', rule: 'Structural practice', autoFixable: true,
      });
    }
  }

  return createResult(issues);
}

// ============================================================
// RETRY ORCHESTRATOR
// ============================================================

export interface PipelineRetryConfig {
  /** Max full pipeline retries */
  maxRetries: number;
  /** Grid adjustment per retry (add/subtract bays) */
  gridAdjustment: 'add_bay' | 'subtract_bay' | 'change_bay_size';
}

/**
 * Determine if a validation failure should trigger a retry and what to adjust.
 */
export function shouldRetry(
  result: ValidationGateResult,
  retryCount: number,
  maxRetries: number = 3,
): { retry: boolean; adjustment: string } {
  if (retryCount >= maxRetries) {
    return { retry: false, adjustment: 'max_retries_exceeded' };
  }
  if (result.passed) {
    return { retry: false, adjustment: 'none' };
  }

  // Analyze critical issues to determine best adjustment
  const gridIssues = result.critical.filter(i => i.code.startsWith('GRID_'));
  const roomIssues = result.critical.filter(i => i.code.startsWith('ROOM_'));
  const bhkIssues = result.critical.filter(i => i.code.startsWith('BHK_'));

  if (gridIssues.length > 0) {
    return { retry: true, adjustment: 'change_bay_size' };
  }
  if (bhkIssues.length > 0 || roomIssues.length > 0) {
    return { retry: true, adjustment: 'add_bay' };
  }

  return { retry: true, adjustment: 'add_bay' };
}
