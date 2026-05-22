/**
 * KOS BIM (Week 5A) — single-family ingestion orchestrator.
 *
 * One call ingests one .rfa / .dwg source file end-to-end:
 *   SHA-256 idempotency check → KOS S3 upload (original) → APS signed-S3
 *   upload → Model Derivative translation → poll to READY → fetch
 *   metadata + manifest → derive the structured SKU row(s) → store
 *   geometry pointer → mark READY.
 *
 * DESIGN PRINCIPLES
 *   • Idempotent. Re-ingest keys on SHA-256 of the file bytes; an already
 *     READY/TRANSLATING family is skipped, a FAILED one is retried in
 *     place (the @@unique([tenantId, sourceFileHash]) makes a duplicate
 *     row impossible, so we reuse the existing id).
 *   • Fail soft. ingestSingleFamily NEVER throws — every error is recorded
 *     on the family row (apsStatus=FAILED, apsError) and returned as a
 *     FAILED result so a batch script keeps processing the rest.
 *   • Defensive extraction. APS property structures vary wildly across
 *     Revit families; if parameter extraction throws, we log, store the
 *     raw properties in `parameters`, and still mark the family READY.
 *     Empty geometry on an unparametrised .rfa is expected, not an error.
 *
 * Import order note: when run from a script, `scripts/lib/prisma-for-
 * scripts` must be imported FIRST so `@/lib/db` adopts the pg-backed
 * client (see kos-bulk-ingest.ts). This module itself just imports the
 * shared `prisma`.
 */

import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

import { prisma } from "@/lib/db";
import { uploadKosObject } from "@/features/kos/services/s3-client";
import {
  uploadFileToAps,
  startTranslationJob,
  pollTranslationStatus,
  getTranslationMetadata,
  getTranslationManifest,
  estimateApsCredits,
} from "@/features/kos/services/aps-translation";
import {
  extractSkuFromFilename,
  detectAccessoryType,
  detectCategoryFromFolder,
  fileExtension,
  isSupportedBimExtension,
  mimeTypeForExtension,
} from "@/features/kos/lib/kos-bim-naming";
import { KosError } from "@/features/kos/lib/kos-errors";
import { SUPPORTED_BIM_EXTENSIONS } from "@/features/kos/lib/kos-bim-constants";
import type {
  ApsManifest,
  ApsPropertyObject,
  ApsTranslationMetadata,
} from "@/features/kos/types/bim";
import type { Prisma } from "@prisma/client";

const LOG = "[kos-bim-ingestion]";

/** Cap on the JSON blob we persist for rawMetadata (≈100 KB). */
const RAW_METADATA_MAX_CHARS = 100 * 1024;

export type IngestStatus = "READY" | "FAILED" | "SKIPPED_ALREADY_INGESTED";

export interface IngestSingleFamilyArgs {
  tenantId: string;
  /** Absolute path to the source file. */
  filePath: string;
  /** "profiles" | "vertical" | "horizontal" | "systems" | null (root). */
  sourceFolder: string | null;
  /** Absolute path to the package root (for the relative sourcePath). */
  packageRoot: string;
  /** When true, re-ingest even if a READY/TRANSLATING family already exists. */
  force?: boolean;
}

export interface IngestSingleFamilyResult {
  familyId: string | null;
  status: IngestStatus;
  durationMs: number;
  creditsEstimated: number;
  error?: string;
}

// ─── streaming SHA-256 ──────────────────────────────────────────────────

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// ─── property extraction helpers (defensive) ────────────────────────────

/**
 * Flatten APS property bags into a single name→value map. APS nests them
 * as `collection[].properties[<group>][<name>] = value`. First value for
 * a given name wins (objects are ordered root-first).
 */
function flattenProperties(objs: ApsPropertyObject[]): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const obj of objs) {
    const groups = obj.properties;
    if (!groups || typeof groups !== "object") continue;
    for (const group of Object.values(groups)) {
      if (!group || typeof group !== "object") continue;
      for (const [name, value] of Object.entries(group)) {
        if (!(name in flat)) flat[name] = value;
      }
    }
  }
  return flat;
}

