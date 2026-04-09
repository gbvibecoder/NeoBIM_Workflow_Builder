/// <reference lib="webworker" />

/* ─── IFC Web Worker ─────────────────────────────────────────────────────────
   Offloads all web-ifc operations (parsing, geometry extraction, spatial tree,
   property extraction) to a background thread so the main thread stays responsive.
────────────────────────────────────────────────────────────────────────────── */

/* ─── IFC Constants (duplicated for worker isolation) ─────────────────────── */
const IFCPROJECT = 103090709;
const IFCSITE = 4097777520;
const IFCBUILDING = 4031249490;
const IFCBUILDINGSTOREY = 3124254112;
const IFCWALL = 2391406946;
const IFCWALLSTANDARDCASE = 3512223829;
const IFCWINDOW = 3304561284;
const IFCDOOR = 395920057;
const IFCSLAB = 1529196076;
const IFCCOLUMN = 843113511;
const IFCBEAM = 753842376;
const IFCSTAIR = 331165859;
const IFCSTAIRFLIGHT = 4252922144;
const IFCRAILING = 2262370178;
const IFCCOVERING = 1973544240;
const IFCROOF = 2016517767;
const IFCFOOTING = 900683007;
const IFCBUILDINGELEMENTPROXY = 1095909175;
const IFCMEMBER = 1073191201;
const IFCPLATE = 3171933400;
const IFCCURTAINWALL = 844099875;
const IFCFURNISHINGELEMENT = 263784265;
const IFCFLOWSEGMENT = 987401354;
const IFCFLOWTERMINAL = 2058353004;
const IFCFLOWFITTING = 4278956645;
const IFCSPACE = 3856911033;
const IFCOPENINGELEMENT = 3588315303;
const IFCRELCONTAINEDINSPATIALSTRUCTURE = 3242617779;
const IFCRELDEFINESBYPROPERTIES = 4186316022;
const IFCRELAGGREGATES = 160246688;
const IFCPROPERTYSET = 1451395588;
const IFCPROPERTYSINGLEVALUE = 3972844353;
const IFCELEMENTQUANTITY = 1883228015;

const BUILDING_ELEMENTS = [
  IFCWALL, IFCWALLSTANDARDCASE, IFCWINDOW, IFCDOOR, IFCSLAB,
  IFCCOLUMN, IFCBEAM, IFCSTAIR, IFCSTAIRFLIGHT, IFCRAILING,
  IFCCOVERING, IFCROOF, IFCFOOTING, IFCBUILDINGELEMENTPROXY,
  IFCMEMBER, IFCPLATE, IFCCURTAINWALL, IFCFURNISHINGELEMENT,
  IFCFLOWSEGMENT, IFCFLOWTERMINAL, IFCFLOWFITTING, IFCSPACE,
];

const TYPE_ID_TO_NAME: Record<number, string> = {
  [IFCWALL]: "IFCWALL", [IFCWALLSTANDARDCASE]: "IFCWALLSTANDARDCASE",
  [IFCWINDOW]: "IFCWINDOW", [IFCDOOR]: "IFCDOOR", [IFCSLAB]: "IFCSLAB",
  [IFCCOLUMN]: "IFCCOLUMN", [IFCBEAM]: "IFCBEAM", [IFCSTAIR]: "IFCSTAIR",
  [IFCSTAIRFLIGHT]: "IFCSTAIRFLIGHT", [IFCRAILING]: "IFCRAILING",
  [IFCCOVERING]: "IFCCOVERING", [IFCROOF]: "IFCROOF", [IFCFOOTING]: "IFCFOOTING",
  [IFCBUILDINGELEMENTPROXY]: "IFCBUILDINGELEMENTPROXY", [IFCMEMBER]: "IFCMEMBER",
  [IFCPLATE]: "IFCPLATE", [IFCCURTAINWALL]: "IFCCURTAINWALL",
  [IFCFURNISHINGELEMENT]: "IFCFURNISHINGELEMENT", [IFCFLOWSEGMENT]: "IFCFLOWSEGMENT",
  [IFCFLOWTERMINAL]: "IFCFLOWTERMINAL", [IFCFLOWFITTING]: "IFCFLOWFITTING",
  [IFCSPACE]: "IFCSPACE", [IFCOPENINGELEMENT]: "IFCOPENINGELEMENT",
  [IFCSITE]: "IFCSITE", [IFCBUILDING]: "IFCBUILDING",
  [IFCBUILDINGSTOREY]: "IFCBUILDINGSTOREY", [IFCPROJECT]: "IFCPROJECT",
};

