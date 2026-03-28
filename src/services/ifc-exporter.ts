/**
 * IFC Exporter — generates a valid IFC4 STEP Physical File (.ifc) from massing geometry.
 *
 * Follows the buildingSMART IFC4 ADD2 TC1 specification.
 * Produces valid ISO-10303-21 files that open in BIMvision, BlenderBIM, FreeCAD, Xeokit, etc.
 *
 * Spatial hierarchy: IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey
 * Elements: IfcWall (.STANDARD.) with IfcExtrudedAreaSolid geometry
 *           IfcSlab (.FLOOR. / .ROOF.) with IfcExtrudedAreaSolid geometry
 */

import type { MassingGeometry, FootprintPoint } from "@/types/geometry";

interface IFCExportOptions {
  projectName?: string;
  siteName?: string;
  buildingName?: string;
  author?: string;
  filter?: "architectural" | "structural" | "mep" | "all";
}

// ─── Discipline Filter Sets ──────────────────────────────────────────────
const ARCHITECTURAL_TYPES = new Set(["wall", "window", "door", "space", "balcony", "canopy", "parapet"]);
const STRUCTURAL_TYPES = new Set(["column", "beam", "slab", "stair", "roof"]);
const MEP_TYPE_SET = new Set(["duct", "pipe", "cable-tray", "equipment"]);

// ─── IFC Base-64 GUID Generator ─────────────────────────────────────────────
// IFC GlobalId: exactly 22 characters from the IFC base-64 alphabet.
const IFC_BASE64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/**
 * Deterministic 22-char IFC GlobalId from a seed — must be unique per seed.
 * Uses a seeded PRNG (xorshift32) where each seed produces a distinct sequence.
 */
function ifcGuid(seed: number): string {
  // xorshift32 state — must be non-zero
  let state = ((seed + 1) * 2654435761) >>> 0;
  if (state === 0) state = 1;

  const xorshift = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };

  let result = "";
  for (let i = 0; i < 22; i++) {
    result += IFC_BASE64[xorshift() % 64];
  }
  return result;
}

