/**
 * Building Code Validator
 *
 * Validates a floor plan against NBC 2016 building code rules.
 * Checks room sizes, corridor widths, door dimensions, window ratios,
 * stair compliance, and accessibility requirements.
 */

import type { Floor, Room, Door, CadWindow, Stair, Wall } from "@/types/floor-plan-cad";
import { polygonBounds, polygonCentroid, wallLength, lineDirection, addPoints, scalePoint } from "@/lib/floor-plan/geometry";
import {
  ALL_BUILDING_CODE_RULES,
  CODE_CATEGORY_LABELS,
  type BuildingCodeRule,
  type CodeCategory,
  type CodeSeverity,
  type CodeViolation,
} from "@/features/floor-plan/lib/building-code-rules";

// ============================================================
// TYPES
// ============================================================

export interface CodeReport {
  total_checks: number;
  passes: number;
  errors: number;
  warnings: number;
  infos: number;
  violations: CodeViolation[];
  /** Grouped by category */
  by_category: Record<CodeCategory, CodeViolation[]>;
  summary: string;
}

// ============================================================
// MAIN VALIDATOR
// ============================================================

export function validateBuildingCode(
  floor: Floor,
  projectType: string = "residential"
): CodeReport {
  const violations: CodeViolation[] = [];
  let totalChecks = 0;

  // ---- Room Size Checks ----
  totalChecks += checkRoomSizes(floor, violations);

  // ---- Corridor Width Checks ----
  totalChecks += checkCorridorWidths(floor, projectType, violations);

  // ---- Door Checks ----
  totalChecks += checkDoors(floor, violations);

  // ---- Window / Ventilation Checks ----
  totalChecks += checkWindows(floor, violations);
  totalChecks += checkVentilationRatio(floor, violations);

  // ---- Stair Checks ----
  totalChecks += checkStairs(floor, violations);
  totalChecks += checkStairFormula(floor, violations);

  // ---- Ceiling Height Checks ----
  totalChecks += checkCeilingHeight(floor, violations);

  // ---- Enhanced Checks (Sprint 4) ----
  totalChecks += checkKitchenVentilation(floor, violations);
  totalChecks += checkBathroomWaterproofing(floor, violations);
  totalChecks += checkBalconyRailing(floor, violations);
  totalChecks += checkAccessibleEntrance(floor, violations);
  totalChecks += checkNaturalLightRatio(floor, violations);
  totalChecks += checkFireEgressDistance(floor, violations);

  // ---- Previously missing checks (Phase 1 accuracy fix) ----
  totalChecks += checkBathroomDoorWidth(floor, violations);
  totalChecks += checkStairHeadroom(floor, violations);
  totalChecks += checkMultiUnitStairWidth(floor, projectType, violations);
  totalChecks += checkWheelchairCorridor(floor, violations);
  totalChecks += checkAccessibleBathroom(floor, violations);
  totalChecks += checkFireEscapeRouteWidth(floor, violations);

  // Group by category
  const byCategory: Record<CodeCategory, CodeViolation[]> = {
    room_size: [],
    corridor: [],
    door: [],
    window_ventilation: [],
    stair: [],
    accessibility: [],
    fire_safety: [],
    structural: [],
  };
  for (const v of violations) {
    byCategory[v.rule.category].push(v);
  }

  const errors = violations.filter((v) => v.severity === "error").length;
  const warnings = violations.filter((v) => v.severity === "warning").length;
  const infos = violations.filter((v) => v.severity === "info").length;

  let summary: string;
  if (errors === 0 && warnings === 0) {
    summary = "All NBC 2016 checks passed. Floor plan is code-compliant.";
  } else if (errors === 0) {
    summary = `${warnings} warning(s) found. No critical violations.`;
  } else {
    summary = `${errors} error(s) and ${warnings} warning(s) found. Action required.`;
  }

  return {
    total_checks: totalChecks,
    passes: totalChecks - violations.length,
    errors,
    warnings,
    infos,
    violations,
    by_category: byCategory,
    summary,
  };
}

// ============================================================
// ROOM SIZE VALIDATOR
// ============================================================