const IFC_TYPE_NAMES: Record<string, string> = {
  IFCWALL: "Wall", IFCWALLSTANDARDCASE: "Wall", IFCWINDOW: "Window",
  IFCDOOR: "Door", IFCSLAB: "Slab", IFCCOLUMN: "Column", IFCBEAM: "Beam",
  IFCSTAIR: "Stair", IFCSTAIRFLIGHT: "Stair Flight", IFCRAILING: "Railing",
  IFCCOVERING: "Covering", IFCROOF: "Roof", IFCFOOTING: "Footing",
  IFCBUILDINGELEMENTPROXY: "Building Element", IFCMEMBER: "Member",
  IFCPLATE: "Plate", IFCCURTAINWALL: "Curtain Wall",
  IFCFURNISHINGELEMENT: "Furniture", IFCFLOWSEGMENT: "Pipe/Duct",
  IFCFLOWTERMINAL: "Terminal", IFCFLOWFITTING: "Fitting",
  IFCSPACE: "Space", IFCOPENINGELEMENT: "Opening",
  IFCSITE: "Site", IFCBUILDING: "Building",
  IFCBUILDINGSTOREY: "Storey", IFCPROJECT: "Project",
};

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface GeometryTransfer {
  expressID: number;
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  color: [number, number, number, number];
  transform: number[];
}

interface SpatialNode {
  expressID: number;
  type: string;
  name: string;
  children: SpatialNode[];
  elementCount: number;
  visible: boolean;
}

interface PropertySet {
  name: string;
  properties: { name: string; value: string | number | boolean }[];
}

interface QuantityEntry {
  name: string;
  value: number;
  unit: string;
}

interface ElementData {
  expressID: number;
  type: string;
  typeName: string;
  name: string;
  globalId: string;
  description: string;
  storey: string;
  material: string;
  propertySets: PropertySet[];
  quantities: QuantityEntry[];
}

/* ─── State ───────────────────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let api: any = null;
let modelID = -1;
const typeMap = new Map<number, number>();
const storeyMap = new Map<number, number>();
const storeyIndexMap = new Map<number, number>();

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function safeString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && "value" in (val as Record<string, unknown>))
    return String((val as Record<string, unknown>).value ?? "");
  return String(val);
}

function post(msg: unknown) {
  postMessage(msg);
}

function postTransferable(msg: unknown, transferables: Transferable[]) {
  postMessage(msg, transferables as never);
}

/* ─── Message Handler ─────────────────────────────────────────────────────── */

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  switch (msg.type) {
    case "parse":
      await handleParse(msg.buffer, msg.filename);
      break;
    case "getProperties":
      handleGetProperties(msg.expressID, msg.requestId);
      break;
    case "close":
      handleClose();
      break;
  }
};

/* ─── Parse ───────────────────────────────────────────────────────────────── */