// ─── Entity ID Counter ──────────────────────────────────────────────────────
class IdCounter {
  private _value: number;
  constructor(start = 1) { this._value = start; }
  next(): number { return this._value++; }
  get current(): number { return this._value; }
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function f(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

/** Calculate polygon area using the shoelace formula */
function polygonAreaCalc(points: FootprintPoint[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/**
 * Generate a complete valid IFC4 file from massing geometry.
 */
export function generateIFCFile(
  geometry: MassingGeometry,
  options: IFCExportOptions = {}
): string {
  const {
    projectName = "BuildFlow Export",
    siteName = "Default Site",
    buildingName = geometry.buildingType,
    author = "BuildFlow",
  } = options;

  const now = new Date().toISOString().replace(/\.\d+Z$/, "");
  const timestamp = Math.floor(Date.now() / 1000);
  const id = new IdCounter();
  const lines: string[] = [];

  // Sanitize strings for STEP format (no single quotes)
  const safeName = (s: string) => s.replace(/'/g, "");

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER
  // ═══════════════════════════════════════════════════════════════════════════
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('ViewDefinition [DesignTransferView_V1]'),'2;1');`,
    `FILE_NAME('${safeName(buildingName)}.ifc','${now}',('${safeName(author)}'),('BuildFlow'),'BuildFlow IFC Exporter','BuildFlow','');`,
    `FILE_SCHEMA(('IFC4'));`,
    "ENDSEC;",
    "",
    "DATA;",
  ].join("\n");

  // ═══════════════════════════════════════════════════════════════════════════
  // SHARED GEOMETRY PRIMITIVES
  // ═══════════════════════════════════════════════════════════════════════════
  const worldOriginId = id.next();
  lines.push(`#${worldOriginId}=IFCCARTESIANPOINT((0.,0.,0.));`);

  const zDirId = id.next();
  lines.push(`#${zDirId}=IFCDIRECTION((0.,0.,1.));`);

  const xDirId = id.next();
  lines.push(`#${xDirId}=IFCDIRECTION((1.,0.,0.));`);

  const worldPlacementId = id.next();
  lines.push(`#${worldPlacementId}=IFCAXIS2PLACEMENT3D(#${worldOriginId},#${zDirId},#${xDirId});`);

  // ═══════════════════════════════════════════════════════════════════════════
  // GEOMETRIC REPRESENTATION CONTEXT
  // ═══════════════════════════════════════════════════════════════════════════
  const contextId = id.next();
  lines.push(`#${contextId}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${worldPlacementId},$);`);

  const bodyContextId = id.next();
  lines.push(`#${bodyContextId}=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${contextId},$,.MODEL_VIEW.,$);`);

  // ═══════════════════════════════════════════════════════════════════════════
  // UNITS — SI (metre, square metre, cubic metre, radian, second)
  // ═══════════════════════════════════════════════════════════════════════════
  const mId = id.next();
  lines.push(`#${mId}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);

  const m2Id = id.next();
  lines.push(`#${m2Id}=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`);

  const m3Id = id.next();
  lines.push(`#${m3Id}=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`);

  const radId = id.next();
  lines.push(`#${radId}=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`);

  const secId = id.next();
  lines.push(`#${secId}=IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.);`);

  const unitAssignId = id.next();
  lines.push(`#${unitAssignId}=IFCUNITASSIGNMENT((#${mId},#${m2Id},#${m3Id},#${radId},#${secId}));`);

  // ═══════════════════════════════════════════════════════════════════════════
  // OWNER HISTORY
  // ═══════════════════════════════════════════════════════════════════════════
  const personId = id.next();
  lines.push(`#${personId}=IFCPERSON($,'${safeName(author)}','',$,$,$,$,$);`);

  const orgId = id.next();
  lines.push(`#${orgId}=IFCORGANIZATION($,'BuildFlow','BuildFlow Workflow Platform',$,$);`);

  const personOrgId = id.next();
  lines.push(`#${personOrgId}=IFCPERSONANDORGANIZATION(#${personId},#${orgId},$);`);

  const appId = id.next();
  lines.push(`#${appId}=IFCAPPLICATION(#${orgId},'1.0','BuildFlow Workflow Builder','BuildFlow');`);

  const ownerHistId = id.next();
  lines.push(`#${ownerHistId}=IFCOWNERHISTORY(#${personOrgId},#${appId},$,.ADDED.,${timestamp},$,$,${timestamp});`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PROJECT
  // ═══════════════════════════════════════════════════════════════════════════
  const projectId = id.next();
  lines.push(`#${projectId}=IFCPROJECT('${ifcGuid(projectId)}',#${ownerHistId},'${safeName(projectName)}',$,$,$,$,(#${contextId}),#${unitAssignId});`);

  // ═══════════════════════════════════════════════════════════════════════════
  // SITE
  // ═══════════════════════════════════════════════════════════════════════════
  const sitePlacementId = id.next();
  lines.push(`#${sitePlacementId}=IFCLOCALPLACEMENT($,#${worldPlacementId});`);

  const siteId = id.next();
  lines.push(`#${siteId}=IFCSITE('${ifcGuid(siteId)}',#${ownerHistId},'${safeName(siteName)}',$,$,#${sitePlacementId},$,$,.ELEMENT.,$,$,$,$,$);`);

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDING
  // ═══════════════════════════════════════════════════════════════════════════
  const buildingPlacementId = id.next();
  lines.push(`#${buildingPlacementId}=IFCLOCALPLACEMENT(#${sitePlacementId},#${worldPlacementId});`);

  const buildingId = id.next();
  lines.push(`#${buildingId}=IFCBUILDING('${ifcGuid(buildingId)}',#${ownerHistId},'${safeName(buildingName)}',$,$,#${buildingPlacementId},$,$,.ELEMENT.,$,$,$);`);

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILDING STOREYS & ELEMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  const storeyIds: number[] = [];

  for (const storey of geometry.storeys) {
    // ── Storey placement (relative to building, offset by elevation) ──
    const storeyOriginId = id.next();
    lines.push(`#${storeyOriginId}=IFCCARTESIANPOINT((0.,0.,${f(storey.elevation)}));`);

    const storeyAxisId = id.next();
    lines.push(`#${storeyAxisId}=IFCAXIS2PLACEMENT3D(#${storeyOriginId},#${zDirId},#${xDirId});`);

    const storeyPlacementId = id.next();
    lines.push(`#${storeyPlacementId}=IFCLOCALPLACEMENT(#${buildingPlacementId},#${storeyAxisId});`);

    const storeyId = id.next();
    lines.push(`#${storeyId}=IFCBUILDINGSTOREY('${ifcGuid(storeyId)}',#${ownerHistId},'${safeName(storey.name)}',$,$,#${storeyPlacementId},$,$,.ELEMENT.,${f(storey.elevation)});`);
    storeyIds.push(storeyId);

    const storeyElementIds: number[] = [];

    const storeySpaceIds: number[] = [];

    for (const element of storey.elements) {
      // ── Discipline filtering ──
      const filter = options.filter ?? "all";
      if (filter !== "all") {
        const filterSet = filter === "architectural" ? ARCHITECTURAL_TYPES
          : filter === "structural" ? STRUCTURAL_TYPES
          : MEP_TYPE_SET;
        if (!filterSet.has(element.type)) continue;
      }

      if (element.type === "wall" || element.type === "parapet") {
        const wallId = writeWallEntity(
          element, storey, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId,
          id, lines
        );
        storeyElementIds.push(wallId);

      } else if (element.type === "slab" || element.type === "roof") {
        const slabId = writeSlabEntity(
          element, geometry.footprint, storeyPlacementId,
          bodyContextId, ownerHistId,
          element.type === "roof",
          id, lines
        );
        storeyElementIds.push(slabId);

      } else if (element.type === "column") {
        const colId = writeColumnEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId,
          id, lines
        );
        storeyElementIds.push(colId);

      } else if (element.type === "window") {
        const winId = writeWindowEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId,
          id, lines
        );
        storeyElementIds.push(winId);

      } else if (element.type === "door") {
        const doorId = writeDoorEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId,
          id, lines
        );
        storeyElementIds.push(doorId);

      } else if (element.type === "beam") {
        const beamId = writeBeamEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId,
          id, lines
        );
        storeyElementIds.push(beamId);

      } else if (element.type === "stair") {
        const stairId = writeStairEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId,
          id, lines
        );
        storeyElementIds.push(stairId);

      } else if (element.type === "space") {
        const spaceId = writeSpaceEntity(
          element, storeyPlacementId,
          bodyContextId, ownerHistId,
          id, lines
        );
        storeySpaceIds.push(spaceId);

      } else if (element.type === "duct") {
        const ductId = writeMEPSegmentEntity(
          element, "IFCDUCTSEGMENT", storeyPlacementId,
          bodyContextId, zDirId, ownerHistId, id, lines
        );
        storeyElementIds.push(ductId);

      } else if (element.type === "pipe") {
        const pipeId = writeMEPPipeEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId, id, lines
        );
        storeyElementIds.push(pipeId);

      } else if (element.type === "cable-tray") {
        const ctId = writeMEPSegmentEntity(
          element, "IFCCABLECARRIERSEGMENT", storeyPlacementId,
          bodyContextId, zDirId, ownerHistId, id, lines
        );
        storeyElementIds.push(ctId);

      } else if (element.type === "equipment") {
        const eqId = writeMEPEquipmentEntity(
          element, storeyPlacementId,
          bodyContextId, zDirId, ownerHistId, id, lines
        );
        storeyElementIds.push(eqId);

      } else if (element.type === "balcony") {
        // Balcony slabs use slab writer, railings use beam writer
        if (element.ifcType === "IfcRailing") {
          const rId = writeBeamEntity(element, storeyPlacementId, bodyContextId, zDirId, ownerHistId, id, lines);
          storeyElementIds.push(rId);
        } else {
          const bId = writeSlabEntity(element, element.vertices.length >= 4
            ? element.vertices.map(v => ({ x: v.x, y: v.y }))
            : geometry.footprint, storeyPlacementId, bodyContextId, ownerHistId, false, id, lines);
          storeyElementIds.push(bId);
        }

      } else if (element.type === "canopy") {
        const cId = writeSlabEntity(element, element.vertices.length >= 4
          ? element.vertices.map(v => ({ x: v.x, y: v.y }))
          : geometry.footprint, storeyPlacementId, bodyContextId, ownerHistId, true, id, lines);
        storeyElementIds.push(cId);
      }
    }

    // ── Spatial containment: physical elements → storey ──
    if (storeyElementIds.length > 0) {
      const relId = id.next();
      lines.push(`#${relId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid(relId)}',#${ownerHistId},'${safeName(storey.name)} Contents',$,(${storeyElementIds.map(i => `#${i}`).join(",")}),#${storeyId});`);
    }

    // ── Spatial decomposition: IfcSpace → storey (spaces are spatial elements) ──
    if (storeySpaceIds.length > 0) {
      const relSpaceId = id.next();
      lines.push(`#${relSpaceId}=IFCRELAGGREGATES('${ifcGuid(relSpaceId)}',#${ownerHistId},'${safeName(storey.name)} Spaces',$,#${storeyId},(${storeySpaceIds.map(i => `#${i}`).join(",")}));`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SPATIAL AGGREGATION: Project → Site → Building → Storeys
  // ═══════════════════════════════════════════════════════════════════════════
  const relProjSiteId = id.next();
  lines.push(`#${relProjSiteId}=IFCRELAGGREGATES('${ifcGuid(relProjSiteId)}',#${ownerHistId},'ProjectToSite',$,#${projectId},(#${siteId}));`);

  const relSiteBldgId = id.next();
  lines.push(`#${relSiteBldgId}=IFCRELAGGREGATES('${ifcGuid(relSiteBldgId)}',#${ownerHistId},'SiteToBuilding',$,#${siteId},(#${buildingId}));`);

  const relBldgStoreysId = id.next();
  lines.push(`#${relBldgStoreysId}=IFCRELAGGREGATES('${ifcGuid(relBldgStoreysId)}',#${ownerHistId},'BuildingToStoreys',$,#${buildingId},(${storeyIds.map(i => `#${i}`).join(",")}));`);

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPERTY SET: Building Info
  // ═══════════════════════════════════════════════════════════════════════════
  const propFloors = id.next();
  lines.push(`#${propFloors}=IFCPROPERTYSINGLEVALUE('NumberOfFloors',$,IFCINTEGER(${geometry.floors}),$);`);

  const propHeight = id.next();
  lines.push(`#${propHeight}=IFCPROPERTYSINGLEVALUE('TotalHeight',$,IFCLENGTHMEASURE(${f(geometry.totalHeight)}),$);`);

  const propGFA = id.next();
  lines.push(`#${propGFA}=IFCPROPERTYSINGLEVALUE('GrossFloorArea',$,IFCAREAMEASURE(${f(geometry.gfa, 2)}),$);`);

  const propFootprint = id.next();
  lines.push(`#${propFootprint}=IFCPROPERTYSINGLEVALUE('FootprintArea',$,IFCAREAMEASURE(${f(geometry.footprintArea, 2)}),$);`);

  const propType = id.next();
  lines.push(`#${propType}=IFCPROPERTYSINGLEVALUE('BuildingType',$,IFCTEXT('${safeName(geometry.buildingType)}'),$);`);

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${ifcGuid(psetId)}',#${ownerHistId},'BuildFlow_BuildingInfo',$,(#${propFloors},#${propHeight},#${propGFA},#${propFootprint},#${propType}));`);

  const relPsetId = id.next();
  lines.push(`#${relPsetId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relPsetId)}',#${ownerHistId},$,$,(#${buildingId}),#${psetId});`);

  // ═══════════════════════════════════════════════════════════════════════════
  // MATERIALS (shared material definitions)
  // ═══════════════════════════════════════════════════════════════════════════
  const matConcreteId = id.next();
  lines.push(`#${matConcreteId}=IFCMATERIAL('Reinforced Concrete C30/37',$,$);`);

  const matSteelId = id.next();
  lines.push(`#${matSteelId}=IFCMATERIAL('Structural Steel S355',$,$);`);

  const matGlassId = id.next();
  lines.push(`#${matGlassId}=IFCMATERIAL('Tempered Glass 6mm',$,$);`);

  const matTimberDoorId = id.next();
  lines.push(`#${matTimberDoorId}=IFCMATERIAL('Hardwood Timber',$,$);`);

  // ── Wall material layer set (concrete + insulation + plaster) ──
  const matInsulationId = id.next();
  lines.push(`#${matInsulationId}=IFCMATERIAL('Mineral Wool Insulation',$,$);`);

  const matPlasterId = id.next();
  lines.push(`#${matPlasterId}=IFCMATERIAL('Gypsum Plaster',$,$);`);

  const wallLayer1Id = id.next();
  lines.push(`#${wallLayer1Id}=IFCMATERIALLAYER(#${matPlasterId},0.015,.U.,$,$,$,$);`);

  const wallLayer2Id = id.next();
  lines.push(`#${wallLayer2Id}=IFCMATERIALLAYER(#${matConcreteId},0.15,.U.,$,$,$,$);`);

  const wallLayer3Id = id.next();
  lines.push(`#${wallLayer3Id}=IFCMATERIALLAYER(#${matInsulationId},0.07,.U.,$,$,$,$);`);

  const wallLayer4Id = id.next();
  lines.push(`#${wallLayer4Id}=IFCMATERIALLAYER(#${matPlasterId},0.015,.U.,$,$,$,$);`);

  const wallLayerSetId = id.next();
  lines.push(`#${wallLayerSetId}=IFCMATERIALLAYERSET((#${wallLayer1Id},#${wallLayer2Id},#${wallLayer3Id},#${wallLayer4Id}),'Wall Layer Set',$);`);

  const wallLayerSetUsageId = id.next();
  lines.push(`#${wallLayerSetUsageId}=IFCMATERIALLAYERSETUSAGE(#${wallLayerSetId},.AXIS2.,.POSITIVE.,0.);`);

  // ── Slab material layer set ──
  const slabLayer1Id = id.next();
  lines.push(`#${slabLayer1Id}=IFCMATERIALLAYER(#${matConcreteId},0.25,.U.,$,$,$,$);`);

  const slabLayer2Id = id.next();
  lines.push(`#${slabLayer2Id}=IFCMATERIALLAYER(#${matInsulationId},0.05,.U.,$,$,$,$);`);

  const slabLayerSetId = id.next();
  lines.push(`#${slabLayerSetId}=IFCMATERIALLAYERSET((#${slabLayer1Id},#${slabLayer2Id}),'Slab Layer Set',$);`);

  // ═══════════════════════════════════════════════════════════════════════════
  // STOREY-LEVEL PROPERTY SETS
  // ═══════════════════════════════════════════════════════════════════════════
  for (let si = 0; si < geometry.storeys.length; si++) {
    const st = geometry.storeys[si];
    const stId = storeyIds[si];

    const propElevation = id.next();
    lines.push(`#${propElevation}=IFCPROPERTYSINGLEVALUE('Elevation',$,IFCLENGTHMEASURE(${f(st.elevation)}),$);`);

    const propStoreyHeight = id.next();
    lines.push(`#${propStoreyHeight}=IFCPROPERTYSINGLEVALUE('Height',$,IFCLENGTHMEASURE(${f(st.height)}),$);`);

    const wallCount = st.elements.filter(e => e.type === "wall").length;
    const windowCount = st.elements.filter(e => e.type === "window").length;
    const doorCount = st.elements.filter(e => e.type === "door").length;

    const propWallCount = id.next();
    lines.push(`#${propWallCount}=IFCPROPERTYSINGLEVALUE('WallCount',$,IFCINTEGER(${wallCount}),$);`);

    const propWindowCount = id.next();
    lines.push(`#${propWindowCount}=IFCPROPERTYSINGLEVALUE('WindowCount',$,IFCINTEGER(${windowCount}),$);`);

    const propDoorCount = id.next();
    lines.push(`#${propDoorCount}=IFCPROPERTYSINGLEVALUE('DoorCount',$,IFCINTEGER(${doorCount}),$);`);

    const storeyPsetId = id.next();
    lines.push(`#${storeyPsetId}=IFCPROPERTYSET('${ifcGuid(storeyPsetId)}',#${ownerHistId},'BuildFlow_StoreyInfo',$,(#${propElevation},#${propStoreyHeight},#${propWallCount},#${propWindowCount},#${propDoorCount}));`);

    const relStoreyPsetId = id.next();
    lines.push(`#${relStoreyPsetId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relStoreyPsetId)}',#${ownerHistId},$,$,(#${stId}),#${storeyPsetId});`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASSEMBLE FILE
  // ═══════════════════════════════════════════════════════════════════════════
  return [header, ...lines, "ENDSEC;", "END-ISO-10303-21;"].join("\n");
}


// ─── Wall Entity Writer ─────────────────────────────────────────────────────

import type { GeometryElement, MassingStorey } from "@/types/geometry";

function writeWallEntity(
  element: GeometryElement,
  storey: MassingStorey,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const wallLength = element.properties.length ?? 10;
  const wallThickness = element.properties.thickness ?? 0.25;
  const wallHeight = element.properties.height ?? storey.height;

  // ── Profile: IfcRectangleProfileDef centered at (length/2, thickness/2) ──
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(wallLength / 2)},${f(wallThickness / 2)}));`);

  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Wall Profile',#${profPlacementId},${f(wallLength)},${f(wallThickness)});`);

  // ── Extrusion: Z-up by wallHeight ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(wallHeight)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement: position wall at its footprint vertex, oriented along wall direction ──
  const v0 = element.vertices[0];
  const v1 = element.vertices[1];
  const dx = v1.x - v0.x;
  const dy = v1.y - v0.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  const wallOriginId = id.next();
  lines.push(`#${wallOriginId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},0.));`);

  const wallXDirId = id.next();
  lines.push(`#${wallXDirId}=IFCDIRECTION((${f(dx / len, 6)},${f(dy / len, 6)},0.));`);

  const wallAxisId = id.next();
  lines.push(`#${wallAxisId}=IFCAXIS2PLACEMENT3D(#${wallOriginId},#${zDirId},#${wallXDirId});`);

  const wallPlacementId = id.next();
  lines.push(`#${wallPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${wallAxisId});`);

  // ── Wall entity (IFC4: .STANDARD. for exterior, .PARTITIONING. for interior) ──
  const wallPredefinedType = element.properties.isPartition ? ".PARTITIONING." : ".STANDARD.";
  const wallId = id.next();
  lines.push(`#${wallId}=IFCWALL('${ifcGuid(wallId)}',#${ownerHistId},'${element.properties.name}',$,$,#${wallPlacementId},#${prodShapeId},$,${wallPredefinedType});`);

  // ── Wall base quantities (Qto_WallBaseQuantities) ──
  const wallArea = wallLength * wallHeight;
  const wallVolume = wallArea * wallThickness;

  const qLength = id.next();
  lines.push(`#${qLength}=IFCQUANTITYLENGTH('Length',$,$,${f(wallLength)},$);`);

  const qHeight = id.next();
  lines.push(`#${qHeight}=IFCQUANTITYLENGTH('Height',$,$,${f(wallHeight)},$);`);

  const qWidth = id.next();
  lines.push(`#${qWidth}=IFCQUANTITYLENGTH('Width',$,$,${f(wallThickness)},$);`);

  const qGrossArea = id.next();
  lines.push(`#${qGrossArea}=IFCQUANTITYAREA('GrossSideArea',$,$,${f(wallArea, 2)},$);`);

  const qNetArea = id.next();
  lines.push(`#${qNetArea}=IFCQUANTITYAREA('NetSideArea',$,$,${f(wallArea * 0.85, 2)},$);`);

  const qVolume = id.next();
  lines.push(`#${qVolume}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(wallVolume, 4)},$);`);

  const wallQtoId = id.next();
  lines.push(`#${wallQtoId}=IFCELEMENTQUANTITY('${ifcGuid(wallQtoId)}',#${ownerHistId},'Qto_WallBaseQuantities_BF',$,$,(#${qLength},#${qHeight},#${qWidth},#${qGrossArea},#${qNetArea},#${qVolume}));`);

  const relWallQtoId = id.next();
  lines.push(`#${relWallQtoId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relWallQtoId)}',#${ownerHistId},$,$,(#${wallId}),#${wallQtoId});`);

  return wallId;
}


// ─── Slab Entity Writer ─────────────────────────────────────────────────────

function writeSlabEntity(
  element: GeometryElement,
  footprint: FootprintPoint[],
  storeyPlacementId: number,
  bodyContextId: number,
  ownerHistId: number,
  isRoof: boolean,
  id: IdCounter,
  lines: string[]
): number {
  const thickness = element.properties.thickness ?? 0.3;

  // ── Profile: IfcArbitraryClosedProfileDef from footprint polyline ──
  // Write 2D cartesian points for the profile
  const ptIds: number[] = [];
  for (const p of footprint) {
    const ptId = id.next();
    lines.push(`#${ptId}=IFCCARTESIANPOINT((${f(p.x)},${f(p.y)}));`);
    ptIds.push(ptId);
  }
  // Close the polyline: last point = first point
  ptIds.push(ptIds[0]);

  const polylineId = id.next();
  lines.push(`#${polylineId}=IFCPOLYLINE((${ptIds.map(i => `#${i}`).join(",")}));`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Slab Profile',#${polylineId});`);

  // ── Extrusion: Z-up by thickness ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(thickness)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement: offset slab downward by its thickness so top face is at floor level ──
  const slabOriginId = id.next();
  lines.push(`#${slabOriginId}=IFCCARTESIANPOINT((0.,0.,${f(-thickness)}));`);

  const slabAxisId = id.next();
  lines.push(`#${slabAxisId}=IFCAXIS2PLACEMENT3D(#${slabOriginId},$,$);`);

  const slabPlacementId = id.next();
  lines.push(`#${slabPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${slabAxisId});`);

  // ── Slab entity ──
  const predefinedType = isRoof ? ".ROOF." : ".FLOOR.";
  const slabId = id.next();
  lines.push(`#${slabId}=IFCSLAB('${ifcGuid(slabId)}',#${ownerHistId},'${element.properties.name}',$,$,#${slabPlacementId},#${prodShapeId},$,${predefinedType});`);

  // ── Slab base quantities (Qto_SlabBaseQuantities) ──
  const slabArea = element.properties.area ?? polygonAreaCalc(footprint);
  const slabVolume = slabArea * thickness;

  const sqDepth = id.next();
  lines.push(`#${sqDepth}=IFCQUANTITYLENGTH('Depth',$,$,${f(thickness)},$);`);

  const sqGrossArea = id.next();
  lines.push(`#${sqGrossArea}=IFCQUANTITYAREA('GrossArea',$,$,${f(slabArea, 2)},$);`);

  const sqNetArea = id.next();
  lines.push(`#${sqNetArea}=IFCQUANTITYAREA('NetArea',$,$,${f(slabArea * 0.95, 2)},$);`);

  const sqVolume = id.next();
  lines.push(`#${sqVolume}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(slabVolume, 4)},$);`);

  const sqPerimeter = id.next();
  const perimeterLen = footprint.reduce((sum, p, i) => {
    const np = footprint[(i + 1) % footprint.length];
    return sum + Math.sqrt((np.x - p.x) ** 2 + (np.y - p.y) ** 2);
  }, 0);
  lines.push(`#${sqPerimeter}=IFCQUANTITYLENGTH('Perimeter',$,$,${f(perimeterLen)},$);`);

  const slabQtoId = id.next();
  lines.push(`#${slabQtoId}=IFCELEMENTQUANTITY('${ifcGuid(slabQtoId)}',#${ownerHistId},'Qto_SlabBaseQuantities_BF',$,$,(#${sqDepth},#${sqGrossArea},#${sqNetArea},#${sqVolume},#${sqPerimeter}));`);

  const relSlabQtoId = id.next();
  lines.push(`#${relSlabQtoId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relSlabQtoId)}',#${ownerHistId},$,$,(#${slabId}),#${slabQtoId});`);

  return slabId;
}


// ─── Column Entity Writer ────────────────────────────────────────────────────

function writeColumnEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const colHeight = element.properties.height ?? 3.6;
  const colRadius = element.properties.radius ?? 0.3;

  // ── Profile: IfcCircleProfileDef ──
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((0.,0.));`);

  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCCIRCLEPROFILEDEF(.AREA.,'Column Profile',#${profPlacementId},${f(colRadius)});`);

  // ── Extrusion ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(colHeight)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement at column center ──
  // Get center from first vertex (bottom center of octagonal approximation)
  const cx = element.vertices.length > 0
    ? element.vertices.reduce((s, v) => s + v.x, 0) / element.vertices.length
    : 0;
  const cy = element.vertices.length > 0
    ? element.vertices.reduce((s, v) => s + v.y, 0) / element.vertices.length
    : 0;

  const colOriginId = id.next();
  lines.push(`#${colOriginId}=IFCCARTESIANPOINT((${f(cx)},${f(cy)},0.));`);

  const colAxisId = id.next();
  lines.push(`#${colAxisId}=IFCAXIS2PLACEMENT3D(#${colOriginId},#${zDirId},$);`);

  const colPlacementId = id.next();
  lines.push(`#${colPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${colAxisId});`);

  // ── Column entity ──
  const colId = id.next();
  lines.push(`#${colId}=IFCCOLUMN('${ifcGuid(colId)}',#${ownerHistId},'${element.properties.name}',$,$,#${colPlacementId},#${prodShapeId},$,.COLUMN.);`);

  return colId;
}


// ─── Space Entity Writer ─────────────────────────────────────────────────────

function writeSpaceEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const spaceHeight = element.properties.height ?? 3.6;
  const spaceFootprint = element.properties.spaceFootprint;

  if (!spaceFootprint || spaceFootprint.length < 3) {
    // Fallback: skip if no valid footprint
    const dummyId = id.next();
    lines.push(`#${dummyId}=IFCSPACE('${ifcGuid(dummyId)}',#${ownerHistId},'${element.properties.name}',$,$,#${storeyPlacementId},$,$,.ELEMENT.,.INTERNAL.,$);`);
    return dummyId;
  }

  // ── Profile: IfcArbitraryClosedProfileDef from space footprint ──
  const ptIds: number[] = [];
  for (const p of spaceFootprint) {
    const ptId = id.next();
    lines.push(`#${ptId}=IFCCARTESIANPOINT((${f(p.x)},${f(p.y)}));`);
    ptIds.push(ptId);
  }
  ptIds.push(ptIds[0]); // close polyline

  const polylineId = id.next();
  lines.push(`#${polylineId}=IFCPOLYLINE((${ptIds.map(i => `#${i}`).join(",")}));`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Space Profile',#${polylineId});`);

  // ── Extrusion ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(spaceHeight)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement ──
  const spaceOriginId = id.next();
  lines.push(`#${spaceOriginId}=IFCCARTESIANPOINT((0.,0.,0.));`);

  const spaceAxisId = id.next();
  lines.push(`#${spaceAxisId}=IFCAXIS2PLACEMENT3D(#${spaceOriginId},$,$);`);

  const spacePlacementId = id.next();
  lines.push(`#${spacePlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${spaceAxisId});`);

  // ── Space entity ──
  const spaceType = element.properties.spaceUsage === "circulation" ? ".GFA." : ".INTERNAL.";
  const spaceId = id.next();
  lines.push(`#${spaceId}=IFCSPACE('${ifcGuid(spaceId)}',#${ownerHistId},'${element.properties.spaceName ?? element.properties.name}',$,$,#${spacePlacementId},#${prodShapeId},$,.ELEMENT.,${spaceType},$);`);

  return spaceId;
}


// ─── Window Entity Writer ────────────────────────────────────────────────────

function writeWindowEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const winWidth = element.properties.width ?? 1.2;
  const winHeight = element.properties.height ?? 1.5;
  const winThickness = element.properties.thickness ?? 0.1;
  const sillHeight = element.properties.sillHeight ?? 0.9;
  const wallOffset = element.properties.wallOffset ?? 0;

  // ── Profile: IfcRectangleProfileDef ──
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(winWidth / 2)},${f(winThickness / 2)}));`);

  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Window Profile',#${profPlacementId},${f(winWidth)},${f(winThickness)});`);

  // ── Extrusion: Z-up by window height ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(winHeight)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement: position window along wall direction ──
  const dirX = element.properties.wallDirectionX ?? 1;
  const dirY = element.properties.wallDirectionY ?? 0;
  const origX = element.properties.wallOriginX ?? 0;
  const origY = element.properties.wallOriginY ?? 0;

  const winX = origX + dirX * wallOffset - dirX * winWidth / 2;
  const winY = origY + dirY * wallOffset - dirY * winWidth / 2;

  const winOriginId = id.next();
  lines.push(`#${winOriginId}=IFCCARTESIANPOINT((${f(winX)},${f(winY)},${f(sillHeight)}));`);

  const winXDirId = id.next();
  lines.push(`#${winXDirId}=IFCDIRECTION((${f(dirX, 6)},${f(dirY, 6)},0.));`);

  const winAxisId = id.next();
  lines.push(`#${winAxisId}=IFCAXIS2PLACEMENT3D(#${winOriginId},#${zDirId},#${winXDirId});`);

  const winPlacementId = id.next();
  lines.push(`#${winPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${winAxisId});`);

  // ── Window entity ──
  const winId = id.next();
  lines.push(`#${winId}=IFCWINDOW('${ifcGuid(winId)}',#${ownerHistId},'${element.properties.name}',$,$,#${winPlacementId},#${prodShapeId},$,${f(winHeight)},${f(winWidth)},.WINDOW.,.SINGLE_PANEL.,$);`);

  // ── Window property set (Pset_WindowCommon) ──
  const propGlazingType = id.next();
  lines.push(`#${propGlazingType}=IFCPROPERTYSINGLEVALUE('GlazingAreaFraction',$,IFCPOSITIVERATIOMEASURE(0.85),$);`);

  const propThermal = id.next();
  lines.push(`#${propThermal}=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(1.4),$);`);

  const propIsExternal = id.next();
  lines.push(`#${propIsExternal}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);`);

  const winPsetId = id.next();
  lines.push(`#${winPsetId}=IFCPROPERTYSET('${ifcGuid(winPsetId)}',#${ownerHistId},'Pset_WindowCommon',$,(#${propGlazingType},#${propThermal},#${propIsExternal}));`);

  const relWinPsetId = id.next();
  lines.push(`#${relWinPsetId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relWinPsetId)}',#${ownerHistId},$,$,(#${winId}),#${winPsetId});`);

  return winId;
}