function checkRoomSizes(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;

  for (const room of floor.rooms) {
    // Min area check
    const areaRules = ALL_BUILDING_CODE_RULES.filter(
      (r) => r.id.startsWith("NBC-RS") &&
        r.parameters.min_area_sqm !== undefined &&
        (r.room_types.length === 0 || r.room_types.includes(room.type))
    );

    for (const rule of areaRules) {
      checks++;
      const minArea = rule.parameters.min_area_sqm as number;
      if (room.area_sqm < minArea) {
        violations.push({
          rule_id: rule.id,
          rule,
          entity_type: "room",
          entity_id: room.id,
          entity_name: room.name,
          severity: rule.severity,
          message: `${room.name} area (${room.area_sqm.toFixed(1)} sq.m) is below minimum ${minArea} sq.m.`,
          actual_value: `${room.area_sqm.toFixed(1)} sq.m`,
          required_value: `${minArea} sq.m`,
          suggestion: `Increase ${room.name} area by ${(minArea - room.area_sqm).toFixed(1)} sq.m.`,
        });
      }
    }

    // Min width check
    const widthRules = ALL_BUILDING_CODE_RULES.filter(
      (r) => r.id.startsWith("NBC-RS") &&
        r.parameters.min_width_mm !== undefined &&
        (r.room_types.length === 0 || r.room_types.includes(room.type))
    );

    for (const rule of widthRules) {
      checks++;
      const minWidth = rule.parameters.min_width_mm as number;
      const bounds = polygonBounds(room.boundary.points);
      const roomMinDim = Math.min(bounds.width, bounds.height);

      if (roomMinDim < minWidth) {
        violations.push({
          rule_id: rule.id,
          rule,
          entity_type: "room",
          entity_id: room.id,
          entity_name: room.name,
          severity: rule.severity,
          message: `${room.name} minimum dimension (${(roomMinDim / 1000).toFixed(2)} m) is below ${(minWidth / 1000).toFixed(1)} m.`,
          actual_value: `${(roomMinDim / 1000).toFixed(2)} m`,
          required_value: `${(minWidth / 1000).toFixed(1)} m`,
          suggestion: `Widen ${room.name} to at least ${(minWidth / 1000).toFixed(1)} m.`,
        });
      }
    }
  }

  return checks;
}

// ============================================================
// CORRIDOR WIDTH VALIDATOR
// ============================================================

function checkCorridorWidths(
  floor: Floor,
  projectType: string,
  violations: CodeViolation[]
): number {
  let checks = 0;
  const corridors = floor.rooms.filter((r) =>
    ["corridor", "lobby", "foyer"].includes(r.type)
  );

  for (const corridor of corridors) {
    const isCommercial = ["commercial", "institutional"].includes(projectType);
    const rule = ALL_BUILDING_CODE_RULES.find(
      (r) => r.id === (isCommercial ? "NBC-CR-002" : "NBC-CR-001")
    );
    if (!rule) continue;

    checks++;
    const minWidth = rule.parameters.min_width_mm as number;
    const bounds = polygonBounds(corridor.boundary.points);
    const corridorWidth = Math.min(bounds.width, bounds.height);

    if (corridorWidth < minWidth) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "corridor",
        entity_id: corridor.id,
        entity_name: corridor.name,
        severity: rule.severity,
        message: `${corridor.name} width (${(corridorWidth / 1000).toFixed(2)} m) is below minimum ${(minWidth / 1000).toFixed(1)} m.`,
        actual_value: `${(corridorWidth / 1000).toFixed(2)} m`,
        required_value: `${(minWidth / 1000).toFixed(1)} m`,
        suggestion: `Widen ${corridor.name} to at least ${(minWidth / 1000).toFixed(1)} m.`,
      });
    }
  }

  return checks;
}

// ============================================================
// DOOR VALIDATOR
// ============================================================

function checkDoors(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;

  for (const door of floor.doors) {
    // Main entrance minimum width
    if (door.type === "main_entrance") {
      const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-DR-001");
      if (rule) {
        checks++;
        const minW = rule.parameters.min_width_mm as number;
        if (door.width_mm < minW) {
          violations.push({
            rule_id: rule.id,
            rule,
            entity_type: "door",
            entity_id: door.id,
            entity_name: `Main Entrance`,
            severity: rule.severity,
            message: `Main entrance width (${door.width_mm} mm) is below minimum ${minW} mm.`,
            actual_value: `${door.width_mm} mm`,
            required_value: `${minW} mm`,
            suggestion: `Widen main entrance to at least ${minW} mm.`,
          });
        }
      }
    } else {
      // Internal door minimum width
      const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-DR-002");
      if (rule) {
        checks++;
        const minW = rule.parameters.min_width_mm as number;
        if (door.width_mm < minW) {
          violations.push({
            rule_id: rule.id,
            rule,
            entity_type: "door",
            entity_id: door.id,
            entity_name: `Door (${door.type.replace(/_/g, " ")})`,
            severity: rule.severity,
            message: `Door width (${door.width_mm} mm) is below minimum ${minW} mm.`,
            actual_value: `${door.width_mm} mm`,
            required_value: `${minW} mm`,
            suggestion: `Increase door width to at least ${minW} mm.`,
          });
        }
      }
    }

    // Door height check
    const heightRule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-DR-003");
    if (heightRule) {
      checks++;
      const minH = heightRule.parameters.min_height_mm as number;
      if (door.height_mm < minH) {
        violations.push({
          rule_id: heightRule.id,
          rule: heightRule,
          entity_type: "door",
          entity_id: door.id,
          entity_name: `Door (${door.type.replace(/_/g, " ")})`,
          severity: heightRule.severity,
          message: `Door height (${door.height_mm} mm) is below minimum ${minH} mm.`,
          actual_value: `${door.height_mm} mm`,
          required_value: `${minH} mm`,
          suggestion: `Increase door height to at least ${minH} mm.`,
        });
      }
    }
  }

  return checks;
}

