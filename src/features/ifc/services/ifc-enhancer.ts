/**
 * Text-level IFC modifier — edits ISO-10303-21 (STEP) IFC files *in place* by
 * appending new entities and surgically rewriting a small set of relationship
 * entities. Never regenerates the file from scratch.
 *
 * Supported operations (see IFCOperation): add_floor, remove_floor,
 * set_floor_count, add_room, rename_storey.
 */

// ═════════════════════════════════════════════════════════════════════════════
// Public types
// ═════════════════════════════════════════════════════════════════════════════

export type IFCOperation =
  | { op: "add_floor"; count?: number }
  | { op: "remove_floor"; count?: number }
  | { op: "set_floor_count"; count: number }
  | { op: "add_room"; storey?: "top" | "bottom" | string; name?: string; width?: number; depth?: number; height?: number }
  | { op: "rename_storey"; target?: "top" | "bottom" | string; name: string };

export interface OperationResult {
  op: string;
  ok: boolean;
  message: string;
  entitiesAdded?: number;
  entitiesRewritten?: number;
}

export interface EnhanceResult {
  ok: boolean;
  modifiedText: string;
  originalText: string;
  results: OperationResult[];
  summary: string;
  stats: {
    originalBytes: number;
    modifiedBytes: number;
  };
}

export interface IFCSummary {
  schema: string;
  storeyCount: number;
  storeys: Array<{ name: string; elevation: number }>;
  elementCounts: Record<string, number>;
  unitScale: "mm" | "m";
}

// ═════════════════════════════════════════════════════════════════════════════
// Parse helpers (shared across all operations)
// ═════════════════════════════════════════════════════════════════════════════

interface ParsedEntity {
  id: number;
  name: string;
  body: string;
  line: string;
  start: number;
  end: number;
}

interface IndexedEntity {
  id: number;
  name: string;
  body: string;
  args: string[];
}

function parseEntities(text: string): ParsedEntity[] {
  const out: ParsedEntity[] = [];
  const re = /#(\d+)\s*=\s*([A-Z][A-Z0-9_]*)\s*\(([\s\S]*?)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    out.push({
      id: Number(m[1]),
      name: m[2].toUpperCase(),
      body: m[3],
      line: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}

function findDataSectionBounds(text: string): { dataStart: number; endsecIdx: number } {
  const dataMatch = text.match(/\bDATA;/);
  const endsecMatch = text.match(/\bENDSEC;\s*END-ISO-10303-21;/);
  if (!dataMatch || dataMatch.index === undefined) throw new Error("IFC has no DATA; section");
  if (!endsecMatch || endsecMatch.index === undefined) throw new Error("IFC has no ENDSEC; END-ISO-10303-21; terminator");
  return { dataStart: dataMatch.index + "DATA;".length, endsecIdx: endsecMatch.index };
}

function splitArgs(body: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" && body[i - 1] !== "\\") {
      inString = !inString;
      current += c;
      continue;
    }
    if (inString) { current += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function extractRefs(s: string): number[] {
  const out: number[] = [];
  const re = /#(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out.push(Number(m[1]));
  return out;
}

function indexEntities(entities: ParsedEntity[]): Map<number, IndexedEntity> {
  const map = new Map<number, IndexedEntity>();
  for (const e of entities) {
    map.set(e.id, { id: e.id, name: e.name, body: e.body, args: splitArgs(e.body) });
  }
  return map;
}

const DO_NOT_CLONE = new Set([
  "IFCOWNERHISTORY", "IFCPERSONANDORGANIZATION", "IFCPERSON", "IFCORGANIZATION",
  "IFCAPPLICATION", "IFCUNITASSIGNMENT", "IFCSIUNIT", "IFCCONVERSIONBASEDUNIT",
  "IFCMEASUREWITHUNIT", "IFCDIMENSIONALEXPONENTS",
  "IFCGEOMETRICREPRESENTATIONCONTEXT", "IFCGEOMETRICREPRESENTATIONSUBCONTEXT",
  "IFCMATERIAL", "IFCMATERIALLAYER", "IFCMATERIALLAYERSET", "IFCMATERIALLAYERSETUSAGE",
  "IFCMATERIALDEFINITIONREPRESENTATION", "IFCSTYLEDITEM", "IFCPRESENTATIONSTYLEASSIGNMENT",
  "IFCSURFACESTYLE", "IFCSURFACESTYLERENDERING", "IFCCOLOURRGB",
  "IFCPROPERTYSET", "IFCPROPERTYSINGLEVALUE",
  "IFCCLASSIFICATION", "IFCCLASSIFICATIONREFERENCE",
]);

function collectCloneSet(rootIds: number[], idx: Map<number, IndexedEntity>): Set<number> {
  const visited = new Set<number>();
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    const ent = idx.get(id);
    if (!ent) continue;
    if (DO_NOT_CLONE.has(ent.name)) continue;
    visited.add(id);
    for (const ref of extractRefs(ent.body)) {
      if (!visited.has(ref)) stack.push(ref);
    }
  }
  return visited;
}

function remapBody(body: string, idMap: Map<number, number>): string {
  return body.replace(/#(\d+)/g, (match, grp: string) => {
    const oldId = Number(grp);
    const newId = idMap.get(oldId);
    return newId !== undefined ? `#${newId}` : match;
  });
}

function shiftCartesianZ(body: string, dz: number): string {
  const m = body.match(/^\s*\(\s*([^)]+?)\s*\)\s*$/);
  if (!m) return body;
  const coords = m[1].split(",").map((s) => s.trim());
  if (coords.length < 3) {
    coords.push(String(dz));
  } else {
    const z = Number(coords[2]);
    coords[2] = String(Number.isFinite(z) ? z + dz : dz);
  }
  return `(${coords.join(",")})`;
}

/**
 * Return the set of storey IDs that are *actively* part of the building —
 * i.e. listed as RelatedObjects of at least one IFCRELAGGREGATES. A storey
 * that's been detached (its aggregation entry rewritten to exclude it by
 * removeFloorStep) no longer appears here, even though the raw entity line
 * is still in the file.
 */
function activeStoreyIds(idx: Map<number, IndexedEntity>): Set<number> {
  const active = new Set<number>();
  for (const ent of idx.values()) {
    if (ent.name !== "IFCRELAGGREGATES") continue;
    for (const id of extractRefs(ent.args[5] || "")) {
      const ch = idx.get(id);
      if (ch && ch.name === "IFCBUILDINGSTOREY") active.add(id);
    }
  }
  return active;
}

function collectStoreys(
  idx: Map<number, IndexedEntity>,
): Array<{ id: number; elevation: number; args: string[]; name: string }> {
  const active = activeStoreyIds(idx);
  const storeys: Array<{ id: number; elevation: number; args: string[]; name: string }> = [];
  for (const ent of idx.values()) {
    if (ent.name !== "IFCBUILDINGSTOREY") continue;
    // If the file tracks aggregation (most do), only count storeys that are
    // still aggregated under a parent — this lets us call collectStoreys
    // again after a removeFloorStep and get the NEW top without re-picking
    // the one we just detached. Files without any aggregation fall through
    // to the unfiltered list.
    if (active.size > 0 && !active.has(ent.id)) continue;
    const elev = Number(ent.args[ent.args.length - 1]);
    const rawName = ent.args[2]?.replace(/^'(.*)'$/, "$1") ?? "";
    storeys.push({ id: ent.id, elevation: Number.isFinite(elev) ? elev : 0, args: ent.args, name: rawName });
  }
  storeys.sort((a, b) => a.elevation - b.elevation);
  return storeys;
}