// ─── Door Entity Writer ──────────────────────────────────────────────────────

function writeDoorEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const doorWidth = element.properties.width ?? 1.0;
  const doorHeight = element.properties.height ?? 2.1;
  const doorThickness = element.properties.thickness ?? 0.2;
  const wallOffset = element.properties.wallOffset ?? 0;

  // ── Profile ──
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(doorWidth / 2)},${f(doorThickness / 2)}));`);

  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Door Profile',#${profPlacementId},${f(doorWidth)},${f(doorThickness)});`);

  // ── Extrusion ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(doorHeight)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement ──
  const dirX = element.properties.wallDirectionX ?? 1;
  const dirY = element.properties.wallDirectionY ?? 0;
  const origX = element.properties.wallOriginX ?? 0;
  const origY = element.properties.wallOriginY ?? 0;

  const doorX = origX + dirX * wallOffset - dirX * doorWidth / 2;
  const doorY = origY + dirY * wallOffset - dirY * doorWidth / 2;

  const doorOriginId = id.next();
  lines.push(`#${doorOriginId}=IFCCARTESIANPOINT((${f(doorX)},${f(doorY)},0.));`);

  const doorXDirId = id.next();
  lines.push(`#${doorXDirId}=IFCDIRECTION((${f(dirX, 6)},${f(dirY, 6)},0.));`);

  const doorAxisId = id.next();
  lines.push(`#${doorAxisId}=IFCAXIS2PLACEMENT3D(#${doorOriginId},#${zDirId},#${doorXDirId});`);

  const doorPlacementId = id.next();
  lines.push(`#${doorPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${doorAxisId});`);

  // ── Door entity ──
  const isDoubleDoor = doorWidth >= 1.8;
  const operationType = isDoubleDoor ? ".DOUBLE_DOOR_SINGLE_SWING." : ".SINGLE_SWING_LEFT.";
  const doorId = id.next();
  lines.push(`#${doorId}=IFCDOOR('${ifcGuid(doorId)}',#${ownerHistId},'${element.properties.name}',$,$,#${doorPlacementId},#${prodShapeId},$,${f(doorHeight)},${f(doorWidth)},.DOOR.,${operationType},$);`);

  // ── Door property set (Pset_DoorCommon) ──
  const propFireRating = id.next();
  lines.push(`#${propFireRating}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('FD30'),$);`);

  const propIsExternal = id.next();
  lines.push(`#${propIsExternal}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);`);

  const propHandicap = id.next();
  lines.push(`#${propHandicap}=IFCPROPERTYSINGLEVALUE('HandicapAccessible',$,IFCBOOLEAN(${doorWidth >= 0.9 ? ".T." : ".F."}),$);`);

  const doorPsetId = id.next();
  lines.push(`#${doorPsetId}=IFCPROPERTYSET('${ifcGuid(doorPsetId)}',#${ownerHistId},'Pset_DoorCommon',$,(#${propFireRating},#${propIsExternal},#${propHandicap}));`);

  const relDoorPsetId = id.next();
  lines.push(`#${relDoorPsetId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relDoorPsetId)}',#${ownerHistId},$,$,(#${doorId}),#${doorPsetId});`);

  return doorId;
}