/** Pull the first numeric value out of a property value ("200 mm" → 200). */
function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const m = value.match(/-?\d+(?:\.\d+)?/);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Find a numeric param whose name contains any of `needles` (case-insensitive). */
function findNumericParam(
  flat: Record<string, unknown>,
  needles: string[],
): number | null {
  const lowerNeedles = needles.map((n) => n.toLowerCase());
  for (const [name, value] of Object.entries(flat)) {
    const lname = name.toLowerCase();
    if (lowerNeedles.some((n) => lname.includes(n))) {
      const parsed = parseNumeric(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

/** Find a string param whose name contains any of `needles`. */
function findStringParam(
  flat: Record<string, unknown>,
  needles: string[],
): string | null {
  const lowerNeedles = needles.map((n) => n.toLowerCase());
  for (const [name, value] of Object.entries(flat)) {
    const lname = name.toLowerCase();
    if (lowerNeedles.some((n) => lname.includes(n))) {
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
  }
  return null;
}

/** JSON-safe, size-bounded snapshot for the rawMetadata column. */
function boundedJson(value: unknown): Prisma.InputJsonValue {
  try {
    const str = JSON.stringify(value);
    if (str.length <= RAW_METADATA_MAX_CHARS) {
      return JSON.parse(str) as Prisma.InputJsonValue;
    }
    return {
      _truncated: true,
      _reason: `rawMetadata exceeded ${RAW_METADATA_MAX_CHARS} chars (${str.length}); stored a prefix.`,
      preview: str.slice(0, RAW_METADATA_MAX_CHARS),
    } as Prisma.InputJsonValue;
  } catch {
    return { _truncated: true, _reason: "rawMetadata not JSON-serialisable" } as Prisma.InputJsonValue;
  }
}

/** First SVF2 derivative in a manifest, if any (for the geometry pointer). */
function hasSvf2Derivative(manifest: ApsManifest | null): boolean {
  if (!manifest?.derivatives) return false;
  return manifest.derivatives.some(
    (d) => (d.outputType ?? "").toLowerCase() === "svf2",
  );
}

// ─── derived-row writers (idempotent upserts) ────────────────────────────

async function derivePanelType(
  tenantId: string,
  familyId: string,
  skuCode: string,
  displayName: string,
  flat: Record<string, unknown>,
  base64Urn: string,
  hasGeometry: boolean,
): Promise<void> {
  const widthMm = findNumericParam(flat, ["width"]);
  const heightMm = findNumericParam(flat, ["height", "length"]);
  const thicknessMm = findNumericParam(flat, ["thick"]);
  const weightKg = findNumericParam(flat, ["weight", "mass"]);
  const material = findStringParam(flat, ["structural material", "material"]);
  const ribPattern = findStringParam(flat, ["rib"]);
  const fireRatingHours = findNumericParam(flat, ["fire rating", "fire-rating", "frl"]);
  const acousticRwRaw = findNumericParam(flat, ["acoustic", "rw", "stc"]);

  const panel = await prisma.kosBimPanelType.upsert({
    where: { tenantId_skuCode: { tenantId, skuCode } },
    create: {
      tenantId,
      familyId,
      skuCode,
      displayName,
      widthMm,
      heightMm,
      thicknessMm,
      weightKg,
      material,
      ribPattern,
      fireRatingHours,
      acousticRw: acousticRwRaw !== null ? Math.round(acousticRwRaw) : null,
      parameters: boundedJson(flat),
    },
    update: {
      familyId,
      displayName,
      widthMm,
      heightMm,
      thicknessMm,
      weightKg,
      material,
      ribPattern,
      fireRatingHours,
      acousticRw: acousticRwRaw !== null ? Math.round(acousticRwRaw) : null,
      parameters: boundedJson(flat),
    },
    select: { id: true },
  });

  if (hasGeometry) {
    await prisma.kosBimGeometry.upsert({
      where: { panelTypeId: panel.id },
      create: {
        tenantId,
        panelTypeId: panel.id,
        s3KeyMesh: `aps://${base64Urn}`,
        format: "svf2",
      },
      update: { s3KeyMesh: `aps://${base64Urn}`, format: "svf2" },
    });
  }
}

async function deriveAccessory(
  tenantId: string,
  familyId: string,
  skuCode: string,
  displayName: string,
  filename: string,
  flat: Record<string, unknown>,
  base64Urn: string,
  hasGeometry: boolean,
): Promise<void> {
  const loadRatingKn = findNumericParam(flat, ["load rating", "load", "capacity"]);
  const spanMinMm = findNumericParam(flat, ["span min", "min span"]);
  const spanMaxMm = findNumericParam(flat, ["span max", "max span", "span"]);
  const weightKg = findNumericParam(flat, ["weight", "mass"]);

  const accessory = await prisma.kosBimAccessory.upsert({
    where: { tenantId_skuCode: { tenantId, skuCode } },
    create: {
      tenantId,
      familyId,
      skuCode,
      displayName,
      accessoryType: detectAccessoryType(filename),
      loadRatingKn,
      spanMinMm,
      spanMaxMm,
      weightKg,
      parameters: boundedJson(flat),
    },
    update: {
      familyId,
      displayName,
      accessoryType: detectAccessoryType(filename),
      loadRatingKn,
      spanMinMm,
      spanMaxMm,
      weightKg,
      parameters: boundedJson(flat),
    },
    select: { id: true },
  });

  if (hasGeometry) {
    await prisma.kosBimGeometry.upsert({
      where: { accessoryId: accessory.id },
      create: {
        tenantId,
        accessoryId: accessory.id,
        s3KeyMesh: `aps://${base64Urn}`,
        format: "svf2",
      },
      update: { s3KeyMesh: `aps://${base64Urn}`, format: "svf2" },
    });
  }
}

async function deriveAssembly(
  tenantId: string,
  familyId: string,
  assemblyCode: string,
  displayName: string,
  flat: Record<string, unknown>,
  base64Urn: string,
  hasGeometry: boolean,
): Promise<void> {
  const description = findStringParam(flat, ["description", "comments"]);
  // Component panel SKUs aren't reliably encoded in .rfa properties; leave
  // empty for 5A and let a later phase resolve them from assembly geometry.
  const componentPanelSkus: string[] = [];

  const assembly = await prisma.kosBimAssembly.upsert({
    where: { tenantId_assemblyCode: { tenantId, assemblyCode } },
    create: {
      tenantId,
      familyId,
      assemblyCode,
      displayName,
      description,
      componentPanelSkus,
      parameters: boundedJson(flat),
    },
    update: {
      familyId,
      displayName,
      description,
      parameters: boundedJson(flat),
    },
    select: { id: true },
  });

  if (hasGeometry) {
    await prisma.kosBimGeometry.upsert({
      where: { assemblyId: assembly.id },
      create: {
        tenantId,
        assemblyId: assembly.id,
        s3KeyMesh: `aps://${base64Urn}`,
        format: "svf2",
      },
      update: { s3KeyMesh: `aps://${base64Urn}`, format: "svf2" },
    });
  }
}

// ─── main ────────────────────────────────────────────────────────────────

export async function ingestSingleFamily(
  args: IngestSingleFamilyArgs,
): Promise<IngestSingleFamilyResult> {
  const { tenantId, filePath, sourceFolder, packageRoot, force = false } = args;
  const startedAt = Date.now();
  const filename = path.basename(filePath);
  const tag = `${LOG} [${filename}]`;

  const ext = fileExtension(filename);
  const creditsEstimated = (() => {
    try {
      return estimateApsCredits(0, ext); // size filled in below; base estimate
    } catch {
      return 0;
    }
  })();

  let familyId: string | null = null;

  try {
    // ── 0. Resolve tenant (needed for KOS S3) ────────────────────────
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new KosError(
        "KOS_BIM_001",
        `Tenant id "${tenantId}" not found — cannot ingest "${filename}".`,
        404,
      );
    }

    // ── 1. SHA-256 + idempotency check ───────────────────────────────
    const sourceFileHash = await computeFileSha256(filePath);
    const existing = await prisma.kosBimFamily.findUnique({
      where: { tenantId_sourceFileHash: { tenantId, sourceFileHash } },
      select: { id: true, apsStatus: true, s3KeyOriginal: true },
    });

    if (
      !force &&
      existing &&
      (existing.apsStatus === "READY" || existing.apsStatus === "TRANSLATING")
    ) {
      console.info(
        `${tag} SKIP — already ingested (apsStatus=${existing.apsStatus}, id=${existing.id}).`,
      );
      return {
        familyId: existing.id,
        status: "SKIPPED_ALREADY_INGESTED",
        durationMs: Date.now() - startedAt,
        creditsEstimated: 0,
      };
    }

    // ── 2. Pre-flight: extension + size + categorisation ─────────────
    if (!isSupportedBimExtension(ext)) {
      throw new KosError(
        "KOS_BIM_002",
        `Unsupported extension "${ext}" for "${filename}". Supported: ${SUPPORTED_BIM_EXTENSIONS.join(", ")}.`,
        400,
      );
    }
    const stat = await fs.stat(filePath);
    const sizeBytes = stat.size;
    const mimeType = mimeTypeForExtension(ext);
    const familyCategory = detectCategoryFromFolder(sourceFolder, filename);
    const sourcePath = path.relative(packageRoot, filePath) || filename;
    const displayName = filename.replace(/\.[^.]+$/, "");

    // ── 3. Create or reuse the family row (idempotent on hash) ───────
    if (existing) {
      familyId = existing.id;
      await prisma.kosBimFamily.update({
        where: { id: familyId },
        data: {
          apsStatus: "PENDING",
          apsError: null,
          sourceFilename: filename,
          sourceFolder,
          sourcePath,
          sizeBytes,
          mimeType,
          familyCategory,
          displayName,
        },
      });
      console.info(`${tag} RETRY — reusing FAILED row id=${familyId}.`);
    } else {
      const created = await prisma.kosBimFamily.create({
        data: {
          tenantId,
          sourceFilename: filename,
          sourceFolder,
          sourcePath,
          sourceFileHash,
          s3KeyOriginal: "", // filled once we know the id
          sizeBytes,
          mimeType,
          apsStatus: "PENDING",
          familyCategory,
          displayName,
          metadata: { source: "dincel", originalFilename: filename },
        },
        select: { id: true },
      });
      familyId = created.id;
    }

    const s3KeyOriginal = `bim/families/${tenantId}/${familyId}/${filename}`;

    // ── 4. Upload original to KOS S3 ─────────────────────────────────
    const buffer = await fs.readFile(filePath);
    await uploadKosObject(tenant, s3KeyOriginal, buffer, mimeType);
    await prisma.kosBimFamily.update({
      where: { id: familyId },
      data: { s3KeyOriginal, apsStatus: "UPLOADING" },
    });
    console.info(
      `${tag} uploaded ${(sizeBytes / 1024).toFixed(0)} KB → KOS S3; category=${familyCategory}.`,
    );

    // ── 5. APS signed-S3 upload ──────────────────────────────────────
    const apsObjectKey = `${familyId}-${filename}`;
    const { objectId, base64Urn } = await uploadFileToAps({
      filePath,
      objectKey: apsObjectKey,
      contentType: mimeType,
      fileSize: sizeBytes,
    });

    await prisma.kosBimFamily.update({
      where: { id: familyId },
      data: {
        apsStatus: "TRANSLATING",
        apsUrn: base64Urn,
        apsObjectKey,
        apsBucketKey: process.env.APS_BUCKET_KEY ?? "kos-buildflow-bim-dev",
      },
    });
    console.info(`${tag} uploaded to APS (objectId=${objectId.slice(0, 40)}…).`);

    // ── 6. Start translation + poll ──────────────────────────────────
    const { jobId } = await startTranslationJob(base64Urn, ext);
    if (jobId) {
      await prisma.kosBimFamily.update({
        where: { id: familyId },
        data: { apsJobId: jobId },
      });
    }

    const poll = await pollTranslationStatus(base64Urn);
    if (poll.status === "FAILED") {
      const reason = describeManifestFailure(poll.manifest);
      await prisma.kosBimFamily.update({
        where: { id: familyId },
        data: { apsStatus: "FAILED", apsError: `APS translation failed: ${reason}` },
      });
      console.error(`${tag} translation FAILED — ${reason}`);
      return {
        familyId,
        status: "FAILED",
        durationMs: Date.now() - startedAt,
        creditsEstimated: estimateApsCredits(sizeBytes, ext),
        error: `APS translation failed: ${reason}`,
      };
    }

    // ── 7. Metadata + manifest (best-effort) ─────────────────────────
    const metadata: ApsTranslationMetadata = await getTranslationMetadata(
      base64Urn,
    );
    let manifest: ApsManifest | null = poll.manifest;
    try {
      manifest = await getTranslationManifest(base64Urn);
    } catch (err) {
      console.warn(
        `${tag} manifest fetch failed (using poll manifest): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // ── 8. Cache manifest JSON to S3 ─────────────────────────────────
    let s3KeyManifest: string | null = null;
    if (manifest) {
      try {
        s3KeyManifest = `bim/families/${tenantId}/${familyId}/manifest.json`;
        await uploadKosObject(
          tenant,
          s3KeyManifest,
          Buffer.from(JSON.stringify(manifest), "utf8"),
          "application/json",
        );
      } catch (err) {
        console.warn(
          `${tag} manifest S3 cache failed (non-fatal): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        s3KeyManifest = null;
      }
    }

    // ── 9. Derive structured rows (defensive — never fail ingestion) ─
    const skuCode = extractSkuFromFilename(filename);
    const hasGeometry = hasSvf2Derivative(manifest);
    const flat = flattenProperties(metadata.properties);
    try {
      switch (familyCategory) {
        case "PANEL":
          await derivePanelType(
            tenantId,
            familyId,
            skuCode,
            displayName,
            flat,
            base64Urn,
            hasGeometry,
          );
          break;
        case "ACCESSORY":
          await deriveAccessory(
            tenantId,
            familyId,
            skuCode,
            displayName,
            filename,
            flat,
            base64Urn,
            hasGeometry,
          );
          break;
        case "ASSEMBLY":
          await deriveAssembly(
            tenantId,
            familyId,
            skuCode,
            displayName,
            flat,
            base64Urn,
            hasGeometry,
          );
          break;
        case "REFERENCE":
        case "OTHER":
          // Family row only — no derived SKU.
          break;
      }
    } catch (err) {
      console.error(
        `${tag} derived-row extraction failed (family still marked READY; raw props retained): ${
          err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        }`,
      );
    }

    if (!hasGeometry) {
      console.warn(
        `${tag} no SVF2 geometry derivative — common for unparametrised .rfa families; SKU stored without a geometry pointer.`,
      );
    }

    // ── 10. Finalize ─────────────────────────────────────────────────
    await prisma.kosBimFamily.update({
      where: { id: familyId },
      data: {
        apsStatus: "READY",
        apsTranslatedAt: new Date(),
        ingestedAt: new Date(),
        s3KeyManifest,
        apsCreditCost: estimateApsCredits(sizeBytes, ext),
        rawMetadata: boundedJson({
          properties: metadata.properties,
          viewables: metadata.viewables,
        }),
      },
    });

    const durationMs = Date.now() - startedAt;
    console.info(
      `${tag} READY ✓ sku=${skuCode} category=${familyCategory} (${(durationMs / 1000).toFixed(1)}s).`,
    );
    return {
      familyId,
      status: "READY",
      durationMs,
      creditsEstimated: estimateApsCredits(sizeBytes, ext),
    };
  } catch (err) {
    const message =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack =
      err instanceof Error && err.stack ? err.stack.slice(0, 1024) : undefined;
    console.error(`${tag} FAILED — ${message}`, stack ?? "");

    // Record the failure on the row if we got far enough to create one.
    if (familyId) {
      try {
        await prisma.kosBimFamily.update({
          where: { id: familyId },
          data: {
            apsStatus: "FAILED",
            apsError: stack ? `${message}\n${stack}` : message,
          },
        });
      } catch (updateErr) {
        console.error(
          `${tag} could not persist FAILED status: ${
            updateErr instanceof Error ? updateErr.message : String(updateErr)
          }`,
        );
      }
    }

    return {
      familyId,
      status: "FAILED",
      durationMs: Date.now() - startedAt,
      creditsEstimated,
      error: message,
    };
  }
}

/** Extract a human reason from a failed manifest's messages, if present. */
function describeManifestFailure(manifest: ApsManifest | null): string {
  if (!manifest) return "no manifest available";
  const derivatives = manifest.derivatives ?? [];
  for (const d of derivatives) {
    const messages = (d as { messages?: Array<{ type?: string; message?: unknown }> })
      .messages;
    if (Array.isArray(messages)) {
      const errs = messages
        .filter((m) => (m.type ?? "").toLowerCase() === "error")
        .map((m) =>
          typeof m.message === "string" ? m.message : JSON.stringify(m.message),
        );
      if (errs.length) return errs.join("; ").slice(0, 400);
    }
  }
  return `status=${manifest.status ?? "unknown"}`;
}