// ============================================================
// WINDOW / VENTILATION VALIDATOR
// ============================================================

function checkWindows(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;

  // Window-to-floor area ratio per room
  const ratioRule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-WV-001");
  if (ratioRule) {
    const applicableRooms = floor.rooms.filter(
      (r) => ratioRule.room_types.length === 0 || ratioRule.room_types.includes(r.type)
    );

    for (const room of applicableRooms) {
      checks++;
      // Find windows on walls bounding this room
      const roomWallIds = new Set(room.wall_ids);
      const roomWindows = floor.windows.filter((w) => roomWallIds.has(w.wall_id));
      // NBC 2016 Cl. 8.4.6 specifies "opening area" (gross window opening), not glazed area.
      // No frame factor applied — the full window width × height counts as the opening.
      const totalWindowArea = roomWindows.reduce(
        (sum, w) => sum + (w.width_mm * w.height_mm) / 1_000_000,
        0
      );
      const floorArea = room.area_sqm;
      const ratio = floorArea > 0 ? totalWindowArea / floorArea : 0;
      const minRatio = ratioRule.parameters.min_ratio as number;

      if (ratio < minRatio) {
        violations.push({
          rule_id: ratioRule.id,
          rule: ratioRule,
          entity_type: "room",
          entity_id: room.id,
          entity_name: room.name,
          severity: ratioRule.severity,
          message: `${room.name} window-to-floor ratio (${(ratio * 100).toFixed(1)}%) is below ${(minRatio * 100).toFixed(0)}%.`,
          actual_value: `${(ratio * 100).toFixed(1)}% (${totalWindowArea.toFixed(2)} sq.m window / ${floorArea.toFixed(1)} sq.m floor)`,
          required_value: `${(minRatio * 100).toFixed(0)}%`,
          suggestion: `Add ${((minRatio * floorArea - totalWindowArea) * 1_000_000).toFixed(0)} sq.mm more window area to ${room.name}.`,
        });
      }
    }
  }

  // Bathroom ventilation
  const bathVentRule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-WV-003");
  if (bathVentRule) {
    const bathrooms = floor.rooms.filter((r) =>
      ["bathroom", "toilet", "wc"].includes(r.type)
    );
    for (const bath of bathrooms) {
      checks++;
      const bathWallIds = new Set(bath.wall_ids);
      const bathWindows = floor.windows.filter((w) => bathWallIds.has(w.wall_id));
      const totalVent = bathWindows.reduce(
        (sum, w) => sum + (w.width_mm * w.height_mm) / 1_000_000,
        0
      );
      const minOpening = bathVentRule.parameters.min_opening_sqm as number;

      if (totalVent < minOpening) {
        violations.push({
          rule_id: bathVentRule.id,
          rule: bathVentRule,
          entity_type: "room",
          entity_id: bath.id,
          entity_name: bath.name,
          severity: bathVentRule.severity,
          message: `${bath.name} ventilation opening (${totalVent.toFixed(2)} sq.m) is below ${minOpening} sq.m.`,
          actual_value: `${totalVent.toFixed(2)} sq.m`,
          required_value: `${minOpening} sq.m`,
          suggestion: `Add ventilation opening or mechanical exhaust to ${bath.name}.`,
        });
      }
    }
  }

  return checks;
}

// ============================================================
// STAIR VALIDATOR
// ============================================================

function checkStairs(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;

  for (const stair of floor.stairs) {
    // Width check
    const widthRule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-ST-001");
    if (widthRule) {
      checks++;
      const minW = widthRule.parameters.min_width_mm as number;
      if (stair.width_mm < minW) {
        violations.push({
          rule_id: widthRule.id,
          rule: widthRule,
          entity_type: "stair",
          entity_id: stair.id,
          entity_name: `Staircase (${stair.type})`,
          severity: widthRule.severity,
          message: `Stair width (${stair.width_mm} mm) is below minimum ${minW} mm.`,
          actual_value: `${stair.width_mm} mm`,
          required_value: `${minW} mm`,
          suggestion: `Widen staircase to at least ${minW} mm.`,
        });
      }
    }

    // Riser height
    const riserRule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-ST-002");
    if (riserRule) {
      checks++;
      const maxRiser = riserRule.parameters.max_riser_mm as number;
      if (stair.riser_height_mm > maxRiser) {
        violations.push({
          rule_id: riserRule.id,
          rule: riserRule,
          entity_type: "stair",
          entity_id: stair.id,
          entity_name: `Staircase (${stair.type})`,
          severity: riserRule.severity,
          message: `Stair riser height (${stair.riser_height_mm} mm) exceeds maximum ${maxRiser} mm.`,
          actual_value: `${stair.riser_height_mm} mm`,
          required_value: `max ${maxRiser} mm`,
          suggestion: `Reduce riser height and add more steps.`,
        });
      }
    }

    // Tread depth
    const treadRule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-ST-003");
    if (treadRule) {
      checks++;
      const minTread = treadRule.parameters.min_tread_mm as number;
      if (stair.tread_depth_mm < minTread) {
        violations.push({
          rule_id: treadRule.id,
          rule: treadRule,
          entity_type: "stair",
          entity_id: stair.id,
          entity_name: `Staircase (${stair.type})`,
          severity: treadRule.severity,
          message: `Stair tread depth (${stair.tread_depth_mm} mm) is below minimum ${minTread} mm.`,
          actual_value: `${stair.tread_depth_mm} mm`,
          required_value: `min ${minTread} mm`,
          suggestion: `Increase tread depth to at least ${minTread} mm.`,
        });
      }
    }
  }

  return checks;
}