// ─── Beam Entity Writer ──────────────────────────────────────────────────────

function writeBeamEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const beamWidth = element.properties.width ?? 0.3;
  const beamDepth = element.properties.height ?? 0.5;
  const beamLength = element.properties.length ?? 6;

  // ── Profile: IfcRectangleProfileDef ──
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(beamWidth / 2)},${f(beamDepth / 2)}));`);

  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Beam Profile',#${profPlacementId},${f(beamWidth)},${f(beamDepth)});`);

  // ── Determine beam direction from vertices ──
  const v0 = element.vertices[0];
  const v4 = element.vertices[4]; // corresponding top vertex
  // Beam runs along longest axis
  const v1 = element.vertices[1];
  const lenX = Math.abs(v1.x - v0.x);
  const lenY = Math.abs(v1.y - v0.y);

  let beamDirX: number, beamDirY: number, beamStartX: number, beamStartY: number, beamZ: number;

  if (lenX > lenY) {
    // Beam runs along X
    beamDirX = v1.x > v0.x ? 1 : -1;
    beamDirY = 0;
    beamStartX = Math.min(v0.x, v1.x);
    beamStartY = v0.y;
  } else {
    // Beam runs along Y
    beamDirX = 0;
    beamDirY = 1;
    beamStartX = v0.x;
    beamStartY = Math.min(v0.y, v1.y);
  }
  beamZ = v0.z; // bottom of beam

  // ── Extrusion along beam length ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((${f(beamDirX, 6)},${f(beamDirY, 6)},0.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(beamLength)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement ──
  const beamOriginId = id.next();
  lines.push(`#${beamOriginId}=IFCCARTESIANPOINT((${f(beamStartX)},${f(beamStartY)},${f(beamZ)}));`);

  const beamAxisId = id.next();
  lines.push(`#${beamAxisId}=IFCAXIS2PLACEMENT3D(#${beamOriginId},#${zDirId},$);`);

  const beamPlacementId = id.next();
  lines.push(`#${beamPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${beamAxisId});`);

  // ── Beam entity ──
  const beamId = id.next();
  lines.push(`#${beamId}=IFCBEAM('${ifcGuid(beamId)}',#${ownerHistId},'${element.properties.name}',$,$,#${beamPlacementId},#${prodShapeId},$,.BEAM.);`);

  return beamId;
}


