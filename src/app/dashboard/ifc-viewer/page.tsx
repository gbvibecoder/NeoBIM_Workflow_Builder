"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { saveLastIFCFile } from "@/features/ifc/lib/ifc-cache";

/* Dynamic import with SSR disabled — web-ifc uses WASM which can't run server-side */
const IFCViewerPage = dynamic(() => import("@/features/ifc/components/IFCViewerPage"), {
  ssr: false,
  loading: () => <Splash label="Loading IFC Viewer..." />,
});

function Splash({ label }: { label: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        background: "#07070D",
        color: "#5C5C78",
        fontSize: 14,
      }}
    >
      {label}
    </div>
  );
}

/**
 * Phase 1 D7 — when ?executionId=<id> is on the URL, the page fetches the
 * execution, walks tileResults for the latest IFC artifact, hydrates the
 * IFC bytes into the existing IndexedDB cache, then mounts IFCViewerPage.
 * IFCViewerPage's existing mount-restore logic reads the cache and loads
 * automatically — no changes to IFCViewerPage / Viewport / Worker.
 *
 * Without ?executionId, the page renders the upload UI as before.
 */
export default function Page() {
  return (
    <Suspense fallback={<Splash label="Loading IFC Viewer..." />}>
      <IFCViewerEntry />
    </Suspense>
  );
}

interface ApiArtifact {
  type?: string;
  data?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  nodeLabel?: string | null;
  nodeId?: string;
}

interface ApiExecutionResponse {
  execution?: {
    artifacts?: ApiArtifact[];
  };
}

function IFCViewerEntry() {
  const params = useSearchParams();
  const executionId = params.get("executionId");
  const [hydrating, setHydrating] = useState<boolean>(!!executionId);
  const [hydrated, setHydrated] = useState<boolean>(!executionId);

  useEffect(() => {
    if (!executionId) return;
    let cancelled = false;
    setHydrating(true);
    const toastId: string | number = toast.loading("Loading IFC artifact from execution…", {
      id: `ifc-hydrate-${executionId}`,
    });

    (async () => {
      try {
        const res = await fetch(`/api/executions/${executionId}`, { cache: "no-store" });
        if (!res.ok) {
          throw new Error(`Execution fetch failed (${res.status})`);
        }
        const json = (await res.json()) as ApiExecutionResponse;
        const artifacts = json.execution?.artifacts ?? [];
        // Prefer the LAST IFC artifact in case the workflow produced several
        // intermediate exports.
        const ifcArtifact = [...artifacts].reverse().find(a => isIfcArtifact(a));
        if (!ifcArtifact || !ifcArtifact.data) {
          throw new Error("No IFC artifact in this execution");
        }

        const buffer = await materializeIFC(ifcArtifact.data);
        if (!buffer || buffer.byteLength === 0) {
          throw new Error("IFC artifact had no usable bytes");
        }

        const fileName =
          (typeof ifcArtifact.data.fileName === "string" && ifcArtifact.data.fileName) ||
          (typeof ifcArtifact.data.name === "string" && ifcArtifact.data.name) ||
          `execution-${executionId.slice(0, 8)}.ifc`;

        await saveLastIFCFile(buffer, fileName);
        if (cancelled) return;

        toast.success(`Loaded ${fileName}`, { id: toastId });
        setHydrated(true);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "Couldn't load IFC artifact";
        toast.error(`No IFC found in this execution`, { id: toastId, description: msg });
        // Fall through to the upload UI — IFCViewerPage will render its
        // own UploadZone since the cache is empty for this user.
        setHydrated(true);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [executionId]);

  if (executionId && hydrating && !hydrated) {
    return <Splash label="Hydrating IFC from execution…" />;
  }

  return <IFCViewerPage autoEnhance={!!executionId} />;
}

function isIfcArtifact(art: ApiArtifact): boolean {
  if (art.type === "ifc") return true;
  // Files emitted by EX-001 land as `type: "file"` with the IFC bytes; the
  // node-catalogue id lives in metadata or the nodeLabel.
  if (art.type !== "file") return false;
  const data = art.data ?? {};
  const meta = art.metadata ?? {};
  const fileName =
    (typeof data.fileName === "string" && data.fileName) ||
    (typeof data.name === "string" && data.name) ||
    "";
  if (fileName.toLowerCase().endsWith(".ifc")) return true;
  if (typeof data._ifcContent === "string") return true;
  if (typeof meta.engine === "string" && (meta.engine === "ifcopenshell" || meta.engine === "ifc-exporter")) return true;
  return false;
}

async function materializeIFC(data: Record<string, unknown>): Promise<ArrayBuffer | null> {
  // Path 1: raw STEP text from the TS-fallback exporter
  const rawText = typeof data._ifcContent === "string" ? data._ifcContent : null;
  if (rawText && rawText.length > 0) {
    return new TextEncoder().encode(rawText).buffer as ArrayBuffer;
  }

  // Path 2: data: URI fallback
  const url = typeof data.downloadUrl === "string" ? data.downloadUrl : typeof data.url === "string" ? data.url : null;
  if (!url) return null;

  if (url.startsWith("data:")) {
    const [, b64] = url.split(",");
    if (!b64) return null;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  // Path 3: hosted on R2 / public CDN — fetch the bytes
  const fileRes = await fetch(url);
  if (!fileRes.ok) return null;
  return await fileRes.arrayBuffer();
}