// ============================================================
// CEILING HEIGHT
// ============================================================

function checkCeilingHeight(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-RS-007");
  if (!rule) return 0;

  checks++;
  const minH = rule.parameters.min_height_mm as number;
  // Clear ceiling height = floor-to-floor minus slab thickness minus floor finishes (~50mm)
  const FLOOR_FINISH_MM = 50;
  const ceilingHeight = floor.floor_to_floor_height_mm - floor.slab_thickness_mm - FLOOR_FINISH_MM;

  if (ceilingHeight < minH) {
    violations.push({
      rule_id: rule.id,
      rule,
      entity_type: "floor",
      entity_id: floor.id,
      entity_name: floor.name,
      severity: rule.severity,
      message: `Floor ceiling height (${ceilingHeight} mm) is below minimum ${minH} mm.`,
      actual_value: `${ceilingHeight} mm`,
      required_value: `${minH} mm`,
      suggestion: `Increase floor-to-floor height or reduce slab thickness.`,
    });
  }

  return checks;
}

// ============================================================
// KITCHEN VENTILATION (NBC-WV-005)
// ============================================================

function checkKitchenVentilation(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-WV-005");
  if (!rule) return 0;

  const kitchens = floor.rooms.filter((r) => r.type === "kitchen");
  for (const kitchen of kitchens) {
    checks++;
    const hasExterior = floor.walls.some(
      (w) => w.type === "exterior" && (w.left_room_id === kitchen.id || w.right_room_id === kitchen.id)
    );
    const hasWindow = floor.windows.some((win) => {
      const wall = floor.walls.find((w) => w.id === win.wall_id);
      return wall && (wall.left_room_id === kitchen.id || wall.right_room_id === kitchen.id);
    });

    if (!hasExterior || !hasWindow) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "room",
        entity_id: kitchen.id,
        entity_name: kitchen.name,
        severity: rule.severity,
        message: `${kitchen.name} lacks natural ventilation — no window on exterior wall.`,
        actual_value: hasExterior ? "Exterior wall exists, no window" : "No exterior wall",
        required_value: "Window or exhaust on exterior wall",
        suggestion: hasExterior ? "Add a window on the exterior wall" : "Kitchen requires an exterior wall for ventilation or a mechanical exhaust system.",
      });
    }
  }
  return checks;
}

// ============================================================
// BATHROOM WATERPROOFING (NBC-WV-006)
// ============================================================

function checkBathroomWaterproofing(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-WV-006");
  if (!rule) return 0;

  // Waterproofing is a construction detail, not a plan-level geometry check.
  // Only flag once as a general note if bathrooms exist, not per-bathroom.
  const bathrooms = floor.rooms.filter((r) => ["bathroom", "toilet", "wc"].includes(r.type));
  if (bathrooms.length > 0) {
    checks++;
    violations.push({
      rule_id: rule.id,
      rule,
      entity_type: "room",
      entity_id: bathrooms[0].id,
      entity_name: `${bathrooms.length} bathroom(s)`,
      severity: "info",
      message: `${bathrooms.length} bathroom(s) require waterproofing treatment per NBC specification — include in construction notes.`,
      actual_value: "Construction specification",
      required_value: "Waterproofing up to 150mm above FFL",
      suggestion: "Add waterproofing note to construction drawing for all wet areas.",
    });
  }
  return checks;
}

// ============================================================
// BALCONY RAILING (NBC-FS-003)
// ============================================================

function checkBalconyRailing(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-FS-003");
  if (!rule) return 0;

  // Railing is a construction detail — flag once as a general note if balconies exist.
  const balconies = floor.rooms.filter((r) => ["balcony", "terrace"].includes(r.type));
  if (balconies.length > 0) {
    checks++;
    violations.push({
      rule_id: rule.id,
      rule,
      entity_type: "room",
      entity_id: balconies[0].id,
      entity_name: `${balconies.length} balcony/terrace(s)`,
      severity: "info",
      message: `${balconies.length} balcony/terrace(s) require railing of minimum 1.05 m height — include in detail drawing.`,
      actual_value: "Construction specification",
      required_value: "≥ 1050 mm railing height",
      suggestion: "Add railing specification to balcony/terrace detail drawing.",
    });
  }
  return checks;
}

// ============================================================
// ACCESSIBLE ENTRANCE (NBC-AC-003)
// ============================================================