// ─── Stair Entity Writer ─────────────────────────────────────────────────────

function writeStairEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const stairWidth = element.properties.width ?? 1.2;
  const stairLength = element.properties.length ?? 3.0;
  const stairHeight = element.properties.height ?? 3.6;
  const riserCount = element.properties.riserCount ?? 20;
  const riserHeight = element.properties.riserHeight ?? 0.17;
  const treadDepth = element.properties.treadDepth ?? 0.28;

  // ── Profile: IfcRectangleProfileDef (simplified as a solid block) ──
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(stairWidth / 2)},${f(stairLength / 2)}));`);

  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Stair Profile',#${profPlacementId},${f(stairWidth)},${f(stairLength)});`);

  // ── Extrusion ──
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);

  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(stairHeight)});`);

  // ── Shape representation ──
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // ── Local placement ──
  const v0 = element.vertices[0];
  const stairOriginId = id.next();
  lines.push(`#${stairOriginId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},0.));`);

  const stairAxisId = id.next();
  lines.push(`#${stairAxisId}=IFCAXIS2PLACEMENT3D(#${stairOriginId},#${zDirId},$);`);

  const stairPlacementId = id.next();
  lines.push(`#${stairPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${stairAxisId});`);

  // ── StairFlight entity ──
  const stairId = id.next();
  lines.push(`#${stairId}=IFCSTAIRFLIGHT('${ifcGuid(stairId)}',#${ownerHistId},'${element.properties.name}',$,$,#${stairPlacementId},#${prodShapeId},$,${riserCount},${riserCount - 1},${f(riserHeight)},${f(treadDepth)},.STRAIGHT.);`);

  // ── Stair property set ──
  const propRiserCount = id.next();
  lines.push(`#${propRiserCount}=IFCPROPERTYSINGLEVALUE('NumberOfRiser',$,IFCINTEGER(${riserCount}),$);`);

  const propTreadCount = id.next();
  lines.push(`#${propTreadCount}=IFCPROPERTYSINGLEVALUE('NumberOfTreads',$,IFCINTEGER(${riserCount - 1}),$);`);

  const propRiserH = id.next();
  lines.push(`#${propRiserH}=IFCPROPERTYSINGLEVALUE('RiserHeight',$,IFCLENGTHMEASURE(${f(riserHeight)}),$);`);

  const propTreadD = id.next();
  lines.push(`#${propTreadD}=IFCPROPERTYSINGLEVALUE('TreadLength',$,IFCLENGTHMEASURE(${f(treadDepth)}),$);`);

  const stairPsetId = id.next();
  lines.push(`#${stairPsetId}=IFCPROPERTYSET('${ifcGuid(stairPsetId)}',#${ownerHistId},'Pset_StairFlightCommon_BF',$,(#${propRiserCount},#${propTreadCount},#${propRiserH},#${propTreadD}));`);

  const relStairPsetId = id.next();
  lines.push(`#${relStairPsetId}=IFCRELDEFINESBYPROPERTIES('${ifcGuid(relStairPsetId)}',#${ownerHistId},$,$,(#${stairId}),#${stairPsetId});`);

  return stairId;
}