async function handleParse(buffer: ArrayBuffer, filename: string) {
  try {
    post({ type: "progress", progress: 5, message: "Initializing IFC engine..." });

    const webIfc = await import("web-ifc");
    api = new webIfc.IfcAPI();
    /* Workers don't have window — use self.location.origin for absolute WASM URL */
    api.SetWasmPath(self.location.origin + "/wasm/", true);
    await api.Init();

    post({ type: "progress", progress: 15, message: "Parsing IFC file..." });

    const data = new Uint8Array(buffer);
    modelID = api.OpenModel(data, { COORDINATE_TO_ORIGIN: true, OPTIMIZE_PROFILES: true });
    const schema = api.GetModelSchema(modelID) || "Unknown";

    post({ type: "progress", progress: 25, message: "Extracting geometry..." });

    /* ── Stream meshes in batches ── */
    let meshCount = 0;
    let batch: GeometryTransfer[] = [];
    const BATCH_SIZE = 25;

    api.StreamAllMeshes(modelID, (mesh: {
      expressID: number;
      geometries: {
        size: () => number;
        get: (i: number) => {
          color: { x: number; y: number; z: number; w: number };
          geometryExpressID: number;
          flatTransformation: number[];
        };
      };
    }) => {
      const expressID = mesh.expressID;
      const geoCount = mesh.geometries.size();

      for (let i = 0; i < geoCount; i++) {
        const pg = mesh.geometries.get(i);
        let geom;
        try {
          geom = api.GetGeometry(modelID, pg.geometryExpressID);
        } catch {
          continue;
        }

        const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
        const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

        if (verts.length === 0 || indices.length === 0) {
          geom.delete();
          continue;
        }

        const vertexCount = verts.length / 6;
        const positions = new Float32Array(vertexCount * 3);
        const normals = new Float32Array(vertexCount * 3);

        for (let v = 0; v < vertexCount; v++) {
          positions[v * 3] = verts[v * 6];
          positions[v * 3 + 1] = verts[v * 6 + 1];
          positions[v * 3 + 2] = verts[v * 6 + 2];
          normals[v * 3] = verts[v * 6 + 3];
          normals[v * 3 + 1] = verts[v * 6 + 4];
          normals[v * 3 + 2] = verts[v * 6 + 5];
        }

        batch.push({
          expressID,
          positions,
          normals,
          indices: new Uint32Array(indices),
          color: [pg.color.x, pg.color.y, pg.color.z, pg.color.w],
          transform: Array.from(pg.flatTransformation),
        });

        geom.delete();
      }

      meshCount++;

      if (batch.length >= BATCH_SIZE) {
        sendBatch(batch);
        batch = [];
      }

      if (meshCount % 50 === 0) {
        post({
          type: "progress",
          progress: 25 + Math.min(50, (meshCount / 500) * 50),
          message: `Processing geometry (${meshCount} elements)...`,
        });
      }
    });

    /* Flush remaining */
    if (batch.length > 0) sendBatch(batch);

    post({ type: "progress", progress: 80, message: "Building spatial structure..." });

    /* ── Build type map ── */
    typeMap.clear();
    for (const tid of BUILDING_ELEMENTS) {
      try {
        const ids = api.GetLineIDsWithType(modelID, tid);
        for (let i = 0; i < ids.size(); i++) {
          typeMap.set(ids.get(i), tid);
        }
      } catch { /* skip */ }
    }

    /* ── Build storey map + spatial tree ── */
    storeyMap.clear();
    storeyIndexMap.clear();
    const tree = buildSpatialTree();

    /* ── Send metadata ── */
    post({
      type: "metadata",
      typeEntries: [...typeMap.entries()],
      storeyEntries: [...storeyMap.entries()],
      storeyIndexEntries: [...storeyIndexMap.entries()],
    });

    post({ type: "spatialTree", tree });

    /* ── Model info ── */
    const projectIDs = api.GetLineIDsWithType(modelID, IFCPROJECT);
    let projectName = filename;
    if (projectIDs.size() > 0) {
      try {
        const proj = api.GetLine(modelID, projectIDs.get(0), false);
        if (proj?.Name) projectName = safeString(proj.Name) || filename;
      } catch { /* use filename */ }
    }
    const storeyIDs = api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);

    post({
      type: "modelInfo",
      info: {
        modelID,
        schema,
        name: projectName,
        description: "",
        fileSize: buffer.byteLength,
        fileName: filename,
        elementCount: meshCount,
        storeyCount: storeyIDs.size(),
      },
    });

    post({ type: "progress", progress: 100, message: "Complete" });
    post({ type: "complete" });
  } catch (err) {
    post({ type: "error", message: `IFC parsing failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

function sendBatch(batch: GeometryTransfer[]) {
  const transferables: ArrayBuffer[] = [];
  for (const item of batch) {
    transferables.push(item.positions.buffer as ArrayBuffer, item.normals.buffer as ArrayBuffer, item.indices.buffer as ArrayBuffer);
  }
  postTransferable({ type: "meshBatch", batch }, transferables);
}

/* ─── Spatial Tree ────────────────────────────────────────────────────────── */

function buildSpatialTree(): SpatialNode[] {
  const tree: SpatialNode[] = [];
  if (!api || modelID < 0) return tree;

  try {
    /* Aggregation relationships */
    const aggRels = api.GetLineIDsWithType(modelID, IFCRELAGGREGATES);
    const aggMap = new Map<number, number[]>();
    for (let i = 0; i < aggRels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, aggRels.get(i), false);
        const parentRef = rel.RelatingObject;
        const parentID = typeof parentRef === "object" ? parentRef.value : parentRef;
        const children = rel.RelatedObjects;
        const childIDs: number[] = [];
        if (children) {
          const len = children.length ?? children.size?.() ?? 0;
          for (let j = 0; j < len; j++) {
            const c = children[j] ?? children.get?.(j);
            const cid = typeof c === "object" ? c.value : c;
            if (cid) childIDs.push(cid);
          }
        }
        aggMap.set(parentID, [...(aggMap.get(parentID) ?? []), ...childIDs]);
      } catch { /* skip */ }
    }

    /* Containment (storey -> elements) */
    const contRels = api.GetLineIDsWithType(modelID, IFCRELCONTAINEDINSPATIALSTRUCTURE);
    const contMap = new Map<number, number[]>();
    for (let i = 0; i < contRels.size(); i++) {
      try {
        const rel = api.GetLine(modelID, contRels.get(i), false);
        const structRef = rel.RelatingStructure;
        const structID = typeof structRef === "object" ? structRef.value : structRef;
        const elements = rel.RelatedElements;
        const elemIDs: number[] = [];
        if (elements) {
          const len = elements.length ?? elements.size?.() ?? 0;
          for (let j = 0; j < len; j++) {
            const e = elements[j] ?? elements.get?.(j);
            const eid = typeof e === "object" ? e.value : e;
            if (eid) {
              elemIDs.push(eid);
              storeyMap.set(eid, structID);
            }
          }
        }
        contMap.set(structID, [...(contMap.get(structID) ?? []), ...elemIDs]);
      } catch { /* skip */ }
    }

    /* Recursive builder */
    const buildNode = (expressID: number): SpatialNode | null => {
      try {
        const element = api.GetLine(modelID, expressID, false);
        if (!element) return null;
        const tid = element.type ?? 0;
        const ifcName = TYPE_ID_TO_NAME[tid] ?? "UNKNOWN";

        if (tid === IFCBUILDINGSTOREY) {
          storeyIndexMap.set(expressID, storeyIndexMap.size);
        }

        const node: SpatialNode = {
          expressID,
          type: ifcName,
          name: safeString(element.Name) || IFC_TYPE_NAMES[ifcName] || ifcName,
          children: [],
          elementCount: 0,
          visible: true,
        };

        /* Aggregated children */
        for (const childID of aggMap.get(expressID) ?? []) {
          const child = buildNode(childID);
          if (child) node.children.push(child);
        }

        /* Contained elements grouped by type */
        const contained = contMap.get(expressID) ?? [];
        if (contained.length > 0) {
          const byType = new Map<string, number[]>();
          for (const eid of contained) {
            const et = typeMap.get(eid);
            const tn = et ? (TYPE_ID_TO_NAME[et] ?? "OTHER") : "OTHER";
            const display = IFC_TYPE_NAMES[tn] ?? tn;
            if (!byType.has(display)) byType.set(display, []);
            byType.get(display)!.push(eid);
          }
          for (const [typeName, ids] of byType) {
            node.children.push({
              expressID: -ids[0],
              type: "GROUP",
              name: `${typeName} (${ids.length})`,
              children: ids.map((eid) => ({
                expressID: eid,
                type: TYPE_ID_TO_NAME[typeMap.get(eid) ?? 0] ?? "ELEMENT",
                name: (() => {
                  try {
                    const el = api.GetLine(modelID, eid, false);
                    return safeString(el?.Name) || `#${eid}`;
                  } catch { return `#${eid}`; }
                })(),
                children: [],
                elementCount: 0,
                visible: true,
              })),
              elementCount: ids.length,
              visible: true,
            });
          }
          node.elementCount = contained.length;
        }

        return node;
      } catch { return null; }
    };

    const projectIDs = api.GetLineIDsWithType(modelID, IFCPROJECT);
    for (let i = 0; i < projectIDs.size(); i++) {
      const node = buildNode(projectIDs.get(i));
      if (node) tree.push(node);
    }
  } catch { /* failed */ }

  return tree;
}