function checkAccessibleEntrance(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-AC-003");
  if (!rule) return 0;

  checks++;
  const minW = rule.parameters.min_width_mm as number;
  const mainEntrance = floor.doors.find((d) => d.type === "main_entrance");
  const hasWideEntrance = mainEntrance ? mainEntrance.width_mm >= minW : false;

  if (!hasWideEntrance) {
    violations.push({
      rule_id: rule.id,
      rule,
      entity_type: "door",
      entity_id: mainEntrance?.id ?? null,
      entity_name: "Main Entrance",
      severity: "info",
      message: `Main entrance width (${mainEntrance?.width_mm ?? 0} mm) may not meet accessibility standard (${minW} mm).`,
      actual_value: `${mainEntrance?.width_mm ?? "N/A"} mm`,
      required_value: `≥ ${minW} mm`,
      suggestion: "Consider widening the main entrance to 900 mm for wheelchair accessibility.",
    });
  }
  return checks;
}

// ============================================================
// NATURAL LIGHT 1/6 RATIO (NBC-WV-004)
// ============================================================

function checkNaturalLightRatio(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-WV-004");
  if (!rule) return 0;

  const applicableRooms = floor.rooms.filter(
    (r) => rule.room_types.length === 0 || rule.room_types.includes(r.type)
  );

  for (const room of applicableRooms) {
    checks++;
    const roomWallIds = new Set(room.wall_ids);
    const roomWindows = floor.windows.filter((w) => roomWallIds.has(w.wall_id));
    // NBC 2016 Cl. 8.4.6 — uses gross opening area (no frame factor)
    const totalWindowArea = roomWindows.reduce(
      (sum, w) => sum + (w.width_mm * w.height_mm) / 1_000_000, 0
    );
    const floorArea = room.area_sqm;
    const ratio = floorArea > 0 ? totalWindowArea / floorArea : 0;
    const minRatio = rule.parameters.min_ratio as number;

    // Only flag if room already passes the minimum 1/10 check (NBC-WV-001)
    // to avoid double-flagging rooms that fail both
    if (ratio < minRatio && ratio >= 0.10) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "room",
        entity_id: room.id,
        entity_name: room.name,
        severity: "info",
        message: `${room.name} meets minimum ventilation (${(ratio * 100).toFixed(1)}%) but is below recommended daylighting 1/6th (16.7%).`,
        actual_value: `${(ratio * 100).toFixed(1)}%`,
        required_value: `≥ ${(minRatio * 100).toFixed(1)}% (recommended)`,
        suggestion: `Add approximately ${((minRatio * floorArea - totalWindowArea)).toFixed(2)} sq.m more window area for optimal natural light.`,
      });
    }
  }
  return checks;
}

// ============================================================
// FIRE EGRESS DISTANCE (NBC-FS-002)
// ============================================================