// ─── MEP Entity Writers ──────────────────────────────────────────────────

/** Write IfcDuctSegment or IfcCableCarrierSegment — rectangular profile extrusion */
function writeMEPSegmentEntity(
  element: GeometryElement,
  ifcEntityName: string,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const segW = element.properties.width ?? 0.6;
  const segH = element.properties.height ?? 0.4;
  const segLen = element.properties.length ?? 5;
  const name = element.properties.name ?? "MEP Segment";

  // Rectangle profile
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(segW / 2)},${f(segH / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'${ifcEntityName} Profile',#${profPlacementId},${f(segW)},${f(segH)});`);

  // Extrusion along X axis (horizontal)
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((1.,0.,0.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(segLen)});`);

  // Shape
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // Placement
  const v = element.vertices[0] ?? { x: 0, y: 0, z: 0 };
  const originId = id.next();
  lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v.x)},${f(v.y)},${f(v.z)}));`);
  const axisId = id.next();
  lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${zDirId},$);`);
  const placementId = id.next();
  lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);

  // Entity
  const entityId = id.next();
  lines.push(`#${entityId}=${ifcEntityName}('${ifcGuid(entityId)}',#${ownerHistId},'${name}',$,$,#${placementId},#${prodShapeId},$,.NOTDEFINED.);`);

  return entityId;
}