/* ─── Property Extraction ─────────────────────────────────────────────────── */

function handleGetProperties(expressID: number, requestId: number) {
  if (!api || modelID < 0) {
    post({ type: "properties", requestId, data: null });
    return;
  }

  try {
    const element = api.GetLine(modelID, expressID, false);
    if (!element) { post({ type: "properties", requestId, data: null }); return; }

    const tid = element.type ?? 0;
    const ifcName = TYPE_ID_TO_NAME[tid] ?? "UNKNOWN";

    const data: ElementData = {
      expressID,
      type: ifcName,
      typeName: IFC_TYPE_NAMES[ifcName] ?? ifcName,
      name: safeString(element.Name),
      globalId: safeString(element.GlobalId),
      description: safeString(element.Description),
      storey: "",
      material: "",
      propertySets: [],
      quantities: [],
    };

    /* Property sets */
    try {
      const propRels = api.GetLineIDsWithType(modelID, IFCRELDEFINESBYPROPERTIES);
      for (let i = 0; i < propRels.size(); i++) {
        const rel = api.GetLine(modelID, propRels.get(i), false);
        const related = rel.RelatedObjects;
        let found = false;
        if (related) {
          for (let j = 0; j < (related.length ?? related.size?.()); j++) {
            const ref = related[j] ?? related.get?.(j);
            const refID = typeof ref === "object" ? ref.value : ref;
            if (refID === expressID) { found = true; break; }
          }
        }
        if (!found) continue;

        const psetRef = rel.RelatingPropertyDefinition;
        const psetID = typeof psetRef === "object" ? psetRef.value : psetRef;
        if (!psetID) continue;

        try {
          const pset = api.GetLine(modelID, psetID, false);
          if (!pset) continue;

          if (pset.type === IFCPROPERTYSET && pset.HasProperties) {
            const ps: PropertySet = { name: safeString(pset.Name), properties: [] };
            const props = pset.HasProperties;
            for (let k = 0; k < (props.length ?? props.size?.()); k++) {
              const propRef = props[k] ?? props.get?.(k);
              const propID = typeof propRef === "object" ? propRef.value : propRef;
              if (!propID) continue;
              try {
                const prop = api.GetLine(modelID, propID, false);
                if (prop && prop.type === IFCPROPERTYSINGLEVALUE) {
                  const val = prop.NominalValue;
                  ps.properties.push({
                    name: safeString(prop.Name),
                    value: val ? (typeof val === "object" ? val.value : val) : "",
                  });
                }
              } catch { /* skip */ }
            }
            if (ps.properties.length > 0) data.propertySets.push(ps);
          } else if (pset.type === IFCELEMENTQUANTITY && pset.Quantities) {
            const qs = pset.Quantities;
            for (let k = 0; k < (qs.length ?? qs.size?.()); k++) {
              const qRef = qs[k] ?? qs.get?.(k);
              const qID = typeof qRef === "object" ? qRef.value : qRef;
              if (!qID) continue;
              try {
                const q = api.GetLine(modelID, qID, false);
                if (!q) continue;
                const name = safeString(q.Name);
                const val =
                  q.LengthValue?.value ?? q.AreaValue?.value ??
                  q.VolumeValue?.value ?? q.WeightValue?.value ??
                  q.CountValue?.value ?? null;
                if (val !== null) {
                  let unit = "";
                  if (q.LengthValue) unit = "m";
                  else if (q.AreaValue) unit = "m²";
                  else if (q.VolumeValue) unit = "m³";
                  else if (q.WeightValue) unit = "kg";
                  data.quantities.push({ name, value: Number(val), unit });
                }
              } catch { /* skip */ }
            }
          }
        } catch { /* skip pset */ }
      }
    } catch { /* skip all properties */ }

    post({ type: "properties", requestId, data });
  } catch {
    post({ type: "properties", requestId, data: null });
  }
}

/* ─── Close ───────────────────────────────────────────────────────────────── */

function handleClose() {
  if (api && modelID >= 0) {
    try { api.CloseModel(modelID); } catch { /* ok */ }
  }
  modelID = -1;
  api = null;
  typeMap.clear();
  storeyMap.clear();
  storeyIndexMap.clear();
}