function checkFireEgressDistance(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-FS-002");
  if (!rule) return 0;

  const maxDist = rule.parameters.max_travel_distance_mm as number;

  const exitDoors = floor.doors.filter(
    (d) => d.type === "main_entrance" || d.type === "fire_rated" || d.type === "service_entrance"
  );
  if (exitDoors.length === 0) return 0;

  // Build room adjacency graph from doors for BFS path distance.
  // Also compute door positions on walls so we can measure door-to-door distances
  // (more accurate than centroid-to-centroid for fire code compliance).
  const doorConnections = new Map<string, Set<string>>();
  for (const room of floor.rooms) doorConnections.set(room.id, new Set());

  // Map each door → its world-space position (for distance calculation)
  const doorPositions = new Map<string, { x: number; y: number }>();
  for (const door of floor.doors) {
    const wall = floor.walls.find((w) => w.id === door.wall_id);
    if (wall) {
      const dir = lineDirection(wall.centerline);
      const pos = addPoints(wall.centerline.start, scalePoint(dir, door.position_along_wall_mm + door.width_mm / 2));
      doorPositions.set(door.id, pos);
    }
    const [a, b] = door.connects_rooms;
    if (a && b) {
      doorConnections.get(a)?.add(b);
      doorConnections.get(b)?.add(a);
    }
  }

  // Find rooms directly connected to exit doors
  const exitRoomIds = new Set<string>();
  for (const door of exitDoors) {
    for (const rid of door.connects_rooms) {
      if (rid) exitRoomIds.add(rid);
    }
  }

  // Room farthest-corner distances (more conservative than centroids)
  // For each room, compute the maximum distance from the room's farthest
  // point to the nearest door connecting this room to another.
  const roomMaxInternalDist = new Map<string, number>();
  for (const room of floor.rooms) {
    const roomDoors = floor.doors.filter(d => d.connects_rooms.includes(room.id));
    if (roomDoors.length === 0) {
      // No doors → use half-diagonal as estimate
      const bounds = polygonBounds(room.boundary.points);
      roomMaxInternalDist.set(room.id, Math.sqrt(bounds.width ** 2 + bounds.height ** 2) / 2);
      continue;
    }
    // Max distance from any room corner to the nearest door of this room
    let maxDoorDist = 0;
    for (const pt of room.boundary.points) {
      let minDist = Infinity;
      for (const door of roomDoors) {
        const dp = doorPositions.get(door.id);
        if (!dp) continue;
        const d = Math.sqrt((pt.x - dp.x) ** 2 + (pt.y - dp.y) ** 2);
        if (d < minDist) minDist = d;
      }
      if (minDist !== Infinity && minDist > maxDoorDist) maxDoorDist = minDist;
    }
    roomMaxInternalDist.set(room.id, maxDoorDist);
  }

  // For room-to-room transitions, use door-to-door distances where available.
  // Build a map of inter-room connection distances.
  const connectionDist = new Map<string, number>();
  for (const door of floor.doors) {
    const [a, b] = door.connects_rooms;
    if (!a || !b) continue;
    const dp = doorPositions.get(door.id);
    if (!dp) continue;
    // Distance from door to the far side of each connected room
    const key = [a, b].sort().join("-");
    // Use the internal traversal of each room (door to far corner)
    const distA = roomMaxInternalDist.get(a) ?? 0;
    const distB = roomMaxInternalDist.get(b) ?? 0;
    const existing = connectionDist.get(key);
    // Use the minimum connection distance if multiple doors exist between rooms
    const thisDist = distA + distB;
    if (existing === undefined || thisDist < existing) {
      connectionDist.set(key, thisDist);
    }
  }

  // BFS from each room to nearest exit room using door-based distances
  for (const room of floor.rooms) {
    checks++;
    if (exitRoomIds.has(room.id)) continue;

    const visited = new Map<string, number>();
    const queue: Array<{ id: string; dist: number }> = [
      { id: room.id, dist: roomMaxInternalDist.get(room.id) ?? 0 },
    ];
    visited.set(room.id, queue[0].dist);
    let minPathDist = Infinity;

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (exitRoomIds.has(current.id)) {
        minPathDist = Math.min(minPathDist, current.dist);
        continue;
      }
      const neighbors = doorConnections.get(current.id);
      if (!neighbors) continue;
      for (const neighborId of neighbors) {
        const key = [current.id, neighborId].sort().join("-");
        const transitionDist = connectionDist.get(key) ?? 3000; // 3m default if unknown
        const newDist = current.dist + transitionDist;
        if (!visited.has(neighborId) || visited.get(neighborId)! > newDist) {
          visited.set(neighborId, newDist);
          queue.push({ id: neighborId, dist: newDist });
        }
      }
    }

    // Fallback to straight-line × 1.4 (Manhattan factor) if no path found
    if (minPathDist === Infinity) {
      const centroid = polygonCentroid(room.boundary.points);
      const exitPositions: { x: number; y: number }[] = [];
      for (const door of exitDoors) {
        const dp = doorPositions.get(door.id);
        if (dp) exitPositions.push(dp);
      }
      if (exitPositions.length > 0) {
        const straightLine = Math.min(...exitPositions.map((ep) =>
          Math.sqrt((centroid.x - ep.x) ** 2 + (centroid.y - ep.y) ** 2)
        ));
        minPathDist = straightLine * 1.4; // Manhattan correction factor
      }
    }

    if (minPathDist > maxDist) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "room",
        entity_id: room.id,
        entity_name: room.name,
        severity: rule.severity,
        message: `${room.name} is ${(minPathDist / 1000).toFixed(1)} m from nearest exit via path (max ${(maxDist / 1000).toFixed(1)} m).`,
        actual_value: `${(minPathDist / 1000).toFixed(1)} m`,
        required_value: `≤ ${(maxDist / 1000).toFixed(1)} m`,
        suggestion: "Consider adding a secondary exit or fire escape route closer to this room.",
      });
    }
  }
  return checks;
}

// ============================================================
// STAIR COMFORT FORMULA (NBC-ST-006)
// ============================================================

function checkStairFormula(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-ST-006");
  if (!rule) return 0;

  const minFormula = rule.parameters.min_formula as number;
  const maxFormula = rule.parameters.max_formula as number;

  for (const stair of floor.stairs) {
    checks++;
    const formulaValue = 2 * stair.riser_height_mm + stair.tread_depth_mm;

    if (formulaValue < minFormula || formulaValue > maxFormula) {
      const isBelow = formulaValue < minFormula;
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "stair",
        entity_id: stair.id,
        entity_name: `Staircase (${stair.type})`,
        severity: rule.severity,
        message: `Stair comfort formula 2R+T = ${formulaValue} mm is ${isBelow ? "below" : "above"} the acceptable range (${minFormula}–${maxFormula} mm).`,
        actual_value: `2×${stair.riser_height_mm} + ${stair.tread_depth_mm} = ${formulaValue} mm`,
        required_value: `${minFormula}–${maxFormula} mm (ideal 600 mm)`,
        suggestion: isBelow
          ? `Increase tread depth or riser height to bring 2R+T above ${minFormula} mm.`
          : `Decrease riser height or increase tread depth to bring 2R+T below ${maxFormula} mm.`,
      });
    }
  }
  return checks;
}