function maxEntityId(entities: ParsedEntity[]): number {
  let max = 0;
  for (const e of entities) if (e.id > max) max = e.id;
  return max;
}

/**
 * ID-space ceiling derived by scanning the raw text for every `#N =` pattern.
 *
 * Critical for correctness: if `parseEntities` ever misses an entity (e.g. an
 * entity whose body contains `');'` inside a string and defeats our non-greedy
 * regex), `maxEntityId` under-counts. New entities we append at `max+1` would
 * then collide with an existing unparsed entity's ID. IFC requires IDs be
 * unique; web-ifc silently keeps the first definition and drops the second, so
 * add_floor's new storey and its cloned walls never render — the viewer looks
 * identical to the input.
 *
 * Scanning the raw text with a simple `#N\s*=` regex catches every definition
 * regardless of how nasty its body is. We take the max of both signals for a
 * belt-and-braces safety floor.
 */
function safeMaxEntityId(text: string, entities: ParsedEntity[]): number {
  let max = maxEntityId(entities);
  const re = /#(\d+)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = Number(m[1]);
    if (id > max) max = id;
  }
  return max;
}

function randomGuid(): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
  let s = "";
  for (let i = 0; i < 22; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function getStoreyPlacementPointId(
  storey: { id: number },
  idx: Map<number, IndexedEntity>,
): number | undefined {
  const ent = idx.get(storey.id);
  if (!ent) return undefined;
  const placementRef = extractRefs(ent.args[5] || "")[0];
  const placement = placementRef !== undefined ? idx.get(placementRef) : undefined;
  if (!placement || placement.name !== "IFCLOCALPLACEMENT") return undefined;
  const axisRef = extractRefs(placement.args[1] || "")[0];
  const axis = axisRef !== undefined ? idx.get(axisRef) : undefined;
  if (!axis || axis.name !== "IFCAXIS2PLACEMENT3D") return undefined;
  return extractRefs(axis.args[0] || "")[0];
}

function spliceInsertBeforeEndsec(text: string, insertion: string): string {
  const { endsecIdx } = findDataSectionBounds(text);
  return text.slice(0, endsecIdx) + insertion + text.slice(endsecIdx);
}

/** Rewrite a specific entity's line in the IFC text (by ID) with a new full line. */
function rewriteEntityLine(text: string, entityId: number, newLine: string): string {
  const re = new RegExp(`#${entityId}\\s*=\\s*[A-Z][A-Z0-9_]*\\s*\\([\\s\\S]*?\\);`);
  return text.replace(re, newLine);
}

/** Batch-delete multiple entity lines in one pass. Uses the `m` flag with `^`
 *  so consecutive adjacent deletes don't skip alternating neighbours by
 *  consuming the preceding newline. */
function deleteEntityLines(text: string, ids: Iterable<number>): string {
  const arr = [...ids];
  if (arr.length === 0) return text;
  const alt = arr.join("|");
  const re = new RegExp(`^#(?:${alt})\\s*=\\s*[A-Z][A-Z0-9_]*\\s*\\([\\s\\S]*?\\);\\r?\\n?`, "gm");
  return text.replace(re, "");
}

/** Remove deleted IDs from EVERY IFCREL* entity's reference lists + drop
 *  any rel whose list becomes empty or whose single-ref side pointed at a
 *  deleted entity. This is broader than just IFCRELAGGREGATES /
 *  IFCRELCONTAINEDINSPATIALSTRUCTURE — it also covers IFCRELDEFINESBYPROPERTIES,
 *  IFCRELASSOCIATESMATERIAL, IFCRELASSIGNSTOGROUP, IFCRELDEFINESBYTYPE,
 *  IFCRELVOIDSELEMENT, IFCRELFILLSELEMENT, etc. Anything the file may ship with.
 */
function cleanRelReferences(
  text: string,
  removed: Set<number>,
  idx: Map<number, IndexedEntity>,
): { text: string; deletedRelIds: Set<number> } {
  let result = text;
  const deletedRels = new Set<number>();
  for (const ent of idx.values()) {
    if (!ent.name.startsWith("IFCREL")) continue;
    const newArgs = [...ent.args];
    let changed = false;
    let shouldDeleteRel = false;

    for (let i = 0; i < newArgs.length; i++) {
      const arg = newArgs[i];
      if (!arg) continue;

      if (arg.trimStart().startsWith("(")) {
        // List: filter deleted IDs
        const ids = extractRefs(arg);
        if (!ids.some((id) => removed.has(id))) continue;
        const kept = ids.filter((id) => !removed.has(id));
        if (kept.length === 0) {
          shouldDeleteRel = true;
          break;
        }
        newArgs[i] = `(${kept.map((id) => `#${id}`).join(",")})`;
        changed = true;
      } else if (arg.startsWith("#")) {
        // Single ref: if it points at a deleted entity, the rel is broken.
        const refId = Number(arg.slice(1));
        if (removed.has(refId)) {
          shouldDeleteRel = true;
          break;
        }
      }
    }

    if (shouldDeleteRel) {
      deletedRels.add(ent.id);
    } else if (changed) {
      result = rewriteEntityLine(result, ent.id, `#${ent.id}= ${ent.name}(${newArgs.join(",")});`);
    }
  }

  if (deletedRels.size > 0) {
    result = deleteEntityLines(result, deletedRels);
  }
  return { text: result, deletedRelIds: deletedRels };
}

/** Types we consider "helper" — safe to garbage-collect when nothing
 *  references them. Core entities (IFCPROJECT, IFCBUILDING, etc.) and
 *  shared infrastructure (IFCOWNERHISTORY, contexts, units, materials*)
 *  are NOT listed here so they're always preserved.
 *  *Materials CAN be orphaned if nothing references them; we still keep
 *  them conservatively. */
const HELPER_TYPES = new Set([
  "IFCLOCALPLACEMENT",
  "IFCAXIS2PLACEMENT3D", "IFCAXIS2PLACEMENT2D", "IFCAXIS1PLACEMENT",
  "IFCCARTESIANPOINT", "IFCDIRECTION",
  "IFCPRODUCTDEFINITIONSHAPE", "IFCSHAPEREPRESENTATION",
  "IFCREPRESENTATIONMAP", "IFCMAPPEDITEM",
  "IFCEXTRUDEDAREASOLID", "IFCREVOLVEDAREASOLID",
  "IFCSURFACECURVESWEPTAREASOLID", "IFCSWEPTDISKSOLID",
  "IFCBOOLEANRESULT", "IFCBOOLEANCLIPPINGRESULT",
  "IFCHALFSPACESOLID", "IFCPOLYGONALBOUNDEDHALFSPACE",
  "IFCARBITRARYCLOSEDPROFILEDEF", "IFCARBITRARYPROFILEDEFWITHVOIDS",
  "IFCRECTANGLEPROFILEDEF", "IFCROUNDEDRECTANGLEPROFILEDEF",
  "IFCCIRCLEPROFILEDEF", "IFCELLIPSEPROFILEDEF",
  "IFCIPROFILEDEF", "IFCUPROFILEDEF", "IFCCSHAPEPROFILEDEF",
  "IFCLSHAPEPROFILEDEF", "IFCTSHAPEPROFILEDEF", "IFCZSHAPEPROFILEDEF",
  "IFCTRAPEZIUMPROFILEDEF", "IFCASYMMETRICISHAPEPROFILEDEF",
  "IFCPOLYLINE", "IFCPOLYLOOP", "IFCLINE", "IFCCIRCLE", "IFCELLIPSE",
  "IFCTRIMMEDCURVE", "IFCCOMPOSITECURVE", "IFCCOMPOSITECURVESEGMENT",
  "IFCFACE", "IFCFACEBOUND", "IFCFACEOUTERBOUND",
  "IFCCONNECTEDFACESET", "IFCCLOSEDSHELL", "IFCOPENSHELL",
  "IFCSHELLBASEDSURFACEMODEL", "IFCFACEBASEDSURFACEMODEL",
  "IFCFACETEDBREP", "IFCMANIFOLDSOLIDBREP",
  "IFCTRIANGULATEDFACESET", "IFCPOLYGONALFACESET",
  "IFCINDEXEDPOLYCURVE", "IFCCARTESIANPOINTLIST2D", "IFCCARTESIANPOINTLIST3D",
  "IFCCARTESIANTRANSFORMATIONOPERATOR3D",
  "IFCSTYLEDITEM", "IFCPRESENTATIONSTYLEASSIGNMENT",
  "IFCPROPERTYSET", "IFCPROPERTYSINGLEVALUE", "IFCQUANTITYLENGTH",
  "IFCQUANTITYAREA", "IFCQUANTITYVOLUME", "IFCQUANTITYCOUNT",
  "IFCELEMENTQUANTITY",
]);

/** Garbage-collect orphan helper entities — anything in HELPER_TYPES with
 *  no remaining referencers. Iterates until a fixed point, so deleting a
 *  wall's placement cascades to deleting the axis, then the cartesian point,
 *  etc. Never touches products (walls, slabs, …) or shared infrastructure. */
function compactOrphans(text: string): { text: string; removed: number } {
  const entities = parseEntities(text);
  const idx = indexEntities(entities);

  // Build reverse ref graph: entity → IDs that reference it.
  const referencedBy = new Map<number, Set<number>>();
  for (const ent of idx.values()) {
    for (const ref of extractRefs(ent.body)) {
      let s = referencedBy.get(ref);
      if (!s) { s = new Set(); referencedBy.set(ref, s); }
      s.add(ent.id);
    }
  }

  const deleted = new Set<number>();
  // Fixed-point iteration: whenever we delete a helper, its children may become
  // orphans too. Bounded by chain depth (≤ ~10 in practice).
  let changed = true;
  while (changed) {
    changed = false;
    for (const ent of idx.values()) {
      if (deleted.has(ent.id)) continue;
      if (!HELPER_TYPES.has(ent.name)) continue;
      const refs = referencedBy.get(ent.id);
      const hasLiveReferencer = refs && [...refs].some((r) => !deleted.has(r));
      if (!hasLiveReferencer) {
        deleted.add(ent.id);
        changed = true;
      }
    }
  }

  if (deleted.size === 0) return { text, removed: 0 };
  return { text: deleteEntityLines(text, deleted), removed: deleted.size };
}

// ═════════════════════════════════════════════════════════════════════════════
// Summary extractor — used to prompt the AI planner
// ═════════════════════════════════════════════════════════════════════════════

export function summarizeIFC(ifcText: string): IFCSummary {
  const entities = parseEntities(ifcText);
  const idx = indexEntities(entities);
  const storeys = collectStoreys(idx);

  const elementCounts: Record<string, number> = {};
  const interesting = new Set([
    "IFCWALL", "IFCWALLSTANDARDCASE", "IFCSLAB", "IFCWINDOW", "IFCDOOR",
    "IFCCOLUMN", "IFCBEAM", "IFCSTAIR", "IFCRAILING", "IFCROOF", "IFCSPACE",
    "IFCCURTAINWALL", "IFCFURNISHINGELEMENT", "IFCBUILDINGELEMENTPROXY",
  ]);
  for (const ent of idx.values()) {
    if (interesting.has(ent.name)) {
      elementCounts[ent.name] = (elementCounts[ent.name] ?? 0) + 1;
    }
  }

  // Unit detection: look for IFCSIUNIT with prefix MILLI → mm
  let unitScale: "mm" | "m" = "mm";
  for (const ent of idx.values()) {
    if (ent.name === "IFCSIUNIT" && ent.args[1]?.includes("LENGTHUNIT")) {
      unitScale = ent.args[2]?.includes("MILLI") ? "mm" : "m";
      break;
    }
  }

  const schemaMatch = ifcText.match(/FILE_SCHEMA\(\('([^']+)'/);
  return {
    schema: schemaMatch?.[1] ?? "unknown",
    storeyCount: storeys.length,
    storeys: storeys.map((s) => ({ name: s.name, elevation: s.elevation })),
    elementCounts,
    unitScale,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Heuristic classifier (fallback when AI planner is not configured)
// ═════════════════════════════════════════════════════════════════════════════

export function classifyPrompt(prompt: string): IFCOperation[] {
  const p = prompt.toLowerCase();
  const ops: IFCOperation[] = [];

  // "I want N floors" / "make it N storeys" / "reduce to N levels"
  const countMatch = p.match(/\b(?:only\s+)?(\d+)\s*(floor|storey|story|level|floors|storeys|stories|levels)\b/);
  if (countMatch) {
    ops.push({ op: "set_floor_count", count: Number(countMatch[1]) });
  } else {
    // "add one more floor", "add 2 floors"
    const addMatch = p.match(/\b(?:add|one more|another|extra|new)\s*(\d+)?\s*(?:floor|storey|story|level)/);
    if (addMatch) {
      ops.push({ op: "add_floor", count: addMatch[1] ? Number(addMatch[1]) : 1 });
    }
    // "remove top floor", "delete last storey"
    const removeMatch = p.match(/\b(?:remove|delete|drop)\s*(?:the\s*)?(?:top|last|upper)?\s*(\d+)?\s*(?:floor|storey|story|level)/);
    if (removeMatch) {
      ops.push({ op: "remove_floor", count: removeMatch[1] ? Number(removeMatch[1]) : 1 });
    }
  }

  // Room intent: any sentence that asks for a room ("add", "want", "need",
  // "create", "put", "place" + room, OR phrases like "one room"/"a room").
  const wantsRoom =
    /\b(?:add|want|need|create|put|place|build|include)\b[^.]*\broom\b/.test(p) ||
    /\b(?:one|a|an|another|extra|new)\s+room\b/.test(p);
  if (wantsRoom) {
    const locMatch = p.match(/\b(?:on|at|to|in|atop|over)\s+(?:the\s+)?(terrace|rooftop|roof|top|bottom|ground|basement)\b/);
    const loc = locMatch?.[1] ?? "";
    let where: string;
    if (/terrace|rooftop|roof/.test(loc)) where = "terrace";
    else if (/bottom|ground|basement/.test(loc)) where = "bottom";
    else if (loc === "top") where = "top";
    else where = "terrace"; // safest default for "add a room" with no location
    ops.push({ op: "add_room", storey: where, name: "Room" });
  }

  return ops;
}

// ═════════════════════════════════════════════════════════════════════════════
// Operation: add_floor
// ═════════════════════════════════════════════════════════════════════════════

interface OpStepResult {
  modifiedText: string;
  ok: boolean;
  message: string;
  entitiesAdded?: number;
  entitiesRewritten?: number;
}

export function addFloorStep(ifcText: string): OpStepResult {
  const entities = parseEntities(ifcText);
  if (entities.length === 0) {
    return { modifiedText: ifcText, ok: false, message: "Could not parse any IFC entities." };
  }

  const idx = indexEntities(entities);
  const storeys = collectStoreys(idx);
  if (storeys.length === 0) {
    return { modifiedText: ifcText, ok: false, message: "No IFCBUILDINGSTOREY entities found — nothing to duplicate." };
  }

  const topStorey = storeys[storeys.length - 1];
  const storeyHeight =
    storeys.length >= 2
      ? storeys[storeys.length - 1].elevation - storeys[storeys.length - 2].elevation
      : 3000;
  const newStoreyElevation = topStorey.elevation + storeyHeight;
  const storeyPointId = getStoreyPlacementPointId(topStorey, idx);

  // Find elements belonging to the top storey using the SAME 4-tier detection
  // that removeFloorStep uses — IFCRELCONTAINEDINSPATIALSTRUCTURE, then
  // IFCRELAGGREGATES, then placement-chain reachability, then Z-band. Previous
  // versions of this function only checked IFCRELCONTAINEDINSPATIALSTRUCTURE
  // and would silently clone zero elements (producing an invisible new floor)
  // when the file's spatial structure didn't match that one pattern.
  const elementIdsToClone: number[] = [...collectStoreyElements(topStorey.id, idx, storeys)];

  // Find ANY IfcRelAggregates that references the top storey — we'll reuse
  // its building + owner history when creating our new aggregation.
  const aggregates = [...idx.values()].find((e) => {
    if (e.name !== "IFCRELAGGREGATES") return false;
    const related = e.args[5];
    return related && extractRefs(related).includes(topStorey.id);
  });

  // Look up an owner history we can borrow for the new relationship entities.
  const anyOwnerHistory = (() => {
    for (const ent of idx.values()) if (ent.name === "IFCOWNERHISTORY") return `#${ent.id}`;
    return "$";
  })();

  const cloneRoots: number[] = [topStorey.id, ...elementIdsToClone];
  const cloneSet = collectCloneSet(cloneRoots, idx);

  const maxId = safeMaxEntityId(ifcText, entities);
  let nextId = maxId + 1;
  const idMap = new Map<number, number>();
  for (const oldId of cloneSet) idMap.set(oldId, nextId++);

  const newLines: string[] = [];
  for (const oldId of cloneSet) {
    const ent = idx.get(oldId)!;
    const newId = idMap.get(oldId)!;
    let body = remapBody(ent.body, idMap);

    if (ent.name === "IFCCARTESIANPOINT" && storeyPointId !== undefined && oldId === storeyPointId) {
      body = shiftCartesianZ(body, storeyHeight);
    }

    if (ent.name === "IFCBUILDINGSTOREY") {
      const args = splitArgs(body);
      args[args.length - 1] = String(newStoreyElevation);
      const nameArg = args[2];
      if (nameArg) {
        const renamed = nameArg.replace(/(Storey|Level|Floor)\s*(\d+)/i, (_all, kind: string, num: string) => {
          return `${kind} ${Number(num) + 1}`;
        });
        args[2] = renamed === nameArg && /'[^']*'/.test(nameArg)
          ? nameArg.replace(/'([^']*)'/, (_q, v: string) => `'${v} (copy)'`)
          : renamed;
      }
      body = args.join(",");
    }

    newLines.push(`#${newId}= ${ent.name}(${body});`);
  }

  const newStoreyId = idMap.get(topStorey.id);

  // Locate an IFCBUILDING to aggregate the new storey under. Prefer the one
  // already aggregating the top storey; if none exists (weird IFCs), grab
  // any IFCBUILDING we can find.
  let buildingRef: string | undefined;
  let aggOwnerHistory: string = anyOwnerHistory;
  if (aggregates) {
    buildingRef = aggregates.args[4];
    aggOwnerHistory = aggregates.args[1];
  } else {
    for (const ent of idx.values()) {
      if (ent.name === "IFCBUILDING") { buildingRef = `#${ent.id}`; break; }
    }
  }

  if (newStoreyId !== undefined && buildingRef) {
    const aggId = nextId++;
    newLines.push(
      `#${aggId}= IFCRELAGGREGATES('${randomGuid()}',${aggOwnerHistory},'Added Storey',$,${buildingRef},(#${newStoreyId}));`,
    );
  }

  // Always emit a containment for the cloned elements. Previously this only
  // ran if the top storey had an original IFCRELCONTAINEDINSPATIALSTRUCTURE,
  // so IFCs that use placement-chain or aggregate-style containment produced
  // cloned walls that floated unreferenced and rendered nothing.
  if (newStoreyId !== undefined && elementIdsToClone.length > 0) {
    const newElementIds = elementIdsToClone
      .map((old) => idMap.get(old))
      .filter((x): x is number => x !== undefined)
      .map((id) => `#${id}`);
    if (newElementIds.length > 0) {
      const containId = nextId++;
      newLines.push(
        `#${containId}= IFCRELCONTAINEDINSPATIALSTRUCTURE('${randomGuid()}',${anyOwnerHistory},'Cloned Contents',$,(${newElementIds.join(",")}),#${newStoreyId});`,
      );
    }
  }

  const insertion = `\n/* ── NeoBIM IFC Enhancer: added storey at ${newStoreyElevation} ── */\n` + newLines.join("\n") + "\n";
  const modifiedText = spliceInsertBeforeEndsec(ifcText, insertion);

  return {
    modifiedText,
    ok: true,
    message: `Added a new storey at elevation ${newStoreyElevation} (cloned ${elementIdsToClone.length} element(s)).`,
    entitiesAdded: nextId - maxId - 1,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Operation: remove_floor
// ═════════════════════════════════════════════════════════════════════════════

/**
 * IfcProduct subtypes whose line is structured as:
 *   ENTITY(GlobalId, OwnerHistory, Name, Description, ObjectType,
 *          ObjectPlacement, Representation, Tag?, PredefinedType?, …)
 * — i.e. arg[5] = ObjectPlacement and arg[6] = Representation.
 *
 * These are the entity types where blanking args[5..6] to "$" makes web-ifc
 * skip rendering them. Covers all of the IfcBuildingElement hierarchy plus
 * IfcSpatialElement subtypes we might want to hide.
 */
const IFC_PRODUCT_TYPES = new Set([
  "IFCWALL", "IFCWALLSTANDARDCASE", "IFCWALLELEMENTEDCASE", "IFCCURTAINWALL",
  "IFCSLAB", "IFCROOF", "IFCFOOTING", "IFCPILE",
  "IFCCOLUMN", "IFCBEAM", "IFCMEMBER", "IFCPLATE",
  "IFCDOOR", "IFCWINDOW", "IFCOPENINGELEMENT",
  "IFCSTAIR", "IFCSTAIRFLIGHT", "IFCRAMP", "IFCRAMPFLIGHT",
  "IFCRAILING", "IFCCOVERING",
  "IFCFURNISHINGELEMENT", "IFCFURNITURE",
  "IFCFLOWSEGMENT", "IFCFLOWFITTING", "IFCFLOWTERMINAL", "IFCFLOWCONTROLLER",
  "IFCENERGYCONVERSIONDEVICE", "IFCDISTRIBUTIONELEMENT",
  "IFCBUILDINGELEMENTPROXY", "IFCBUILDINGELEMENT",
  "IFCELEMENT", "IFCELEMENTASSEMBLY",
  "IFCSPACE", "IFCBUILDINGSTOREY", "IFCBUILDING", "IFCSITE",
  "IFCREINFORCINGBAR", "IFCREINFORCINGMESH", "IFCTENDON",
]);

/** Read the Z coordinate from an IFCCARTESIANPOINT entity body `(x,y,z)`. */
function getPointZ(pointEnt: IndexedEntity): number {
  const m = pointEnt.body.match(/\(\s*([^)]+?)\s*\)/);
  if (!m) return 0;
  const coords = m[1].split(",").map((s) => Number(s.trim()));
  return coords.length >= 3 && Number.isFinite(coords[2]) ? coords[2] : 0;
}

/** Compute an element's absolute world Z by walking its local-placement chain
 *  (Element.ObjectPlacement → IfcLocalPlacement → PlacementRelTo → ...) and
 *  summing each level's RelativePlacement.Location.Z. */
function getAbsoluteZ(productEnt: IndexedEntity, idx: Map<number, IndexedEntity>): number {
  let z = 0;
  const visited = new Set<number>();
  let placementRef = extractRefs(productEnt.args[5] || "")[0];
  while (placementRef !== undefined && !visited.has(placementRef)) {
    visited.add(placementRef);
    const placement = idx.get(placementRef);
    if (!placement || placement.name !== "IFCLOCALPLACEMENT") break;
    const axisRef = extractRefs(placement.args[1] || "")[0];
    const axis = axisRef !== undefined ? idx.get(axisRef) : undefined;
    if (axis && axis.name === "IFCAXIS2PLACEMENT3D") {
      const pointRef = extractRefs(axis.args[0] || "")[0];
      const point = pointRef !== undefined ? idx.get(pointRef) : undefined;
      if (point && point.name === "IFCCARTESIANPOINT") z += getPointZ(point);
    }
    placementRef = extractRefs(placement.args[0] || "")[0]; // parent
  }
  return z;
}

/** True iff `productEnt`'s placement chain passes through `storeyPlacementRef`. */
function placementChainReaches(
  productEnt: IndexedEntity,
  storeyPlacementRef: number,
  idx: Map<number, IndexedEntity>,
): boolean {
  let current = extractRefs(productEnt.args[5] || "")[0];
  const visited = new Set<number>();
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    if (current === storeyPlacementRef) return true;
    const placement = idx.get(current);
    if (!placement || placement.name !== "IFCLOCALPLACEMENT") break;
    current = extractRefs(placement.args[0] || "")[0];
  }
  return false;
}

/** Collect all elements that belong to a storey, using THREE detection
 *  methods (in order of reliability) so files with non-standard spatial
 *  structure still get picked up:
 *
 *    1. IFCRELCONTAINEDINSPATIALSTRUCTURE (direct containment, most common)
 *    2. IFCRELAGGREGATES with storey as RelatingObject (decomposition)
 *    3. Placement-chain reachability (element's IfcLocalPlacement transitively
 *       references the storey's IfcLocalPlacement)
 *    4. Z-coordinate band (only if methods 1-3 found nothing): elements whose
 *       absolute Z falls within [storey.Z, nextStoreyZ). This is the last
 *       resort for IFCs that aggregate everything under the building with no
 *       per-storey relationships.
 *
 *  Then cascades via IfcRelVoidsElement + IfcRelFillsElement to pick up
 *  windows/doors nested inside walls we're hiding.
 */
function collectStoreyElements(
  storeyId: number,
  idx: Map<number, IndexedEntity>,
  storeysOrdered?: Array<{ id: number; elevation: number }>,
): Set<number> {
  const elements = new Set<number>();

  // ── Method 1: IfcRelContainedInSpatialStructure ────────────────────────────
  for (const ent of idx.values()) {
    if (ent.name !== "IFCRELCONTAINEDINSPATIALSTRUCTURE") continue;
    if (!extractRefs(ent.args[5] || "").includes(storeyId)) continue;
    for (const id of extractRefs(ent.args[4] || "")) elements.add(id);
  }

  // ── Method 2: IfcRelAggregates with storey as relating ────────────────────
  for (const ent of idx.values()) {
    if (ent.name !== "IFCRELAGGREGATES") continue;
    if (!extractRefs(ent.args[4] || "").includes(storeyId)) continue;
    for (const id of extractRefs(ent.args[5] || "")) elements.add(id);
  }

  // ── Method 3: placement-chain reachability ─────────────────────────────────
  const storeyEnt = idx.get(storeyId);
  const storeyPlacementRef = storeyEnt ? extractRefs(storeyEnt.args[5] || "")[0] : undefined;
  if (storeyPlacementRef !== undefined) {
    for (const ent of idx.values()) {
      if (!IFC_PRODUCT_TYPES.has(ent.name)) continue;
      if (ent.id === storeyId) continue;
      if (elements.has(ent.id)) continue;
      if (placementChainReaches(ent, storeyPlacementRef, idx)) elements.add(ent.id);
    }
  }

  // ── Method 4: absolute-Z band (only if nothing else matched) ───────────────
  if (elements.size === 0 && storeysOrdered && storeysOrdered.length > 0) {
    const storeyIdx = storeysOrdered.findIndex((s) => s.id === storeyId);
    if (storeyIdx >= 0) {
      const floorZ = storeysOrdered[storeyIdx].elevation;
      const ceilZ = storeyIdx + 1 < storeysOrdered.length
        ? storeysOrdered[storeyIdx + 1].elevation
        : Number.POSITIVE_INFINITY;
      // Tolerance of 1 model unit to absorb floating-point slop and wall thickness.
      const minZ = floorZ - 1;
      for (const ent of idx.values()) {
        if (!IFC_PRODUCT_TYPES.has(ent.name)) continue;
        if (ent.id === storeyId) continue;
        if (ent.name === "IFCBUILDINGSTOREY" || ent.name === "IFCBUILDING" || ent.name === "IFCSITE") continue;
        const z = getAbsoluteZ(ent, idx);
        if (z >= minZ && z < ceilZ - 1) elements.add(ent.id);
      }
    }
  }

  // ── Cascade: windows/doors nested inside walls we're hiding ────────────────
  const initial = [...elements];
  for (const ent of idx.values()) {
    if (ent.name !== "IFCRELVOIDSELEMENT") continue;
    const rel = extractRefs(ent.args[4] || "")[0];
    const opening = extractRefs(ent.args[5] || "")[0];
    if (rel !== undefined && initial.includes(rel) && opening !== undefined) elements.add(opening);
  }
  const expanded = [...elements];
  for (const ent of idx.values()) {
    if (ent.name !== "IFCRELFILLSELEMENT") continue;
    const opening = extractRefs(ent.args[4] || "")[0];
    const filler = extractRefs(ent.args[5] || "")[0];
    if (opening !== undefined && expanded.includes(opening) && filler !== undefined) elements.add(filler);
  }

  return elements;
}

export function removeFloorStep(ifcText: string): OpStepResult {
  const entities = parseEntities(ifcText);
  const idx = indexEntities(entities);
  const storeys = collectStoreys(idx);
  if (storeys.length <= 1) {
    return {
      modifiedText: ifcText,
      ok: false,
      message: "Can't remove the last floor — a building needs at least one storey.",
    };
  }

  const topStorey = storeys[storeys.length - 1];
  const elementIds = collectStoreyElements(topStorey.id, idx, storeys);

  // We delete entity lines rather than blanking fields. Deletion shrinks the
  // file (important because repeated add/remove cycles bloat it otherwise),
  // which significantly speeds up web-ifc's parser. To stay schema-safe:
  //   (a) we only delete the top-level product lines (walls, slabs, doors,
  //       windows, etc.) plus the storey itself,
  //   (b) we leave the placement/representation sub-entities in place
  //       (orphan but harmless — web-ifc ignores unused entities),
  //   (c) we clean every relationship list that referenced a deleted product
  //       so no IFCRELAGGREGATES / IFCRELCONTAINEDINSPATIALSTRUCTURE ends up
  //       pointing at a non-existent entity.
  const toDelete = new Set<number>(elementIds);
  toDelete.add(topStorey.id); // the storey itself

  // Step 1: delete product lines + the storey's own entity line.
  let modifiedText = deleteEntityLines(ifcText, toDelete);

  // Step 2: clean every IFCREL* entity so no rel has dangling references to
  //         the deleted products (and drop rels whose lists now empty out
  //         or whose mandatory single-ref side pointed at a deleted entity).
  const relCleanup = cleanRelReferences(modifiedText, toDelete, idx);
  modifiedText = relCleanup.text;

  // Step 3: orphan garbage-collection — delete placement chains, geometry
  //         primitives, shape representations etc. that nothing references
  //         anymore now that the products are gone. This is the big win
  //         for file-size: one wall pulls down ~15 helper entities on average.
  const compact = compactOrphans(modifiedText);
  modifiedText = compact.text;

  return {
    modifiedText,
    ok: true,
    message:
      `Removed storey "${topStorey.name || `at ${topStorey.elevation}`}" ` +
      `— deleted ${elementIds.size} product(s) + storey, ` +
      `dropped ${relCleanup.deletedRelIds.size} relation(s), ` +
      `garbage-collected ${compact.removed} orphan helper entity(ies).`,
    entitiesRewritten:
      elementIds.size + 1 + relCleanup.deletedRelIds.size + compact.removed,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Operation: set_floor_count (composition of add_floor / remove_floor)
// ═════════════════════════════════════════════════════════════════════════════

export function setFloorCountStep(ifcText: string, targetCount: number): OpStepResult {
  if (!Number.isFinite(targetCount) || targetCount < 1 || targetCount > 50) {
    return { modifiedText: ifcText, ok: false, message: `Invalid floor count: ${targetCount}. Must be 1-50.` };
  }

  const entities = parseEntities(ifcText);
  const idx = indexEntities(entities);
  const currentCount = collectStoreys(idx).length;

  if (currentCount === targetCount) {
    return { modifiedText: ifcText, ok: true, message: `Building already has ${targetCount} floor(s); no change.` };
  }

  let text = ifcText;
  let totalAdded = 0;
  const totalRewritten = 0;

  if (currentCount < targetCount) {
    const needed = targetCount - currentCount;
    for (let i = 0; i < needed; i++) {
      const step = addFloorStep(text);
      if (!step.ok) {
        return { modifiedText: text, ok: false, message: `Stopped after ${i} add(s): ${step.message}` };
      }
      text = step.modifiedText;
      totalAdded += step.entitiesAdded ?? 0;
    }
    return {
      modifiedText: text,
      ok: true,
      message: `Increased floor count from ${currentCount} to ${targetCount} (added ${needed}).`,
      entitiesAdded: totalAdded,
    };
  }

  // currentCount > targetCount — batch all top-storey removals into one
  // parse/delete/GC pass. N separate removeFloorSteps would parse the text
  // N times and run GC N times; batching collapses that to a single pass.
  const toRemove = currentCount - targetCount;
  const batch = removeTopStoreysStep(text, toRemove);
  return {
    modifiedText: batch.modifiedText,
    ok: batch.ok,
    message: batch.ok
      ? `Reduced floor count from ${currentCount} to ${targetCount} (removed ${toRemove}). ${batch.message}`
      : batch.message,
    entitiesRewritten: (batch.entitiesRewritten ?? 0) + totalAdded + totalRewritten,
  };
}

/** Batch-remove the top N storeys in one parse + delete + GC pass.
 *  Significantly faster than calling removeFloorStep N times because we
 *  only parse the text once and only run orphan GC once. */
export function removeTopStoreysStep(ifcText: string, count: number): OpStepResult {
  if (!Number.isFinite(count) || count < 1) {
    return { modifiedText: ifcText, ok: false, message: `Invalid removal count: ${count}.` };
  }
  const entities = parseEntities(ifcText);
  const idx = indexEntities(entities);
  const storeys = collectStoreys(idx);
  if (storeys.length <= count) {
    return {
      modifiedText: ifcText,
      ok: false,
      message: `Can't remove ${count} — only ${storeys.length} storey(s) available.`,
    };
  }

  const topN = storeys.slice(storeys.length - count);
  const allDeleted = new Set<number>();
  for (const s of topN) {
    allDeleted.add(s.id);
    const elems = collectStoreyElements(s.id, idx, storeys);
    for (const e of elems) allDeleted.add(e);
  }

  let modifiedText = deleteEntityLines(ifcText, allDeleted);
  const relCleanup = cleanRelReferences(modifiedText, allDeleted, idx);
  modifiedText = relCleanup.text;
  const compact = compactOrphans(modifiedText);
  modifiedText = compact.text;

  const productCount = allDeleted.size - topN.length;
  return {
    modifiedText,
    ok: true,
    message:
      `Deleted ${productCount} product(s) across ${topN.length} storey(s), ` +
      `dropped ${relCleanup.deletedRelIds.size} relation(s), ` +
      `GC'd ${compact.removed} orphan(s).`,
    entitiesRewritten: allDeleted.size + relCleanup.deletedRelIds.size + compact.removed,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Operation: add_room — appends an IFCSPACE with visible extruded geometry
// ═════════════════════════════════════════════════════════════════════════════

export function addRoomStep(
  ifcText: string,
  options: { storey?: "top" | "bottom" | string; name?: string; width?: number; depth?: number; height?: number } = {},
): OpStepResult {
  const entities = parseEntities(ifcText);
  const idx = indexEntities(entities);
  const storeys = collectStoreys(idx);
  if (storeys.length === 0) {
    return { modifiedText: ifcText, ok: false, message: "No storeys found — can't place a room." };
  }

  // Resolve target storey + decide whether the room sits ON it or ABOVE it.
  // "terrace" / "roof" / "rooftop" → ABOVE the topmost storey (one storey
  // height up). Plain "top" → ON the topmost floor. Named storeys → ON them.
  const target = (options.storey ?? "top").toString();
  const targetLc = target.toLowerCase().trim();
  let storey: typeof storeys[number] | undefined;
  let placeAbove = false;

  if (/(^|\s)(terrace|roof|rooftop)(\s|$)/.test(targetLc)) {
    // Look for an existing storey explicitly named terrace/roof first.
    storey = storeys.find((s) => /terrace|roof/i.test(s.name));
    if (!storey) {
      storey = storeys[storeys.length - 1];
      placeAbove = true;
    }
  } else if (targetLc === "top" || targetLc === "on top") {
    storey = storeys[storeys.length - 1];
  } else if (targetLc === "bottom" || targetLc === "ground" || targetLc === "basement") {
    storey = storeys[0];
  } else {
    storey = storeys.find((s) => s.name.toLowerCase().includes(targetLc)) ?? storeys[storeys.length - 1];
  }
  if (!storey) return { modifiedText: ifcText, ok: false, message: `Couldn't find storey "${target}".` };

  // Pull context entities we need to reference (never clone). Each lookup
  // has a fallback so this op succeeds on minimal/non-standard IFCs too.
  const storeyEnt = idx.get(storey.id);
  if (!storeyEnt) return { modifiedText: ifcText, ok: false, message: "Target storey entity missing from index." };

  let storeyPlacementRef: number | undefined = extractRefs(storeyEnt.args[5] || "")[0];
  let ownerHistoryArg: string = storeyEnt.args[1] || "$";

  // Walk every storey if this one didn't have a placement.
  if (storeyPlacementRef === undefined) {
    for (const s of storeys) {
      const e = idx.get(s.id);
      const ref = e ? extractRefs(e.args[5] || "")[0] : undefined;
      if (ref !== undefined) { storeyPlacementRef = ref; break; }
    }
  }

  // Walk for any IfcOwnerHistory if storey's was missing.
  if (!ownerHistoryArg.startsWith("#")) {
    for (const ent of idx.values()) {
      if (ent.name === "IFCOWNERHISTORY") { ownerHistoryArg = `#${ent.id}`; break; }
    }
  }

  // Find a representation context — try Body subcontext, then any
  // subcontext, then any parent context. Most real-world IFCs have at
  // least one IfcGeometricRepresentationContext.
  let contextRef: number | undefined;
  for (const ent of idx.values()) {
    if (ent.name === "IFCGEOMETRICREPRESENTATIONSUBCONTEXT") {
      const id0 = (ent.args[0] || "").toLowerCase();
      if (id0.includes("body")) { contextRef = ent.id; break; }
    }
  }
  if (contextRef === undefined) {
    for (const ent of idx.values()) {
      if (ent.name === "IFCGEOMETRICREPRESENTATIONSUBCONTEXT") { contextRef = ent.id; break; }
    }
  }
  if (contextRef === undefined) {
    for (const ent of idx.values()) {
      if (ent.name === "IFCGEOMETRICREPRESENTATIONCONTEXT") { contextRef = ent.id; break; }
    }
  }

  // Scale-aware defaults. Storey height delta gives us the unit context.
  const avgStoreyHeight =
    storeys.length >= 2
      ? storeys[storeys.length - 1].elevation - storeys[storeys.length - 2].elevation
      : 3000;
  const isMm = Math.abs(avgStoreyHeight) > 50; // heuristic: >50 means mm
  const unit = isMm ? 1000 : 1;
  const width = options.width ?? 4 * unit;
  const depth = options.depth ?? 4 * unit;
  const height = options.height ?? (avgStoreyHeight || 3 * unit);
  const name = (options.name ?? "Room").replace(/'/g, ""); // strip quotes

  const maxId = safeMaxEntityId(ifcText, entities);
  let nextId = maxId + 1;
  const lines: string[] = [];
  const n = () => nextId++;

  // ── Synthesize fallbacks for any missing context entities ──
  let effectiveContextRef = contextRef;
  if (effectiveContextRef === undefined) {
    const ctxOrigin = n(); lines.push(`#${ctxOrigin}= IFCCARTESIANPOINT((0.,0.,0.));`);
    const ctxAxis = n(); lines.push(`#${ctxAxis}= IFCAXIS2PLACEMENT3D(#${ctxOrigin},$,$);`);
    effectiveContextRef = n();
    lines.push(`#${effectiveContextRef}= IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${ctxAxis},$);`);
  }

  let effectivePlacementRef = storeyPlacementRef;
  if (effectivePlacementRef === undefined) {
    const fbOrigin = n(); lines.push(`#${fbOrigin}= IFCCARTESIANPOINT((0.,0.,${storey.elevation}));`);
    const fbAxis = n(); lines.push(`#${fbAxis}= IFCAXIS2PLACEMENT3D(#${fbOrigin},$,$);`);
    effectivePlacementRef = n();
    lines.push(`#${effectivePlacementRef}= IFCLOCALPLACEMENT($,#${fbAxis});`);
  }

  // Profile: closed polyline rectangle in XY, centred on origin
  const hx = width / 2;
  const hy = depth / 2;
  const p1 = n(); lines.push(`#${p1}= IFCCARTESIANPOINT((${-hx},${-hy}));`);
  const p2 = n(); lines.push(`#${p2}= IFCCARTESIANPOINT((${hx},${-hy}));`);
  const p3 = n(); lines.push(`#${p3}= IFCCARTESIANPOINT((${hx},${hy}));`);
  const p4 = n(); lines.push(`#${p4}= IFCCARTESIANPOINT((${-hx},${hy}));`);
  const polyline = n(); lines.push(`#${polyline}= IFCPOLYLINE((#${p1},#${p2},#${p3},#${p4},#${p1}));`);
  const profile = n(); lines.push(`#${profile}= IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'RoomFloor',#${polyline});`);

  // Extrusion placement (origin + axes)
  const extOrigin = n(); lines.push(`#${extOrigin}= IFCCARTESIANPOINT((0.,0.,0.));`);
  const extZ = n(); lines.push(`#${extZ}= IFCDIRECTION((0.,0.,1.));`);
  const extX = n(); lines.push(`#${extX}= IFCDIRECTION((1.,0.,0.));`);
  const extAxis = n(); lines.push(`#${extAxis}= IFCAXIS2PLACEMENT3D(#${extOrigin},#${extZ},#${extX});`);
  const extDir = n(); lines.push(`#${extDir}= IFCDIRECTION((0.,0.,1.));`);
  const extrusion = n(); lines.push(`#${extrusion}= IFCEXTRUDEDAREASOLID(#${profile},#${extAxis},#${extDir},${height});`);

  const shapeRep = n(); lines.push(`#${shapeRep}= IFCSHAPEREPRESENTATION(#${effectiveContextRef},'Body','SweptSolid',(#${extrusion}));`);
  const prodDef = n(); lines.push(`#${prodDef}= IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRep}));`);

  // Space placement relative to the storey. For "terrace" the room sits
  // one storey height ABOVE the top floor (on the roof level).
  const baseOffsetZ = placeAbove ? avgStoreyHeight : 0;
  const spaceOrigin = n(); lines.push(`#${spaceOrigin}= IFCCARTESIANPOINT((0.,0.,${baseOffsetZ}));`);
  const spaceAxis = n(); lines.push(`#${spaceAxis}= IFCAXIS2PLACEMENT3D(#${spaceOrigin},$,$);`);
  const spacePlacement = n(); lines.push(`#${spacePlacement}= IFCLOCALPLACEMENT(#${effectivePlacementRef},#${spaceAxis});`);

  const space = n();
  const spaceGuid = randomGuid();
  // We deliberately emit an IfcBuildingElementProxy rather than an IfcSpace
  // here. Reason: this viewer (src/features/ifc/components/Viewport.tsx:975)
  // renders IFCSPACE at opacity 0.15 (nearly invisible). A proxy renders with
  // the default opaque material, so the user actually sees the room on the
  // terrace. Semantically it's still tagged as "Room" via the Name + ObjectType.
  lines.push(
    `#${space}= IFCBUILDINGELEMENTPROXY('${spaceGuid}',${ownerHistoryArg},'${name}',$,'Room',#${spacePlacement},#${prodDef},'${name}',.ELEMENT.);`,
  );

  // Attach the space to the storey via a fresh IFCRELCONTAINEDINSPATIALSTRUCTURE
  const rel = n();
  lines.push(
    `#${rel}= IFCRELCONTAINEDINSPATIALSTRUCTURE('${randomGuid()}',${ownerHistoryArg},'Room Contents',$,(#${space}),#${storey.id});`,
  );

  const where = placeAbove ? `above storey "${storey.name}" (terrace)` : `on storey "${storey.name}"`;
  const insertion = `\n/* ── NeoBIM IFC Enhancer: added room "${name}" ${where} ── */\n` + lines.join("\n") + "\n";
  const modifiedText = spliceInsertBeforeEndsec(ifcText, insertion);

  return {
    modifiedText,
    ok: true,
    message: `Added room "${name}" (${width}×${depth}×${height}${isMm ? "mm" : "m"}) ${where}.`,
    entitiesAdded: nextId - maxId - 1,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Operation: rename_storey
// ═════════════════════════════════════════════════════════════════════════════

export function renameStoreyStep(
  ifcText: string,
  target: "top" | "bottom" | string = "top",
  newName: string,
): OpStepResult {
  const entities = parseEntities(ifcText);
  const idx = indexEntities(entities);
  const storeys = collectStoreys(idx);
  if (storeys.length === 0) return { modifiedText: ifcText, ok: false, message: "No storeys to rename." };

  let storey: typeof storeys[number] | undefined;
  if (target === "top") storey = storeys[storeys.length - 1];
  else if (target === "bottom") storey = storeys[0];
  else {
    const lower = target.toLowerCase();
    storey = storeys.find((s) => s.name.toLowerCase().includes(lower));
  }
  if (!storey) return { modifiedText: ifcText, ok: false, message: `Couldn't find storey "${target}".` };

  const ent = idx.get(storey.id)!;
  const newArgs = [...ent.args];
  newArgs[2] = `'${newName.replace(/'/g, "")}'`;
  const newLine = `#${ent.id}= IFCBUILDINGSTOREY(${newArgs.join(",")});`;
  const modifiedText = rewriteEntityLine(ifcText, ent.id, newLine);
  return { modifiedText, ok: true, message: `Renamed storey "${storey.name}" → "${newName}".`, entitiesRewritten: 1 };
}

// ═════════════════════════════════════════════════════════════════════════════
// Plan executor
// ═════════════════════════════════════════════════════════════════════════════

export function executePlan(ifcText: string, operations: IFCOperation[]): EnhanceResult {
  const originalText = ifcText;
  let text = ifcText;
  const results: OperationResult[] = [];
  let anyOk = false;

  for (const op of operations) {
    let step: OpStepResult;
    switch (op.op) {
      case "add_floor": {
        const n = Math.max(1, Math.min(10, op.count ?? 1));
        step = { modifiedText: text, ok: true, message: "", entitiesAdded: 0 };
        for (let i = 0; i < n; i++) {
          const s = addFloorStep(step.modifiedText);
          if (!s.ok) { step = { ...s, modifiedText: step.modifiedText }; break; }
          step = {
            modifiedText: s.modifiedText,
            ok: true,
            message: n === 1 ? s.message : `Added floor ${i + 1} of ${n}.`,
            entitiesAdded: (step.entitiesAdded ?? 0) + (s.entitiesAdded ?? 0),
          };
        }
        break;
      }
      case "remove_floor": {
        const n = Math.max(1, Math.min(10, op.count ?? 1));
        step = { modifiedText: text, ok: true, message: "", entitiesRewritten: 0 };
        for (let i = 0; i < n; i++) {
          const s = removeFloorStep(step.modifiedText);
          if (!s.ok) { step = { ...s, modifiedText: step.modifiedText }; break; }
          step = {
            modifiedText: s.modifiedText,
            ok: true,
            message: n === 1 ? s.message : `Removed floor ${i + 1} of ${n}.`,
            entitiesRewritten: (step.entitiesRewritten ?? 0) + (s.entitiesRewritten ?? 0),
          };
        }
        break;
      }
      case "set_floor_count":
        step = setFloorCountStep(text, op.count);
        break;
      case "add_room":
        step = addRoomStep(text, op);
        break;
      case "rename_storey":
        step = renameStoreyStep(text, op.target ?? "top", op.name);
        break;
      default: {
        const unknown: { op: string } = op as { op: string };
        step = { modifiedText: text, ok: false, message: `Unknown operation: ${unknown.op}` };
      }
    }
    results.push({
      op: op.op,
      ok: step.ok,
      message: step.message,
      entitiesAdded: step.entitiesAdded,
      entitiesRewritten: step.entitiesRewritten,
    });
    if (step.ok) { text = step.modifiedText; anyOk = true; }
  }

  // ── Post-execution validation: verify no duplicate entity IDs slipped in.
  //    This would have caused web-ifc to silently drop the newer definitions
  //    — making add_floor etc. "succeed" textually while producing no visible
  //    change in the viewer. Catching it here surfaces the real failure mode. ──
  const validation = validateUniqueIds(text);
  if (!validation.ok) {
    results.push({
      op: "validate",
      ok: false,
      message: `IFC validation failed after enhancement: ${validation.message}`,
    });
    anyOk = false;
    // Roll back to the original so the viewer doesn't load a broken file.
    text = originalText;
  }

  const applied = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  let summary: string;
  if (operations.length === 0) summary = "No operations to apply.";
  else if (applied === operations.length && validation.ok) summary = `Applied ${applied} operation${applied === 1 ? "" : "s"}.`;
  else if (applied > 0 && validation.ok) summary = `Applied ${applied} of ${operations.length} operations (${failed} failed).`;
  else if (!validation.ok) summary = `Rolled back: ${validation.message}`;
  else summary = `Could not apply any of the ${operations.length} requested operations.`;

  return {
    ok: anyOk,
    modifiedText: text,
    originalText,
    results,
    summary,
    stats: { originalBytes: originalText.length, modifiedBytes: text.length },
  };
}

/** Scan the IFC text for duplicate entity IDs. Returns `ok: false` + a sample
 *  of duplicates when found. Duplicates cause web-ifc to silently drop the
 *  later definition, which manifests as "enhancement applied but viewer
 *  unchanged" — the single worst failure mode for this feature. */
function validateUniqueIds(text: string): { ok: boolean; message: string } {
  const seen = new Set<number>();
  const duplicates = new Set<number>();
  const re = /(?:^|\n)#(\d+)\s*=/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const id = Number(m[1]);
    if (seen.has(id)) duplicates.add(id);
    else seen.add(id);
  }
  if (duplicates.size === 0) return { ok: true, message: "" };
  const sample = [...duplicates].slice(0, 5).map((id) => `#${id}`).join(", ");
  return { ok: false, message: `Duplicate entity IDs (${duplicates.size}): ${sample}${duplicates.size > 5 ? ", …" : ""}` };
}

// ═════════════════════════════════════════════════════════════════════════════
// Back-compat entry point (kept so existing callers continue to work)
// ═════════════════════════════════════════════════════════════════════════════

export function enhance(ifcText: string, prompt: string): EnhanceResult {
  const ops = classifyPrompt(prompt);
  if (ops.length === 0) {
    return {
      ok: false,
      modifiedText: ifcText,
      originalText: ifcText,
      results: [],
      summary:
        "Couldn't interpret this request with the offline classifier. Try: \"add a floor\", \"remove the top floor\", \"I want 3 floors\", or \"add a room on the terrace\".",
      stats: { originalBytes: ifcText.length, modifiedBytes: ifcText.length },
    };
  }
  return executePlan(ifcText, ops);
}

// Back-compat exports used by existing tests
export { addFloorStep as addFloor };
export function classifyIntent(prompt: string): "add-floor" | "unknown" {
  const ops = classifyPrompt(prompt);
  return ops.some((o) => o.op === "add_floor") ? "add-floor" : "unknown";
}
