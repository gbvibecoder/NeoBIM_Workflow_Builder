"use client";

import React, {
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Scene, Color, MeshStandardMaterial, Camera, ShaderMaterial, Mesh, PlaneGeometry, PerspectiveCamera, WebGLRenderer, AmbientLight, DirectionalLight, HemisphereLight, PMREMGenerator, ShadowMaterial, Raycaster, Vector2, Box3, Vector3, SphereGeometry, MeshBasicMaterial, BufferGeometry, BufferAttribute, Matrix4, EdgesGeometry, LineSegments, LineBasicMaterial, Line, CanvasTexture, SpriteMaterial, Sprite, Plane, PlaneHelper, Group, DoubleSide, PCFSoftShadowMap, ACESFilmicToneMapping, SRGBColorSpace, GridHelper, Material, Object3D } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SCENE, CATEGORY_COLORS, STOREY_COLORS } from "@/features/ifc/components/constants";
import type {
  ViewportHandle,
  ViewModeType,
  ColorByType,
  ProjectionType,
  PresetView,
  SectionAxis,
  IFCElementData,
  SpatialNode,
  IFCModelInfo,
  MeasurementData,
  SceneRefs,
  EnhancementTier,
  PropertySet,
} from "@/types/ifc-viewer";
import { IFC_TYPE_NAMES } from "@/types/ifc-viewer";

/* ─── web-ifc constants (avoid top-level import for SSR safety) ───── */
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

/* ─── Helpers ──────────────────────────────────────────────────── */

function safeString(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "object" && "value" in (val as Record<string, unknown>))
    return String((val as Record<string, unknown>).value ?? "");
  return String(val);
}

function getTypeName(typeId: number): string {
  const ifcName = TYPE_ID_TO_NAME[typeId] ?? "UNKNOWN";
  return IFC_TYPE_NAMES[ifcName] ?? ifcName;
}

/* ─── Props ─────────────────────────────────────────────────── */

interface ContextMenuEvent {
  x: number;
  y: number;
  expressID: number;
  typeName: string;
}

interface ViewportProps {
  onSelect: (element: IFCElementData | null) => void;
  onSpatialTree: (tree: SpatialNode[]) => void;
  onModelInfo: (info: IFCModelInfo) => void;
  onProgress: (progress: number, message: string) => void;
  onLoadComplete: () => void;
  onError: (message: string) => void;
  onMeasurement: (m: MeasurementData) => void;
  onContextMenu?: (data: ContextMenuEvent | null) => void;
}

/* ─── Component ──────────────────────────────────────────────── */