// ============================================================
// VENTILATION RATIO (NBC-WV-002)
// ============================================================

function checkVentilationRatio(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-WV-002");
  if (!rule) return 0;

  const minRatio = rule.parameters.min_ratio as number;
  const OPERABLE_FACTOR = 0.5; // 50% of window area counts as effective ventilation opening

  const applicableRooms = floor.rooms.filter(
    (r) => rule.room_types.length === 0 || rule.room_types.includes(r.type)
  );

  for (const room of applicableRooms) {
    checks++;
    const roomWallIds = new Set(room.wall_ids);
    const roomWindows = floor.windows.filter((w) => roomWallIds.has(w.wall_id));

    // Only operable windows contribute to ventilation; use 50% of their area
    const totalVentArea = roomWindows
      .filter((w) => w.operable)
      .reduce(
        (sum, w) => sum + (w.width_mm * w.height_mm * OPERABLE_FACTOR) / 1_000_000,
        0
      );

    const floorArea = room.area_sqm;
    const ratio = floorArea > 0 ? totalVentArea / floorArea : 0;

    if (ratio < minRatio) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "room",
        entity_id: room.id,
        entity_name: room.name,
        severity: rule.severity,
        message: `${room.name} ventilation opening ratio (${(ratio * 100).toFixed(1)}%) is below required ${(minRatio * 100).toFixed(0)}% of floor area.`,
        actual_value: `${(ratio * 100).toFixed(1)}% (${totalVentArea.toFixed(2)} sq.m operable / ${floorArea.toFixed(1)} sq.m floor)`,
        required_value: `≥ ${(minRatio * 100).toFixed(0)}% (1/20th of floor area)`,
        suggestion: `Add ${((minRatio * floorArea - totalVentArea)).toFixed(2)} sq.m more operable window area to ${room.name}, or provide mechanical ventilation.`,
      });
    }
  }
  return checks;
}

// ============================================================
// BATHROOM DOOR WIDTH (NBC-DR-004)
// ============================================================

function checkBathroomDoorWidth(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-DR-004");
  if (!rule) return 0;

  const minW = rule.parameters.min_width_mm as number;
  const wetRoomTypes = (rule.parameters.connects_to as string)?.split(",") ?? ["bathroom", "toilet", "wc"];

  for (const door of floor.doors) {
    // Check if this door connects to a bathroom/toilet/wc
    const connectsToWet = door.connects_rooms.some((roomId) => {
      const room = floor.rooms.find((r) => r.id === roomId);
      return room && wetRoomTypes.includes(room.type);
    });
    if (!connectsToWet) continue;

    checks++;
    if (door.width_mm < minW) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "door",
        entity_id: door.id,
        entity_name: `Bathroom Door (${door.type.replace(/_/g, " ")})`,
        severity: rule.severity,
        message: `Bathroom door width (${door.width_mm} mm) is below minimum ${minW} mm.`,
        actual_value: `${door.width_mm} mm`,
        required_value: `≥ ${minW} mm`,
        suggestion: `Widen bathroom door to at least ${minW} mm.`,
      });
    }
  }
  return checks;
}

// ============================================================
// STAIR HEADROOM (NBC-ST-004)
// ============================================================

function checkStairHeadroom(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-ST-004");
  if (!rule) return 0;

  const minHeadroom = rule.parameters.min_headroom_mm as number;

  for (const stair of floor.stairs) {
    checks++;
    // Headroom estimated from floor geometry. Under-stair clearance at midpoint:
    const clearHeight = floor.floor_to_floor_height_mm - floor.slab_thickness_mm;
    const midpointHeight = clearHeight - (Math.floor(stair.num_risers / 2) * stair.riser_height_mm);

    if (midpointHeight < minHeadroom) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "stair",
        entity_id: stair.id,
        entity_name: `Staircase (${stair.type})`,
        severity: rule.severity,
        message: `Estimated stair headroom (${midpointHeight} mm) may be below minimum ${minHeadroom} mm — verify on site.`,
        actual_value: `~${midpointHeight} mm (estimated)`,
        required_value: `≥ ${minHeadroom} mm`,
        suggestion: `Increase floor-to-floor height or adjust stair geometry to ensure ${minHeadroom} mm headroom.`,
      });
    }
  }
  return checks;
}

// ============================================================
// MULTI-UNIT STAIR WIDTH (NBC-ST-005)
// ============================================================

function checkMultiUnitStairWidth(
  floor: Floor,
  projectType: string,
  violations: CodeViolation[]
): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-ST-005");
  if (!rule) return 0;

  // Only applies to multi-unit residential (apartments) or commercial/institutional
  const isMultiUnit = ["commercial", "institutional", "mixed_use"].includes(projectType) ||
    projectType.includes("apartment");
  if (!isMultiUnit) return 0;

  const minW = rule.parameters.min_width_mm as number;

  for (const stair of floor.stairs) {
    checks++;
    if (stair.width_mm < minW) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: "stair",
        entity_id: stair.id,
        entity_name: `Staircase (${stair.type})`,
        severity: rule.severity,
        message: `Stair width (${stair.width_mm} mm) is below ${minW} mm required for multi-unit buildings.`,
        actual_value: `${stair.width_mm} mm`,
        required_value: `≥ ${minW} mm`,
        suggestion: `Widen staircase to at least ${minW} mm for multi-unit compliance.`,
      });
    }
  }
  return checks;
}