/** Write IfcPipeSegment — circular profile extrusion (vertical) */
function writeMEPPipeEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const diameter = element.properties.diameter ?? 0.05;
  const pipeHeight = element.properties.height ?? element.properties.length ?? 3.6;
  const name = element.properties.name ?? "Pipe";

  // Circle profile
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((0.,0.));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCCIRCLEPROFILEDEF(.AREA.,'Pipe Profile',#${profPlacementId},${f(diameter / 2)});`);

  // Extrusion upward
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${zDirId},${f(pipeHeight)});`);

  // Shape
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // Placement
  const v = element.vertices[0] ?? { x: 0, y: 0, z: 0 };
  const originId = id.next();
  lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v.x)},${f(v.y)},${f(v.z)}));`);
  const axisId = id.next();
  lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${zDirId},$);`);
  const placementId = id.next();
  lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);

  // Entity
  const entityId = id.next();
  lines.push(`#${entityId}=IFCPIPESEGMENT('${ifcGuid(entityId)}',#${ownerHistId},'${name}',$,$,#${placementId},#${prodShapeId},$,.NOTDEFINED.);`);

  return entityId;
}

/** Write IfcFlowTerminal — rectangular box for equipment */
function writeMEPEquipmentEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  bodyContextId: number,
  zDirId: number,
  ownerHistId: number,
  id: IdCounter,
  lines: string[]
): number {
  const eqW = element.properties.width ?? 2.0;
  const eqH = element.properties.height ?? 1.8;
  const eqL = element.properties.length ?? 1.5;
  const name = element.properties.name ?? "Equipment";

  // Rectangle profile
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(eqW / 2)},${f(eqL / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Equipment Profile',#${profPlacementId},${f(eqW)},${f(eqL)});`);

  // Extrusion upward
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${zDirId},${f(eqH)});`);

  // Shape
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // Placement
  const v = element.vertices[0] ?? { x: 0, y: 0, z: 0 };
  const originId = id.next();
  lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v.x)},${f(v.y)},${f(v.z)}));`);
  const axisId = id.next();
  lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${zDirId},$);`);
  const placementId = id.next();
  lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);

  // Entity
  const entityId = id.next();
  lines.push(`#${entityId}=IFCFLOWTERMINAL('${ifcGuid(entityId)}',#${ownerHistId},'${name}',$,$,#${placementId},#${prodShapeId},$,.NOTDEFINED.);`);

  return entityId;
}

// ─── Multi-File Export ──────────────────────────────────────────────────

/**
 * Generate 4 separate IFC files: Architectural, Structural, MEP, and Combined.
 */
export function generateMultipleIFCFiles(
  geometry: MassingGeometry,
  options: IFCExportOptions = {}
): { architectural: string; structural: string; mep: string; combined: string } {
  return {
    architectural: generateIFCFile(geometry, { ...options, filter: "architectural" }),
    structural: generateIFCFile(geometry, { ...options, filter: "structural" }),
    mep: generateIFCFile(geometry, { ...options, filter: "mep" }),
    combined: generateIFCFile(geometry, { ...options, filter: "all" }),
  };
}