const Viewport = forwardRef<ViewportHandle, ViewportProps>(function Viewport(
  { onSelect, onSpatialTree, onModelInfo, onProgress, onLoadComplete, onError, onMeasurement, onContextMenu },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const rafRef = useRef<number>(0);
  const modelGroupRef = useRef<Group>(new Group());
  const edgesGroupRef = useRef<Group>(new Group());
  const measureGroupRef = useRef<Group>(new Group());
  const gridRef = useRef<GridHelper | null>(null);

  /* Enhance feature scaffolding — tier-scoped group so each tier can be
     unmounted independently. Created lazily in the scene-setup effect. */
  const enhancementGroupRef = useRef<Group | null>(null);
  const enhancementTierGroupsRef = useRef<Map<EnhancementTier, Group>>(new Map());

  /* Wall PSet data pushed by the worker at parse time (IsExternal, FireRating
     from Pset_WallCommon). Empty until the `metadata` worker message lands. */
  const wallPsetsRef = useRef<Map<number, { isExternal: boolean | null; fireRating: string | null }>>(new Map());

  /* Worker */
  const workerRef = useRef<Worker | null>(null);
  const propertyCallbacksRef = useRef<Map<number, (data: IFCElementData | null) => void>>(new Map());
  const requestIdRef = useRef(0);

  /* IFC refs */
  const modelIDRef = useRef<number>(-1);
  const meshMapRef = useRef<Map<number, Mesh[]>>(new Map());
  const expressIDToTypeRef = useRef<Map<number, number>>(new Map());
  const expressIDToStoreyRef = useRef<Map<number, number>>(new Map());
  const storeyIndexRef = useRef<Map<number, number>>(new Map());
  const originalMaterialsRef = useRef<Map<string, Material | Material[]>>(new Map());
  const hiddenRef = useRef<Set<number>>(new Set());

  /* Selection */
  const selectedIDRef = useRef<number | null>(null);
  const selectedIDsRef = useRef<Set<number>>(new Set());
  const highlightMatRef = useRef(
    new MeshStandardMaterial({
      color: SCENE.highlightColor,
      emissive: new Color(SCENE.highlightEmissive),
      emissiveIntensity: 0.35,
      roughness: 0.4,
      metalness: 0.1,
      opacity: SCENE.selectionOpacity,
      transparent: true,
      side: DoubleSide,
      depthTest: true,
    })
  );

  /* Hover */
  const hoverIDRef = useRef<number | null>(null);
  const hoverMatRef = useRef(
    new MeshStandardMaterial({
      color: 0x6699cc,
      emissive: new Color(0x223355),
      emissiveIntensity: 0.2,
      roughness: 0.5,
      metalness: 0.1,
      opacity: 0.8,
      transparent: true,
      side: DoubleSide,
    })
  );

  /* View state refs */
  const viewModeRef = useRef<ViewModeType>("shaded");
  const colorByRef = useRef<ColorByType>("default");
  const showEdgesRef = useRef(false);
  const showGridRef = useRef(true);
  const projRef = useRef<ProjectionType>("perspective");

  /* Section planes */
  const clippingPlanesRef = useRef<Map<SectionAxis, Plane>>(new Map());
  const planeHelpersRef = useRef<Map<SectionAxis, PlaneHelper>>(new Map());

  /* Measurement */
  const measureModeRef = useRef(false);
  const measurePointRef = useRef<Vector3 | null>(null);
  const measureCountRef = useRef(0);
  const measureUnitRef = useRef<"m" | "ft">("m");

  /* View cube camera sync */
  const onCameraChangeRef = useRef<((css: string) => void) | null>(null);

  /* Camera animation (smooth transitions) */
  const cameraTargetPosRef = useRef<Vector3 | null>(null);
  const controlsTargetRef = useRef<Vector3 | null>(null);

  /* Ground plane + shadow light */
  const groundRef = useRef<Mesh | null>(null);
  const keyLightRef = useRef<DirectionalLight | null>(null);

  /* Background gradient scene (rendered separately, bypasses tonemapping) */
  const bgSceneRef = useRef<Scene | null>(null);
  const bgCameraRef = useRef<Camera | null>(null);

  /* Panorama coordination flag — read by Tier 1 (and any future engine) so
     they don't fight the panorama for ownership of `scene.background`. The
     panorama controller toggles this via the imperative handle. */
  const panoramaActiveRef = useRef(false);

  /* V6: original modelGroup position captured on load. Panorama V6 uses
     this to translate the BIM in front of the panorama camera and to
     restore the model on panorama reset. Default (0,0,0) — IFC files
     historically place geometry near origin; off-origin model handling
     is out of V6 scope. */
  const originalModelPositionRef = useRef<Vector3>(new Vector3(0, 0, 0));

  /* ────────────────────────────────────────────────────────── */
  /* Scene setup                                                */
  /* ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    /* WebGL detection */
    try {
      const testCanvas = document.createElement("canvas");
      const gl = testCanvas.getContext("webgl2") || testCanvas.getContext("webgl");
      if (!gl) {
        onError("Your browser does not support WebGL. Please use Chrome, Firefox, or Edge.");
        return;
      }
    } catch {
      onError("WebGL initialization failed. Please try a different browser.");
      return;
    }

    const scene = new Scene();

    /* Blueprint grid background — matches landing page .blueprint-grid
       Rendered in a SEPARATE scene with toneMapped:false to bypass ACES tonemapping.
       Uses gl_FragCoord for pixel-perfect grid lines (square cells). */
    scene.background = new Color(0xf6f7f9);
    sceneRef.current = scene;

    const bgGradScene = new Scene();
    const bgGradCamera = new Camera();
    const bgGradMat = new ShaderMaterial({
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv;
        void main() {
          /* White base with very subtle vertical shading */
          float vy = vUv.y;
          vec3 top    = vec3(0.965, 0.969, 0.976);
          vec3 bottom = vec3(0.992, 0.992, 0.996);
          vec3 bg = mix(bottom, top, vy);

          /* Architectural grid (pixel coords → square cells) */
          vec2 px = gl_FragCoord.xy;

          /* Major grid: 120px spacing */
          vec2 dMaj = abs(mod(px + 60.0, 120.0) - 60.0);
          float major = max(
            1.0 - smoothstep(0.0, 1.5, dMaj.x),
            1.0 - smoothstep(0.0, 1.5, dMaj.y)
          );

          /* Minor grid: 24px spacing */
          vec2 dMin = abs(mod(px + 12.0, 24.0) - 12.0);
          float minor = max(
            1.0 - smoothstep(0.0, 1.0, dMin.x),
            1.0 - smoothstep(0.0, 1.0, dMin.y)
          );

          /* Grid line color: cool gray */
          vec3 gridGray = vec3(0.55, 0.60, 0.66);

          vec3 color = bg;
          color = mix(color, gridGray, minor * 0.18);
          color = mix(color, gridGray, major * 0.32);

          /* Soft radial vignette so edges fade gently */
          vec2 center = vUv - vec2(0.5, 0.45);
          float vig = 1.0 - smoothstep(0.15, 0.85, length(center * vec2(1.25, 1.43)));
          color = mix(bg, color, vig);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    bgGradScene.add(new Mesh(new PlaneGeometry(2, 2), bgGradMat));
    bgSceneRef.current = bgGradScene;
    bgCameraRef.current = bgGradCamera;

    const camera = new PerspectiveCamera(
      SCENE.cameraFov,
      container.clientWidth / container.clientHeight,
      SCENE.cameraNear,
      SCENE.cameraFar
    );
    camera.position.set(15, 15, 15);
    cameraRef.current = camera;

    /* ── Renderer with shadows + tone mapping ── */
    const renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, SCENE.maxPixelRatio));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.localClippingEnabled = true;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = SCENE.orbitDamping;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.5;
    controls.maxDistance = 2000;
    controlsRef.current = controls;

    /* Cancel camera animation when user starts interacting */
    controls.addEventListener("start", () => {
      cameraTargetPosRef.current = null;
      controlsTargetRef.current = null;
    });

    /* ── Studio-quality 5-light rig ── */
    const ambient = new AmbientLight(0xffffff, 0.3);
    scene.add(ambient);

    const keyLight = new DirectionalLight(0xfff5e6, 0.8);
    keyLight.position.set(50, 80, 50);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 500;
    keyLight.shadow.camera.left = -100;
    keyLight.shadow.camera.right = 100;
    keyLight.shadow.camera.top = 100;
    keyLight.shadow.camera.bottom = -100;
    keyLight.shadow.bias = -0.0001;
    keyLight.shadow.radius = 4;
    scene.add(keyLight);
    keyLightRef.current = keyLight;

    const fillLight = new DirectionalLight(0xe6eeff, 0.4);
    fillLight.position.set(-30, 40, -30);
    scene.add(fillLight);

    const rimLight = new DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(0, 10, -50);
    scene.add(rimLight);

    const hemiLight = new HemisphereLight(0x4a5a6e, 0x1a1510, 0.25);
    scene.add(hemiLight);

    /* ── Environment map for subtle reflections (dark, neutral) ── */
    const pmremGenerator = new PMREMGenerator(renderer);
    const envScene = new Scene();
    envScene.background = new Color(0x2a2d3a);
    const envMap = pmremGenerator.fromScene(envScene).texture;
    scene.environment = envMap;
    pmremGenerator.dispose();

    /* ── Ground plane (receives contact shadows) ── */
    const groundGeo = new PlaneGeometry(500, 500);
    const groundMat = new ShadowMaterial({ opacity: 0.15 });
    const ground = new Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.01;
    ground.receiveShadow = true;
    ground.visible = false;
    scene.add(ground);
    groundRef.current = ground;

    /* ── Subtle professional grid ── */
    /* Truly infinite architectural grid — full-screen ground plane drawn in
       a vertex shader that projects a quad onto Y=0, plus a fragment shader
       with LOD blending between two cell scales (auto-picked from camera
       distance). Lines stay crisp at any zoom and the grid never runs out. */
    const gridGeo = new PlaneGeometry(2, 2);
    const gridMat = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uMinorColor: { value: new Color(0xc4cad3) },
        uMajorColor: { value: new Color(0x8a93a0) },
      },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          /* Place a huge ground quad centered under the camera so it always
             covers the view — the fragment shader handles the actual grid. */
          vec3 p = position;
          float S = 100000.0;
          vWorld = vec3(p.x * S + cameraPosition.x, 0.0, p.y * S + cameraPosition.z);
          gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorld;
        uniform vec3 uMinorColor;
        uniform vec3 uMajorColor;

        /* Anti-aliased grid line factor for a given world-space cell size.
           Uses screen-space derivatives so lines stay ~1 pixel wide at any
           zoom level. */
        float gridFactor(vec2 p, float scale) {
          vec2 coord = p / scale;
          vec2 deriv = fwidth(coord);
          vec2 g = abs(fract(coord - 0.5) - 0.5) / deriv;
          float line = min(g.x, g.y);
          return 1.0 - min(line, 1.0);
        }

        void main() {
          vec2 p = vWorld.xz;

          /* LOD: derive cell size from how many world units a pixel covers.
             Always renders three scales blended so the grid never washes out
             at any zoom level (true infinite grid). */
          vec2 dudv = fwidth(p);
          float pix = max(dudv.x, dudv.y);
          float lodLevel = max(0.0, log(pix * 25.0) / log(10.0));
          float lodFade = fract(lodLevel);
          float l0 = pow(10.0, floor(lodLevel));
          float l1 = l0 * 10.0;
          float l2 = l0 * 100.0;

          float g0 = gridFactor(p, l0);
          float g1 = gridFactor(p, l1);
          float g2 = gridFactor(p, l2);

          /* Smaller cells fade out as we zoom away; larger cells take over. */
          float minor = mix(g1, g0, 1.0 - lodFade);
          float major = g2;

          /* Soft horizon fade so the grid dissolves at the silhouette. */
          vec3 viewDir = normalize(cameraPosition - vWorld);
          float horizon = abs(viewDir.y);
          float fade = smoothstep(0.0, 0.2, horizon);

          float aMinor = minor * 0.55 * fade;
          float aMajor = major * 0.95 * fade;
          float a = max(aMinor, aMajor);
          if (a < 0.002) discard;

          vec3 color = mix(uMinorColor, uMajorColor, aMajor / max(a, 0.0001));
          gl_FragColor = vec4(color, a);
        }
      `,
      extensions: { derivatives: true } as never,
    });
    const grid = new Mesh(gridGeo, gridMat) as unknown as GridHelper;
    (grid as unknown as Mesh).frustumCulled = false;
    (grid as unknown as Mesh).renderOrder = -1;
    scene.add(grid);
    gridRef.current = grid;

    /* Groups */
    scene.add(modelGroupRef.current);
    scene.add(edgesGroupRef.current);
    scene.add(measureGroupRef.current);

    /* Enhancement group — parent for Tier 1-4 mounts. Children are added under
       tier-specific subgroups (lazy in `mountEnhancements`). */
    const enhancementGroup = new Group();
    enhancementGroup.name = "enhancementGroup";
    scene.add(enhancementGroup);
    enhancementGroupRef.current = enhancementGroup;

    /* Animation loop */
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      /* Smooth camera transitions (lerp) */
      if (cameraTargetPosRef.current) {
        camera.position.lerp(cameraTargetPosRef.current, 0.12);
        if (camera.position.distanceTo(cameraTargetPosRef.current) < 0.01) {
          camera.position.copy(cameraTargetPosRef.current);
          cameraTargetPosRef.current = null;
        }
      }
      if (controlsTargetRef.current) {
        controls.target.lerp(controlsTargetRef.current, 0.12);
        if (controls.target.distanceTo(controlsTargetRef.current) < 0.01) {
          controls.target.copy(controlsTargetRef.current);
          controlsTargetRef.current = null;
        }
      }

      controls.update();
      renderer.clear();
      renderer.render(scene, camera);

      /* Sync view cube orientation */
      if (onCameraChangeRef.current) {
        const q = camera.quaternion;
        const css = `rotateX(${-Math.asin(2 * (q.x * q.z - q.w * q.y)) * 180 / Math.PI}deg) rotateY(${-Math.atan2(2 * (q.x * q.w + q.y * q.z), 1 - 2 * (q.x * q.x + q.y * q.y)) * 180 / Math.PI}deg)`;
        onCameraChangeRef.current(css);
      }
    };
    animate();

    /* Resize */
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();

      /* Terminate worker (closes IFC model in worker thread) */
      if (workerRef.current) {
        workerRef.current.postMessage({ type: "close" });
        workerRef.current.terminate();
        workerRef.current = null;
      }
      modelIDRef.current = -1;

      controls.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ────────────────────────────────────────────────────────── */
  /* Event handlers (click, hover, dblclick, contextmenu)       */
  /* ────────────────────────────────────────────────────────── */

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const canvas = renderer.domElement;

    const raycaster = new Raycaster();
    const mouse = new Vector2();

    const raycast = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      const camera = cameraRef.current;
      if (!camera) return [];
      raycaster.setFromCamera(mouse, camera);
      const meshes = modelGroupRef.current.children.filter((c) => c.visible) as Mesh[];
      return raycaster.intersectObjects(meshes, false);
    };

    /* ── Click ── */
    const onClick = (e: MouseEvent) => {
      const intersects = raycast(e);
      if (intersects.length === 0) {
        if (measureModeRef.current) return;
        /* Multi-select: only clear if no modifier */
        if (!e.ctrlKey && !e.metaKey) {
          clearSelection();
          onSelect(null);
        }
        return;
      }

      const hit = intersects[0];
      const hitPoint = hit.point.clone();

      /* Measurement mode */
      if (measureModeRef.current) {
        if (!measurePointRef.current) {
          measurePointRef.current = hitPoint;
          addMeasurePoint(hitPoint);
        } else {
          const start = measurePointRef.current;
          const end = hitPoint;
          const dist = start.distanceTo(end);
          addMeasureLine(start, end, dist);
          measureCountRef.current++;
          onMeasurement({
            id: `m-${measureCountRef.current}`,
            startWorld: [start.x, start.y, start.z],
            endWorld: [end.x, end.y, end.z],
            distance: Math.round(dist * 1000) / 1000,
          });
          measurePointRef.current = null;
        }
        return;
      }

      /* Selection mode */
      const mesh = hit.object as Mesh;
      const expressID = mesh.userData.expressID as number | undefined;
      if (expressID !== undefined) {
        if (e.ctrlKey || e.metaKey) {
          /* Multi-select: toggle */
          if (selectedIDsRef.current.has(expressID)) {
            deselectElement(expressID);
          } else {
            addToSelection(expressID);
          }
        } else {
          selectElement(expressID);
        }
      }
    };

    /* ── Hover ── */
    let lastHoverTime = 0;
    const onMouseMove = (e: MouseEvent) => {
      const now = Date.now();
      if (now - lastHoverTime < 50) return;
      lastHoverTime = now;
      if (measureModeRef.current) return;

      const intersects = raycast(e);
      const hitID = intersects.length > 0
        ? (intersects[0].object as Mesh).userData.expressID as number | undefined
        : undefined;

      const prevHover = hoverIDRef.current;
      if (hitID === prevHover) return;

      /* Restore previous hover */
      if (prevHover !== null && !selectedIDsRef.current.has(prevHover) && prevHover !== selectedIDRef.current) {
        const meshes = meshMapRef.current.get(prevHover);
        if (meshes) {
          meshes.forEach((m) => {
            const orig = originalMaterialsRef.current.get(m.uuid);
            if (orig) m.material = orig as Material;
          });
        }
      }

      /* Apply hover highlight */
      if (hitID !== undefined && hitID !== selectedIDRef.current && !selectedIDsRef.current.has(hitID)) {
        const meshes = meshMapRef.current.get(hitID);
        if (meshes) {
          meshes.forEach((m) => {
            if (!originalMaterialsRef.current.has(m.uuid)) {
              originalMaterialsRef.current.set(m.uuid, m.material as Material);
            }
            m.material = hoverMatRef.current;
          });
        }
        hoverIDRef.current = hitID;
        canvas.style.cursor = "pointer";
      } else {
        hoverIDRef.current = null;
        canvas.style.cursor = measureModeRef.current ? "crosshair" : "default";
      }
    };

    /* ── Double-click: isolate + fit ── */
    const onDblClick = (e: MouseEvent) => {
      const intersects = raycast(e);
      if (intersects.length === 0) return;
      const mesh = intersects[0].object as Mesh;
      const expressID = mesh.userData.expressID as number | undefined;
      if (expressID === undefined) return;

      /* Isolate */
      modelGroupRef.current.traverse((obj) => {
        if (obj instanceof Mesh) {
          const eid = obj.userData.expressID as number;
          obj.visible = eid === expressID;
          if (eid !== expressID) hiddenRef.current.add(eid);
        }
      });

      /* Select + smooth fly to fit */
      selectElement(expressID);
      const meshes = meshMapRef.current.get(expressID);
      if (meshes && meshes.length > 0) {
        const bbox = new Box3();
        meshes.forEach((m) => bbox.expandByObject(m));
        const center = bbox.getCenter(new Vector3());
        const size = bbox.getSize(new Vector3());
        const dist = Math.max(size.x, size.y, size.z, 2) * 2.5;
        cameraTargetPosRef.current = new Vector3(
          center.x + dist * 0.4, center.y + dist * 0.4, center.z + dist * 0.4
        );
        controlsTargetRef.current = center.clone();
      }
    };

    /* ── Context menu ── */
    const onCtxMenu = (e: MouseEvent) => {
      e.preventDefault();
      const intersects = raycast(e);
      if (intersects.length === 0) {
        onContextMenu?.(null);
        return;
      }
      const mesh = intersects[0].object as Mesh;
      const expressID = mesh.userData.expressID as number | undefined;
      if (expressID === undefined) { onContextMenu?.(null); return; }

      selectElement(expressID);
      const typeId = expressIDToTypeRef.current.get(expressID);
      const ifcName = typeId ? TYPE_ID_TO_NAME[typeId] ?? "Element" : "Element";
      const displayName = IFC_TYPE_NAMES[ifcName] ?? ifcName;
      onContextMenu?.({ x: e.clientX, y: e.clientY, expressID, typeName: displayName });
    };

    canvas.addEventListener("click", onClick);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("dblclick", onDblClick);
    canvas.addEventListener("contextmenu", onCtxMenu);
    return () => {
      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onCtxMenu);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSelect, onMeasurement, onContextMenu]);

  /* ────────────────────────────────────────────────────────── */
  /* Selection helpers                                         */
  /* ────────────────────────────────────────────────────────── */

  const clearSelection = useCallback(() => {
    /* Clear single selection */
    const prevID = selectedIDRef.current;
    if (prevID !== null) {
      const meshes = meshMapRef.current.get(prevID);
      if (meshes) {
        meshes.forEach((m) => {
          const orig = originalMaterialsRef.current.get(m.uuid);
          if (orig) m.material = orig as Material;
        });
      }
    }
    selectedIDRef.current = null;

    /* Clear multi-selection */
    for (const eid of selectedIDsRef.current) {
      const meshes = meshMapRef.current.get(eid);
      if (meshes) {
        meshes.forEach((m) => {
          const orig = originalMaterialsRef.current.get(m.uuid);
          if (orig) m.material = orig as Material;
        });
      }
    }
    selectedIDsRef.current.clear();
  }, []);

  /* ────────────────────────────────────────────────────────── */
  /* Property extraction (via worker)                           */
  /* ────────────────────────────────────────────────────────── */

  const getElementProperties = useCallback((expressID: number): void => {
    const worker = workerRef.current;
    if (!worker) { onSelect(null); return; }

    const reqId = ++requestIdRef.current;
    propertyCallbacksRef.current.set(reqId, (data) => {
      onSelect(data);
    });
    worker.postMessage({ type: "getProperties", expressID, requestId: reqId });
  }, [onSelect]);

  const selectElement = useCallback(
    (expressID: number) => {
      clearSelection();
      selectedIDRef.current = expressID;
      const meshes = meshMapRef.current.get(expressID);
      if (meshes) {
        meshes.forEach((m) => {
          if (!originalMaterialsRef.current.has(m.uuid)) {
            originalMaterialsRef.current.set(m.uuid, m.material as Material);
          }
          m.material = highlightMatRef.current;
        });
      }
      /* Extract properties via worker (async) */
      getElementProperties(expressID);
    },
    [clearSelection, getElementProperties]
  );

  const deselectElement = useCallback((expressID: number) => {
    selectedIDsRef.current.delete(expressID);
    const meshes = meshMapRef.current.get(expressID);
    if (meshes) {
      meshes.forEach((m) => {
        const orig = originalMaterialsRef.current.get(m.uuid);
        if (orig) m.material = orig as Material;
      });
    }
    if (selectedIDsRef.current.size === 0 && selectedIDRef.current === null) {
      onSelect(null);
    }
  }, [onSelect]);

  const addToSelection = useCallback((expressID: number) => {
    selectedIDsRef.current.add(expressID);
    const meshes = meshMapRef.current.get(expressID);
    if (meshes) {
      meshes.forEach((m) => {
        if (!originalMaterialsRef.current.has(m.uuid)) {
          originalMaterialsRef.current.set(m.uuid, m.material as Material);
        }
        m.material = highlightMatRef.current;
      });
    }
    /* Property extraction deferred to selectElement for primary selection;
       for multi-select additive clicks we just highlight visually */
  }, []);

  /* ────────────────────────────────────────────────────────── */
  /* Measurement helpers                                        */
  /* ────────────────────────────────────────────────────────── */

  const addMeasurePoint = useCallback((point: Vector3) => {
    const sphere = new Mesh(
      new SphereGeometry(0.05, 16, 16),
      new MeshBasicMaterial({ color: 0xff4444 })
    );
    sphere.position.copy(point);
    measureGroupRef.current.add(sphere);
  }, []);

  const addMeasureLine = useCallback((start: Vector3, end: Vector3, dist: number) => {
    /* Line */
    const geom = new BufferGeometry().setFromPoints([start, end]);
    const line = new Line(
      geom,
      new LineBasicMaterial({ color: 0xff4444, linewidth: 2, depthTest: false })
    );
    line.renderOrder = 999;
    measureGroupRef.current.add(line);

    /* End sphere */
    const sphere = new Mesh(
      new SphereGeometry(0.05, 16, 16),
      new MeshBasicMaterial({ color: 0xff4444 })
    );
    sphere.position.copy(end);
    measureGroupRef.current.add(sphere);

    /* Label sprite */
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "rgba(20,20,35,0.85)";
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.fill();
    ctx.strokeStyle = "#ff4444";
    ctx.lineWidth = 2;
    ctx.roundRect(0, 0, 256, 64, 8);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 24px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const unit = measureUnitRef.current;
    let label: string;
    if (unit === "ft") {
      const totalInches = dist * 39.3701;
      const feet = Math.floor(totalInches / 12);
      const inches = (totalInches % 12).toFixed(1);
      label = `${feet}'-${inches}"`;
    } else {
      label = `${dist.toFixed(3)} m`;
    }
    ctx.fillText(label, 128, 32);

    const texture = new CanvasTexture(canvas);
    const spriteMat = new SpriteMaterial({ map: texture, depthTest: false });
    const sprite = new Sprite(spriteMat);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += 0.3;
    sprite.position.copy(mid);
    sprite.scale.set(1.5, 0.375, 1);
    sprite.renderOrder = 1000;
    measureGroupRef.current.add(sprite);
  }, []);

  /* ────────────────────────────────────────────────────────── */
  /* Create Three.js mesh from worker geometry data             */
  /* ────────────────────────────────────────────────────────── */

  /* ── IFC type-based material presets ── */
  const getMaterialPreset = useCallback((typeId: number | undefined, fallbackColor: Color, fallbackAlpha: number): MeshStandardMaterial => {
    const typeName = typeId ? TYPE_ID_TO_NAME[typeId] : undefined;

    switch (typeName) {
      case "IFCWALL":
      case "IFCWALLSTANDARDCASE":
        return new MeshStandardMaterial({
          color: new Color(0xd4cfc8), roughness: 0.85, metalness: 0.0,
          envMapIntensity: 0.3, side: DoubleSide,
        });
      case "IFCWINDOW":
      case "IFCCURTAINWALL":
        return new MeshStandardMaterial({
          color: new Color(0xb8d8e8), roughness: 0.1, metalness: 0.1,
          envMapIntensity: 1.0, opacity: 0.45, transparent: true, side: DoubleSide,
        });
      case "IFCDOOR":
        return new MeshStandardMaterial({
          color: new Color(0x8b6f4e), roughness: 0.75, metalness: 0.0,
          envMapIntensity: 0.3, side: DoubleSide,
        });
      case "IFCSLAB":
        return new MeshStandardMaterial({
          color: new Color(0xb0aba4), roughness: 0.9, metalness: 0.0,
          envMapIntensity: 0.2, side: DoubleSide,
        });
      case "IFCCOLUMN":
      case "IFCBEAM":
      case "IFCMEMBER":
        return new MeshStandardMaterial({
          color: new Color(0xc8c0b8), roughness: 0.6, metalness: 0.25,
          envMapIntensity: 0.5, side: DoubleSide,
        });
      case "IFCPLATE":
        return new MeshStandardMaterial({
          color: new Color(0xa8a8b0), roughness: 0.35, metalness: 0.6,
          envMapIntensity: 0.7, side: DoubleSide,
        });
      case "IFCROOF":
        return new MeshStandardMaterial({
          color: new Color(0x8b5e3c), roughness: 0.8, metalness: 0.0,
          envMapIntensity: 0.3, side: DoubleSide,
        });
      case "IFCSTAIR":
      case "IFCSTAIRFLIGHT":
        return new MeshStandardMaterial({
          color: new Color(0xc0b8b0), roughness: 0.8, metalness: 0.05,
          envMapIntensity: 0.3, side: DoubleSide,
        });
      case "IFCRAILING":
        return new MeshStandardMaterial({
          color: new Color(0x888890), roughness: 0.4, metalness: 0.5,
          envMapIntensity: 0.6, side: DoubleSide,
        });
      case "IFCFOOTING":
        return new MeshStandardMaterial({
          color: new Color(0x9a9590), roughness: 0.95, metalness: 0.0,
          envMapIntensity: 0.2, side: DoubleSide,
        });
      case "IFCFURNISHINGELEMENT":
        return new MeshStandardMaterial({
          color: new Color(0xc4b896), roughness: 0.7, metalness: 0.0,
          envMapIntensity: 0.4, side: DoubleSide,
        });
      case "IFCFLOWSEGMENT":
      case "IFCFLOWTERMINAL":
      case "IFCFLOWFITTING":
        return new MeshStandardMaterial({
          color: new Color(0x7090a8), roughness: 0.4, metalness: 0.4,
          envMapIntensity: 0.5, side: DoubleSide,
        });
      case "IFCSPACE":
        return new MeshStandardMaterial({
          color: new Color(0xe0d8c8), roughness: 0.9, metalness: 0.0,
          envMapIntensity: 0.2, opacity: 0.15, transparent: true, side: DoubleSide,
          depthWrite: false,
        });
      case "IFCCOVERING":
        return new MeshStandardMaterial({
          color: new Color(0xd8d0c0), roughness: 0.8, metalness: 0.0,
          envMapIntensity: 0.3, side: DoubleSide,
        });
      default:
        return new MeshStandardMaterial({
          color: fallbackColor, roughness: 0.7, metalness: 0.1,
          envMapIntensity: 0.5, opacity: fallbackAlpha,
          transparent: fallbackAlpha < 0.99, side: DoubleSide,
        });
    }
  }, []);

  const createMeshFromTransfer = useCallback(
    (geo: { expressID: number; positions: Float32Array; normals: Float32Array; indices: Uint32Array; color: [number, number, number, number]; transform: number[] }) => {
      const bufferGeometry = new BufferGeometry();
      bufferGeometry.setAttribute("position", new BufferAttribute(geo.positions, 3));
      bufferGeometry.setAttribute("normal", new BufferAttribute(geo.normals, 3));
      bufferGeometry.setIndex(new BufferAttribute(geo.indices, 1));

      const matrix = new Matrix4().fromArray(geo.transform);
      bufferGeometry.applyMatrix4(matrix);

      const [r, g, b, a] = geo.color;
      const typeId = expressIDToTypeRef.current.get(geo.expressID);
      const material = getMaterialPreset(typeId, new Color(r, g, b), a);

      const mesh = new Mesh(bufferGeometry, material);
      mesh.userData.expressID = geo.expressID;
      mesh.userData.ifcType = typeId;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      modelGroupRef.current.add(mesh);
      originalMaterialsRef.current.set(mesh.uuid, material);

      const existing = meshMapRef.current.get(geo.expressID);
      if (existing) existing.push(mesh);
      else meshMapRef.current.set(geo.expressID, [mesh]);
    },
    [getMaterialPreset]
  );

  /* ────────────────────────────────────────────────────────── */
  /* Model clear                                                */
  /* ────────────────────────────────────────────────────────── */

  const clearModel = useCallback(() => {
    /* Dispose model geometries + materials */
    modelGroupRef.current.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    modelGroupRef.current.clear();

    /* Dispose edges */
    edgesGroupRef.current.traverse((obj) => {
      if (obj instanceof LineSegments) {
        obj.geometry.dispose();
        (obj.material as Material).dispose();
      }
    });
    edgesGroupRef.current.clear();

    /* Dispose measurement objects (sprites have canvas textures) */
    measureGroupRef.current.traverse((obj) => {
      if (obj instanceof Mesh) {
        obj.geometry.dispose();
        (obj.material as Material).dispose();
      } else if (obj instanceof Line) {
        obj.geometry.dispose();
        (obj.material as Material).dispose();
      } else if (obj instanceof Sprite) {
        (obj.material as SpriteMaterial).map?.dispose();
        obj.material.dispose();
      }
    });
    measureGroupRef.current.clear();

    /* Dispose section plane helpers */
    for (const [, helper] of planeHelpersRef.current) {
      sceneRef.current?.remove(helper);
      helper.dispose();
    }
    planeHelpersRef.current.clear();
    clippingPlanesRef.current.clear();
    if (rendererRef.current) {
      rendererRef.current.clippingPlanes = [];
    }

    /* Clear all maps and refs */
    meshMapRef.current.clear();
    expressIDToTypeRef.current.clear();
    expressIDToStoreyRef.current.clear();
    storeyIndexRef.current.clear();
    originalMaterialsRef.current.clear();
    hiddenRef.current.clear();
    wallPsetsRef.current.clear();

    /* Dispose any mounted enhancement children so a fresh load starts clean. */
    const enhancementGroup = enhancementGroupRef.current;
    if (enhancementGroup) {
      for (const tierGroup of enhancementTierGroupsRef.current.values()) {
        tierGroup.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.geometry.dispose();
            if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
            else (obj.material as Material).dispose();
          }
        });
        enhancementGroup.remove(tierGroup);
      }
      enhancementTierGroupsRef.current.clear();
    }
    selectedIDRef.current = null;
    selectedIDsRef.current.clear();
    hoverIDRef.current = null;
    measurePointRef.current = null;
    measureModeRef.current = false;
    propertyCallbacksRef.current.clear();

    /* Hide ground plane */
    if (groundRef.current) groundRef.current.visible = false;
  }, []);

  /* ────────────────────────────────────────────────────────── */
  /* IFC Loading (via Web Worker)                               */
  /* ────────────────────────────────────────────────────────── */

  const loadFile = useCallback(
    async (buffer: ArrayBuffer, filename: string) => {
      clearModel();

      /* Terminate previous worker */
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }

      return new Promise<void>((resolve, reject) => {
        let worker: Worker;
        try {
          worker = new Worker(new URL("./ifc-worker.ts", import.meta.url));
          workerRef.current = worker;
        } catch {
          /* Worker creation failed — this can happen in some environments */
          onError("Failed to create background parser. Please try refreshing the page.");
          reject(new Error("Worker creation failed"));
          return;
        }

        /* Queued geometry batches for main-thread mesh creation */
        const batchQueue: Array<{ expressID: number; positions: Float32Array; normals: Float32Array; indices: Uint32Array; color: [number, number, number, number]; transform: number[] }[]> = [];
        let processing = false;

        const processBatches = () => {
          if (processing || batchQueue.length === 0) return;
          processing = true;
          const batch = batchQueue.shift()!;
          /* Create meshes in a chunk, then yield to UI */
          for (const geo of batch) {
            createMeshFromTransfer(geo);
          }
          processing = false;
          if (batchQueue.length > 0) {
            setTimeout(processBatches, 0);
          }
        };

        worker.onmessage = (e) => {
          const msg = e.data;

          switch (msg.type) {
            case "progress":
              onProgress(msg.progress, msg.message);
              break;

            case "meshBatch":
              batchQueue.push(msg.batch);
              processBatches();
              break;

            case "metadata":
              for (const [eid, tid] of msg.typeEntries) {
                expressIDToTypeRef.current.set(eid, tid);
              }
              for (const [eid, sid] of msg.storeyEntries) {
                expressIDToStoreyRef.current.set(eid, sid);
              }
              for (const [sid, idx] of msg.storeyIndexEntries) {
                storeyIndexRef.current.set(sid, idx);
              }
              /* wallPsetEntries is only emitted by the Phase-1 worker; absent
                 when the worker chunk is being served from a stale cache. */
              if (Array.isArray(msg.wallPsetEntries)) {
                for (const [eid, entry] of msg.wallPsetEntries) {
                  wallPsetsRef.current.set(eid, entry);
                }
              }
              break;

            case "spatialTree":
              onSpatialTree(msg.tree);
              break;

            case "modelInfo":
              modelIDRef.current = msg.info.modelID;
              onModelInfo(msg.info);
              break;

            case "complete": {
              /* Process any remaining batches, then fit camera */
              const finalize = () => {
                if (batchQueue.length > 0 || processing) {
                  setTimeout(finalize, 16);
                  return;
                }
                /* Smart camera fit — exclude site/road geometry, fit to building only */
                const buildingBBox = new Box3();
                let hasBuildingElements = false;
                modelGroupRef.current.traverse((obj) => {
                  if (!(obj instanceof Mesh)) return;
                  const eid = obj.userData.expressID as number;
                  const typeId = expressIDToTypeRef.current.get(eid);
                  const typeName = typeId ? TYPE_ID_TO_NAME[typeId] : undefined;
                  /* Skip site, project, and opening geometry */
                  if (typeName === "IFCSITE" || typeName === "IFCPROJECT") return;
                  buildingBBox.expandByObject(obj);
                  hasBuildingElements = true;
                });
                /* Fallback to full model bbox if no building elements classified */
                const bbox = hasBuildingElements ? buildingBBox : new Box3().setFromObject(modelGroupRef.current);
                if (!bbox.isEmpty()) {
                  const center = bbox.getCenter(new Vector3());
                  const size = bbox.getSize(new Vector3());
                  const maxDim = Math.max(size.x, size.y, size.z);
                  const dist = maxDim * 0.9;
                  const camera = cameraRef.current!;
                  camera.position.set(center.x + dist * 0.55, center.y + dist * 0.45, center.z + dist * 0.55);
                  camera.lookAt(center);
                  controlsRef.current!.target.copy(center);
                  controlsRef.current!.update();

                  /* Position ground plane + grid at model base */
                  const ground = groundRef.current;
                  if (ground) {
                    ground.position.y = bbox.min.y - 0.01;
                    ground.visible = true;
                  }
                  if (gridRef.current) {
                    gridRef.current.position.y = bbox.min.y - 0.005;
                  }

                  /* Update shadow camera to fit model */
                  const kl = keyLightRef.current;
                  if (kl) {
                    const shadowSize = Math.max(maxDim * 1.2, 10);
                    kl.shadow.camera.left = -shadowSize;
                    kl.shadow.camera.right = shadowSize;
                    kl.shadow.camera.top = shadowSize;
                    kl.shadow.camera.bottom = -shadowSize;
                    kl.shadow.camera.far = shadowSize * 5;
                    kl.shadow.camera.updateProjectionMatrix();
                    /* Position key light relative to model center */
                    kl.position.set(center.x + maxDim, center.y + maxDim * 1.5, center.z + maxDim);
                    kl.target.position.copy(center);
                    kl.target.updateMatrixWorld();
                  }
                }
                /* V6: capture the model group's original position so a
                   later panorama-reset can restore it after the
                   controller translated it in front of the dome+disc. */
                originalModelPositionRef.current.copy(modelGroupRef.current.position);
                onLoadComplete();
                resolve();
              };
              finalize();
              break;
            }

            case "properties": {
              const cb = propertyCallbacksRef.current.get(msg.requestId);
              if (cb) {
                cb(msg.data);
                propertyCallbacksRef.current.delete(msg.requestId);
              }
              break;
            }

            case "error":
              onError(msg.message);
              reject(new Error(msg.message));
              break;
          }
        };

        worker.onerror = (err) => {
          onError(`Worker error: ${err.message}`);
          reject(err);
        };

        /* Send buffer to worker (transferred, zero-copy) */
        worker.postMessage({ type: "parse", buffer, filename }, [buffer]);
      });
    },
    [onProgress, onError, onModelInfo, onSpatialTree, onLoadComplete, clearModel, createMeshFromTransfer]
  );

  /* ────────────────────────────────────────────────────────── */
  /* View mode helpers                                          */
  /* ────────────────────────────────────────────────────────── */

  const applyViewMode = useCallback((mode: ViewModeType) => {
    viewModeRef.current = mode;
    modelGroupRef.current.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const eid = obj.userData.expressID as number;
      if (selectedIDRef.current === eid || selectedIDsRef.current.has(eid)) return;
      const orig = originalMaterialsRef.current.get(obj.uuid) as MeshStandardMaterial | undefined;
      if (!orig) return;

      switch (mode) {
        case "shaded":
          obj.material = orig;
          break;
        case "wireframe": {
          const wf = orig.clone();
          wf.wireframe = true;
          wf.opacity = 1;
          wf.transparent = false;
          obj.material = wf;
          break;
        }
        case "xray": {
          const xr = orig.clone();
          xr.opacity = 0.15;
          xr.transparent = true;
          xr.depthWrite = false;
          obj.material = xr;
          break;
        }
      }
    });
  }, []);

  const applyColorBy = useCallback((colorBy: ColorByType) => {
    colorByRef.current = colorBy;
    if (colorBy === "default") {
      applyViewMode(viewModeRef.current);
      return;
    }

    modelGroupRef.current.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const eid = obj.userData.expressID as number;
      if (selectedIDRef.current === eid || selectedIDsRef.current.has(eid)) return;
      const expressID = obj.userData.expressID as number;

      let color = "#888888";
      if (colorBy === "category") {
        const typeId = expressIDToTypeRef.current.get(expressID);
        const typeName = typeId ? TYPE_ID_TO_NAME[typeId] : undefined;
        if (typeName && typeName in CATEGORY_COLORS) color = CATEGORY_COLORS[typeName];
      } else if (colorBy === "storey") {
        const storeyID = expressIDToStoreyRef.current.get(expressID);
        if (storeyID !== undefined) {
          const idx = storeyIndexRef.current.get(storeyID) ?? 0;
          color = STOREY_COLORS[idx % STOREY_COLORS.length];
        }
      }

      const mat = new MeshStandardMaterial({
        color: new Color(color),
        roughness: 0.7,
        metalness: 0.1,
        side: DoubleSide,
      });
      obj.material = mat;
    });
  }, [applyViewMode]);

  /* ────────────────────────────────────────────────────────── */
  /* Section plane helpers                                      */
  /* ────────────────────────────────────────────────────────── */

  const toggleSectionPlane = useCallback((axis: SectionAxis) => {
    if (clippingPlanesRef.current.has(axis)) {
      /* Remove */
      const plane = clippingPlanesRef.current.get(axis)!;
      const helper = planeHelpersRef.current.get(axis);
      if (helper) {
        sceneRef.current?.remove(helper);
        helper.dispose();
        planeHelpersRef.current.delete(axis);
      }
      clippingPlanesRef.current.delete(axis);

      /* Update renderer clipping */
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.clippingPlanes = [...clippingPlanesRef.current.values()];
      }
    } else {
      /* Add */
      const bbox = new Box3().setFromObject(modelGroupRef.current);
      const center = bbox.getCenter(new Vector3());
      const normal = new Vector3(
        axis === "x" ? -1 : 0,
        axis === "y" ? -1 : 0,
        axis === "z" ? -1 : 0
      );
      const plane = new Plane(normal, axis === "x" ? center.x : axis === "y" ? center.y : center.z);
      clippingPlanesRef.current.set(axis, plane);

      const size = bbox.getSize(new Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const helper = new PlaneHelper(plane, maxDim * 1.5, 0x4f8aff);
      helper.renderOrder = 998;
      sceneRef.current?.add(helper);
      planeHelpersRef.current.set(axis, helper);

      /* Update renderer clipping */
      const renderer = rendererRef.current;
      if (renderer) {
        renderer.clippingPlanes = [...clippingPlanesRef.current.values()];
      }
    }
  }, []);

  /* ────────────────────────────────────────────────────────── */
  /* Imperative handle                                          */
  /* ────────────────────────────────────────────────────────── */

  useImperativeHandle(
    ref,
    () => ({
      loadFile,
      fitToView: () => {
        /* Smart fit — exclude site geometry */
        const buildingBBox = new Box3();
        let hasBE = false;
        modelGroupRef.current.traverse((obj) => {
          if (!(obj instanceof Mesh)) return;
          const eid = obj.userData.expressID as number;
          const typeId = expressIDToTypeRef.current.get(eid);
          const tn = typeId ? TYPE_ID_TO_NAME[typeId] : undefined;
          if (tn === "IFCSITE" || tn === "IFCPROJECT") return;
          buildingBBox.expandByObject(obj);
          hasBE = true;
        });
        const bbox = hasBE ? buildingBBox : new Box3().setFromObject(modelGroupRef.current);
        if (bbox.isEmpty()) return;
        const center = bbox.getCenter(new Vector3());
        const size = bbox.getSize(new Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const dist = maxDim * 0.9;
        cameraTargetPosRef.current = new Vector3(center.x + dist * 0.55, center.y + dist * 0.45, center.z + dist * 0.55);
        controlsTargetRef.current = center.clone();
      },
      fitToSelection: () => {
        const id = selectedIDRef.current;
        if (id === null) return;
        const meshes = meshMapRef.current.get(id);
        if (!meshes || meshes.length === 0) return;
        const bbox = new Box3();
        meshes.forEach((m) => bbox.expandByObject(m));
        const center = bbox.getCenter(new Vector3());
        const size = bbox.getSize(new Vector3());
        const dist = Math.max(size.x, size.y, size.z, 2) * 2;
        cameraTargetPosRef.current = new Vector3(center.x + dist * 0.4, center.y + dist * 0.4, center.z + dist * 0.4);
        controlsTargetRef.current = center.clone();
      },
      setViewMode: applyViewMode,
      setColorBy: applyColorBy,
      toggleEdges: () => {
        showEdgesRef.current = !showEdgesRef.current;
        if (showEdgesRef.current) {
          modelGroupRef.current.traverse((obj) => {
            if (!(obj instanceof Mesh)) return;
            const edges = new EdgesGeometry(obj.geometry, 30);
            const line = new LineSegments(
              edges,
              new LineBasicMaterial({ color: 0x333344, transparent: true, opacity: 0.4 })
            );
            line.position.copy(obj.position);
            line.rotation.copy(obj.rotation);
            line.scale.copy(obj.scale);
            edgesGroupRef.current.add(line);
          });
        } else {
          edgesGroupRef.current.traverse((obj) => {
            if (obj instanceof LineSegments) {
              obj.geometry.dispose();
              (obj.material as Material).dispose();
            }
          });
          edgesGroupRef.current.clear();
        }
      },
      toggleSectionPlane,
      startMeasurement: () => {
        measureModeRef.current = true;
        measurePointRef.current = null;
        if (containerRef.current) containerRef.current.style.cursor = "crosshair";
      },
      cancelMeasurement: () => {
        measureModeRef.current = false;
        measurePointRef.current = null;
        if (containerRef.current) containerRef.current.style.cursor = "default";
      },
      clearMeasurements: () => {
        measureGroupRef.current.traverse((obj) => {
          if (obj instanceof Mesh) {
            obj.geometry.dispose();
            (obj.material as Material).dispose();
          } else if (obj instanceof Line) {
            obj.geometry.dispose();
            (obj.material as Material).dispose();
          } else if (obj instanceof Sprite) {
            (obj.material as SpriteMaterial).map?.dispose();
            obj.material.dispose();
          }
        });
        measureGroupRef.current.clear();
        measureModeRef.current = false;
        measurePointRef.current = null;
        if (containerRef.current) containerRef.current.style.cursor = "default";
      },
      takeScreenshot: () => {
        const renderer = rendererRef.current;
        if (!renderer) return;
        renderer.clear();
        if (bgSceneRef.current && bgCameraRef.current) {
          renderer.render(bgSceneRef.current, bgCameraRef.current);
        }
        renderer.render(sceneRef.current!, cameraRef.current!);
        const dataURL = renderer.domElement.toDataURL("image/png");
        const a = document.createElement("a");
        a.href = dataURL;
        a.download = `ifc-viewer-${Date.now()}.png`;
        a.click();
      },
      setProjection: (type: ProjectionType) => {
        projRef.current = type;
        /* For simplicity, we keep PerspectiveCamera but adjust FOV */
        const camera = cameraRef.current;
        if (!camera) return;
        if (type === "orthographic") {
          camera.fov = 1;
          camera.zoom = 0.05;
        } else {
          camera.fov = SCENE.cameraFov;
          camera.zoom = 1;
        }
        camera.updateProjectionMatrix();
      },
      setPresetView: (view: PresetView) => {
        const bbox = new Box3().setFromObject(modelGroupRef.current);
        if (bbox.isEmpty()) return;
        const center = bbox.getCenter(new Vector3());
        const size = bbox.getSize(new Vector3());
        const dist = Math.max(size.x, size.y, size.z) * 1.5;

        const positions: Record<PresetView, [number, number, number]> = {
          front: [center.x, center.y, center.z + dist],
          back: [center.x, center.y, center.z - dist],
          left: [center.x - dist, center.y, center.z],
          right: [center.x + dist, center.y, center.z],
          top: [center.x, center.y + dist, center.z + 0.01],
          bottom: [center.x, center.y - dist, center.z + 0.01],
          iso: [center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist * 0.5],
        };

        const pos = positions[view];
        cameraTargetPosRef.current = new Vector3(pos[0], pos[1], pos[2]);
        controlsTargetRef.current = center.clone();
      },
      toggleGrid: () => {
        showGridRef.current = !showGridRef.current;
        if (gridRef.current) gridRef.current.visible = showGridRef.current;
      },
      hideSelected: () => {
        /* Collect all selected IDs (single + multi) */
        const ids = new Set<number>();
        if (selectedIDRef.current !== null) ids.add(selectedIDRef.current);
        for (const eid of selectedIDsRef.current) ids.add(eid);
        if (ids.size === 0) return;
        for (const id of ids) {
          const meshes = meshMapRef.current.get(id);
          if (meshes) meshes.forEach((m) => (m.visible = false));
          hiddenRef.current.add(id);
        }
        clearSelection();
        onSelect(null);
      },
      isolateSelected: () => {
        /* Collect all selected IDs (single + multi) */
        const ids = new Set<number>();
        if (selectedIDRef.current !== null) ids.add(selectedIDRef.current);
        for (const eid of selectedIDsRef.current) ids.add(eid);
        if (ids.size === 0) return;
        modelGroupRef.current.traverse((obj) => {
          if (obj instanceof Mesh) {
            const eid = obj.userData.expressID as number;
            obj.visible = ids.has(eid);
            if (!ids.has(eid)) hiddenRef.current.add(eid);
          }
        });
      },
      showAll: () => {
        modelGroupRef.current.traverse((obj) => {
          if (obj instanceof Mesh) obj.visible = true;
        });
        hiddenRef.current.clear();
      },
      selectByExpressID: (id: number) => {
        selectElement(id);
        /* Smooth fly to selection */
        const meshes = meshMapRef.current.get(id);
        if (meshes && meshes.length > 0) {
          const bbox = new Box3();
          meshes.forEach((m) => bbox.expandByObject(m));
          const center = bbox.getCenter(new Vector3());
          const size = bbox.getSize(new Vector3());
          const dist = Math.max(size.x, size.y, size.z, 2) * 2.5;
          cameraTargetPosRef.current = new Vector3(center.x + dist * 0.4, center.y + dist * 0.4, center.z + dist * 0.4);
          controlsTargetRef.current = center.clone();
        }
      },
      selectByType: (referenceExpressID: number) => {
        const refType = expressIDToTypeRef.current.get(referenceExpressID);
        if (refType === undefined) return;
        clearSelection();
        selectedIDsRef.current.clear();
        for (const [eid, typeId] of expressIDToTypeRef.current) {
          if (typeId === refType) {
            selectedIDsRef.current.add(eid);
            const meshes = meshMapRef.current.get(eid);
            if (meshes) {
              meshes.forEach((m) => {
                if (!originalMaterialsRef.current.has(m.uuid)) {
                  originalMaterialsRef.current.set(m.uuid, m.material as Material);
                }
                m.material = highlightMatRef.current;
              });
            }
          }
        }
      },
      getCSVData: () => {
        const rows: string[] = ["Type,ExpressID"];
        for (const [expressID] of meshMapRef.current) {
          const typeId = expressIDToTypeRef.current.get(expressID);
          rows.push(`"${getTypeName(typeId ?? 0)}",${expressID}`);
        }
        return rows.join("\n");
      },
      unloadModel: () => {
        clearModel();
        /* Close worker */
        if (workerRef.current) {
          workerRef.current.postMessage({ type: "close" });
          workerRef.current.terminate();
          workerRef.current = null;
        }
        modelIDRef.current = -1;
      },
      setMeasureUnit: (unit: "m" | "ft") => {
        measureUnitRef.current = unit;
      },
      onCameraChange: (cb: ((css: string) => void) | null) => {
        onCameraChangeRef.current = cb;
      },

      /* ── Enhance feature surface (Phase 1 scaffold) ──────────────────── */

      getSceneRefs: (): SceneRefs | null => {
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const renderer = rendererRef.current;
        const modelGroup = modelGroupRef.current;
        if (!scene || !camera || !renderer || !modelGroup) return null;
        return { scene, camera, renderer, modelGroup };
      },

      getMeshMap: (): ReadonlyMap<number, Mesh[]> => meshMapRef.current,

      getTypeMap: (): ReadonlyMap<number, number> => expressIDToTypeRef.current,

      getSpaceBounds: (): Map<number, Box3> => {
        const bounds = new Map<number, Box3>();
        const meshMap = meshMapRef.current;
        const typeMap = expressIDToTypeRef.current;
        for (const [expressID, meshes] of meshMap.entries()) {
          if (typeMap.get(expressID) !== IFCSPACE) continue;
          const box = new Box3();
          for (const m of meshes) box.expandByObject(m);
          if (!box.isEmpty()) bounds.set(expressID, box);
        }
        return bounds;
      },

      mountEnhancements: (nodes: Object3D[], opts: { tier: EnhancementTier }) => {
        const enhancementGroup = enhancementGroupRef.current;
        if (!enhancementGroup) return;
        let tierGroup = enhancementTierGroupsRef.current.get(opts.tier);
        if (!tierGroup) {
          tierGroup = new Group();
          tierGroup.name = `enhancement-tier-${opts.tier}`;
          enhancementGroup.add(tierGroup);
          enhancementTierGroupsRef.current.set(opts.tier, tierGroup);
        }
        for (const node of nodes) tierGroup.add(node);
      },

      unmountEnhancements: (tier?: EnhancementTier) => {
        const enhancementGroup = enhancementGroupRef.current;
        if (!enhancementGroup) return;
        const disposeTree = (root: Object3D) => {
          root.traverse((obj) => {
            if (obj instanceof Mesh) {
              obj.geometry.dispose();
              if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
              else (obj.material as Material).dispose();
            }
          });
        };

        if (tier === undefined) {
          for (const tg of enhancementTierGroupsRef.current.values()) {
            disposeTree(tg);
            enhancementGroup.remove(tg);
          }
          enhancementTierGroupsRef.current.clear();
          return;
        }

        const tierGroup = enhancementTierGroupsRef.current.get(tier);
        if (!tierGroup) return;
        disposeTree(tierGroup);
        enhancementGroup.remove(tierGroup);
        enhancementTierGroupsRef.current.delete(tier);
      },

      getPropertySets: (expressID: number): Promise<PropertySet[]> => {
        return new Promise((resolve) => {
          const worker = workerRef.current;
          if (!worker) { resolve([]); return; }
          const reqId = ++requestIdRef.current;
          propertyCallbacksRef.current.set(reqId, (data) => {
            resolve(data?.propertySets ?? []);
          });
          worker.postMessage({ type: "getProperties", expressID, requestId: reqId });
        });
      },

      getWallPsets: (): ReadonlyMap<number, { isExternal: boolean | null; fireRating: string | null }> => wallPsetsRef.current,

      syncMeshBaseline: (mesh: Mesh, material: Material | Material[]) => {
        /* Baseline = the material hover/select systems will restore to after
           their transient overlays. Enhance (and future tier renderers) call
           this whenever they persist a material swap outside the transient
           flow. Without it, hover-out and select-release snap back to the
           pre-Enhance gray captured at mesh creation. */
        originalMaterialsRef.current.set(mesh.uuid, material);
      },

      /* ── Panorama coordination ───────────────────────────────────────── */

      setBlueprintGridVisible: (visible: boolean) => {
        if (gridRef.current) gridRef.current.visible = visible;
        showGridRef.current = visible;
      },

      isBlueprintGridVisible: (): boolean => {
        return gridRef.current?.visible ?? showGridRef.current;
      },

      setPanoramaActive: (active: boolean) => {
        panoramaActiveRef.current = active;
      },

      isPanoramaActive: (): boolean => panoramaActiveRef.current,

      getModelBoundingBox: (): Box3 | null => {
        const group = modelGroupRef.current;
        if (!group || group.children.length === 0) return null;
        const bbox = new Box3().setFromObject(group);
        return bbox.isEmpty() ? null : bbox;
      },

      getSlabMeshes: (): Array<{ mesh: Object3D; predefinedType: string | null }> => {
        const typeMap = expressIDToTypeRef.current;
        const meshMap = meshMapRef.current;
        if (typeMap.size === 0 || meshMap.size === 0) return [];
        const out: Array<{ mesh: Object3D; predefinedType: string | null }> = [];
        for (const [expressID, typeId] of typeMap.entries()) {
          if (typeId !== IFCSLAB) continue;
          const meshes = meshMap.get(expressID);
          if (!meshes) continue;
          for (const m of meshes) {
            /* predefinedType is not surfaced to mesh userData by the
               IFC worker today (only `expressID` and `ifcType` are set
               at line 1031-1032). Returning null lets `findGroundY`
               fall through to the "any-slab" branch — still produces
               correct ground detection because lowest top-face wins. */
            out.push({ mesh: m, predefinedType: null });
          }
        }
        return out;
      },

      translateModelTo: (position: Vector3) => {
        modelGroupRef.current.position.copy(position);
      },

      restoreModelPosition: () => {
        modelGroupRef.current.position.copy(originalModelPositionRef.current);
      },
    }),
    [loadFile, applyViewMode, applyColorBy, toggleSectionPlane, selectElement, clearSelection, clearModel, onSelect]
  );

  /* ────────────────────────────────────────────────────────── */
  /* Render                                                     */
  /* ────────────────────────────────────────────────────────── */

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        touchAction: "none",
        background: `#${SCENE.background.toString(16).padStart(6, "0")}`,
      }}
    />
  );
});

Viewport.displayName = "Viewport";

export { Viewport };