// ============================================================
// WHEELCHAIR ACCESSIBLE CORRIDOR (NBC-AC-001)
// ============================================================

function checkWheelchairCorridor(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-AC-001");
  if (!rule) return 0;

  const minW = rule.parameters.min_width_mm as number;
  const corridors = floor.rooms.filter((r) =>
    ["corridor", "lobby"].includes(r.type)
  );

  if (corridors.length === 0) return 0;

  checks++;
  // Check if at least one corridor path meets wheelchair width
  const hasAccessiblePath = corridors.some((c) => {
    const bounds = polygonBounds(c.boundary.points);
    return Math.min(bounds.width, bounds.height) >= minW;
  });

  if (!hasAccessiblePath) {
    const narrowest = corridors.reduce((min, c) => {
      const bounds = polygonBounds(c.boundary.points);
      const w = Math.min(bounds.width, bounds.height);
      return w < min.width ? { room: c, width: w } : min;
    }, { room: corridors[0], width: Infinity });

    violations.push({
      rule_id: rule.id,
      rule,
      entity_type: "corridor",
      entity_id: narrowest.room.id,
      entity_name: "Corridors",
      severity: rule.severity,
      message: `No corridor meets wheelchair accessible width of ${(minW / 1000).toFixed(1)} m. Narrowest is ${(narrowest.width / 1000).toFixed(2)} m.`,
      actual_value: `${(narrowest.width / 1000).toFixed(2)} m (narrowest)`,
      required_value: `≥ ${(minW / 1000).toFixed(1)} m (at least one path)`,
      suggestion: `Widen at least one corridor to ${(minW / 1000).toFixed(1)} m for wheelchair access.`,
    });
  }
  return checks;
}

// ============================================================
// ACCESSIBLE BATHROOM (NBC-AC-002)
// ============================================================

function checkAccessibleBathroom(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-AC-002");
  if (!rule) return 0;

  const minTurning = rule.parameters.min_turning_circle_mm as number;
  const bathrooms = floor.rooms.filter((r) =>
    ["bathroom", "toilet", "wc"].includes(r.type)
  );

  if (bathrooms.length === 0) return 0;

  checks++;
  const hasAccessible = bathrooms.some((b) => {
    const bounds = polygonBounds(b.boundary.points);
    return Math.min(bounds.width, bounds.height) >= minTurning;
  });

  if (!hasAccessible) {
    violations.push({
      rule_id: rule.id,
      rule,
      entity_type: "room",
      entity_id: bathrooms[0].id,
      entity_name: "Bathrooms",
      severity: "info",
      message: `No bathroom provides ${(minTurning / 1000).toFixed(1)} m turning circle for wheelchair access.`,
      actual_value: "All bathrooms below turning circle requirement",
      required_value: `≥ ${(minTurning / 1000).toFixed(1)} m × ${(minTurning / 1000).toFixed(1)} m (at least one)`,
      suggestion: `Consider enlarging at least one bathroom to accommodate a ${(minTurning / 1000).toFixed(1)} m turning circle.`,
    });
  }
  return checks;
}

// ============================================================
// FIRE ESCAPE ROUTE WIDTH (NBC-FS-001)
// ============================================================

function checkFireEscapeRouteWidth(floor: Floor, violations: CodeViolation[]): number {
  let checks = 0;
  const rule = ALL_BUILDING_CODE_RULES.find((r) => r.id === "NBC-FS-001");
  if (!rule) return 0;

  const minW = rule.parameters.min_width_mm as number;

  // Check fire escape rooms, corridors used as escape routes, and staircases
  const escapeRoutes = floor.rooms.filter((r) =>
    ["fire_escape", "corridor", "staircase"].includes(r.type)
  );

  for (const route of escapeRoutes) {
    checks++;
    const bounds = polygonBounds(route.boundary.points);
    const routeWidth = Math.min(bounds.width, bounds.height);

    if (routeWidth < minW) {
      violations.push({
        rule_id: rule.id,
        rule,
        entity_type: route.type === "corridor" ? "corridor" : "room",
        entity_id: route.id,
        entity_name: route.name,
        severity: rule.severity,
        message: `${route.name} width (${(routeWidth / 1000).toFixed(2)} m) is below fire escape minimum ${(minW / 1000).toFixed(1)} m.`,
        actual_value: `${(routeWidth / 1000).toFixed(2)} m`,
        required_value: `≥ ${(minW / 1000).toFixed(1)} m`,
        suggestion: `Widen ${route.name} to at least ${(minW / 1000).toFixed(1)} m for fire safety compliance.`,
      });
    }
  }
  return checks;
}
