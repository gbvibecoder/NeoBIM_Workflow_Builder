"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { WebGLRenderer, PCFSoftShadowMap, ACESFilmicToneMapping, Scene, Color, PerspectiveCamera, AmbientLight, DirectionalLight, PlaneGeometry, MeshStandardMaterial, Mesh, GridHelper, Box3, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Loader2, AlertCircle, RotateCcw, Maximize2, Minimize2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

interface Building3DViewerProps {
  glbUrl: string;
  height?: number;
  onError?: (error: string) => void;
}

export default function Building3DViewer({
  glbUrl,
  height = 320,
  onError,
}: Building3DViewerProps) {
  const { t } = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const controlsRef = useRef<OrbitControls | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
    if (controlsRef.current) {
      controlsRef.current.dispose();
      controlsRef.current = null;
    }
  }, []);

  const loadModel = useCallback(() => {
    const container = containerRef.current;
    if (!container || !glbUrl) return;

    cleanup();
    container.innerHTML = "";
    setLoading(true);
    setError(null);
    setProgress(0);

    const w = container.clientWidth;
    const h = expanded ? Math.min(window.innerHeight * 0.7, 600) : height;

    // Renderer
    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFSoftShadowMap;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new Scene();
    scene.background = new Color(0x0d0d1a);

    // Camera
    const camera = new PerspectiveCamera(45, w / h, 0.01, 1000);
    camera.position.set(3, 2, 3);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;
    controls.minDistance = 0.5;
    controls.maxDistance = 50;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(5, 8, 5);
    dirLight.castShadow = true;
    scene.add(dirLight);

    const fillLight = new DirectionalLight(0x4fc3f7, 0.4);
    fillLight.position.set(-3, 2, -3);
    scene.add(fillLight);

    // Ground plane
    const groundGeometry = new PlaneGeometry(20, 20);
    const groundMaterial = new MeshStandardMaterial({
      color: 0x111122,
      roughness: 0.9,
      metalness: 0.1,
    });
    const ground = new Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Grid helper
    const gridHelper = new GridHelper(20, 40, 0x1a1a2e, 0x1a1a2e);
    gridHelper.position.y = 0.001;
    scene.add(gridHelper);

    // Load GLB
    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        const model = gltf.scene;

        // Compute bounding box and center/scale model
        const box = new Box3().setFromObject(model);
        const center = box.getCenter(new Vector3());
        const size = box.getSize(new Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim; // Normalize to ~2 units

        model.scale.multiplyScalar(scale);
        model.position.sub(center.multiplyScalar(scale));
        model.position.y += (size.y * scale) / 2; // Place on ground

        // Enable shadows
        model.traverse((child) => {
          if (child instanceof Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });

        scene.add(model);

        // Adjust camera to fit model
        const scaledBox = new Box3().setFromObject(model);
        const scaledCenter = scaledBox.getCenter(new Vector3());
        const scaledSize = scaledBox.getSize(new Vector3());
        const maxScaledDim = Math.max(scaledSize.x, scaledSize.y, scaledSize.z);

        camera.position.set(
          scaledCenter.x + maxScaledDim * 1.5,
          scaledCenter.y + maxScaledDim * 0.8,
          scaledCenter.z + maxScaledDim * 1.5
        );
        controls.target.copy(scaledCenter);
        controls.update();

        setLoading(false);
      },
      (xhr) => {
        if (xhr.total > 0) {
          setProgress(Math.round((xhr.loaded / xhr.total) * 100));
        }
      },
      (err) => {
        const msg = "Failed to load 3D model";
        console.error("[Building3DViewer]", err);
        cleanup(); // Ensure renderer/controls are disposed on load error
        setError(msg);
        setLoading(false);
        onError?.(msg);
      }
    );

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // Resize handler
    const handleResize = () => {
      const newW = container.clientWidth;
      const newH = expanded ? Math.min(window.innerHeight * 0.7, 600) : height;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [glbUrl, height, expanded, cleanup, onError]);

  useEffect(() => {
    const removeResizeListener = loadModel();
    return () => {
      removeResizeListener?.();
      cleanup();
    };
  }, [loadModel, cleanup]);

  return (
    <div className="relative w-full" style={{ minHeight: expanded ? 600 : height }}>
      {/* Toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        <button
          onClick={() => {
            controlsRef.current?.reset();
          }}
          className="rounded p-1.5 transition-colors"
          style={{ background: "rgba(13, 13, 26, 0.8)", color: "#4FC3F7" }}
          title={t('viewer.resetCamera')}
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded p-1.5 transition-colors"
          style={{ background: "rgba(13, 13, 26, 0.8)", color: "#4FC3F7" }}
          title={expanded ? t('viewer.collapse') : t('viewer.expand')}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2"
          style={{ background: "#0D0D1A", borderRadius: 8 }}
        >
          <Loader2 size={24} className="animate-spin" style={{ color: "#4FC3F7" }} />
          <span style={{ fontSize: 11, color: "#6B6B80" }}>
            {t('viewer.loading3dModel')}{progress > 0 ? ` (${progress}%)` : "..."}
          </span>
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3"
          style={{ background: "#0D0D1A", borderRadius: 8 }}
        >
          <AlertCircle size={24} style={{ color: "#ef4444" }} />
          <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
          <button
            onClick={loadModel}
            className="rounded px-3 py-1 text-xs transition-colors"
            style={{ background: "rgba(79, 195, 247, 0.15)", color: "#4FC3F7", border: "1px solid rgba(79, 195, 247, 0.3)" }}
          >
            {t('viewer.retry')}
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full"
        style={{
          height: expanded ? Math.min(typeof window !== "undefined" ? window.innerHeight * 0.7 : 600, 600) : height,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />

      {/* SAM 3D attribution */}
      <div className="absolute bottom-2 left-2 z-10" style={{ fontSize: 9, color: "#3A3A50" }}>
        SAM 3D via fal.ai
      </div>
    </div>
  );
}
