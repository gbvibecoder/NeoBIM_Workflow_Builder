/**
 * KOS BIM (Week 5A) — shared types for the Autodesk APS ingestion
 * pipeline. Kept thin and structural: these mirror the *shapes* of the
 * APS REST responses we actually read, not the full (huge) schemas.
 * Anything we don't consume is left as `unknown` / index signatures so a
 * minor APS payload change can't break the build.
 */

/** APS OSS bucket retention policy. */
export type KosApsBucketPolicy = "transient" | "temporary" | "persistent";

/** One object as returned by `GET /oss/v2/buckets/<key>/objects`. */
export interface ApsBucketObject {
  bucketKey: string;
  objectId: string;
  objectKey: string;
  sha1?: string;
  size: number;
  location?: string;
}

/** Translation lifecycle status, normalised to our KosBimApsStatus-ish set. */
export type ApsTranslationStatus =
  | "PENDING"
  | "TRANSLATING"
  | "READY"
  | "FAILED";

/**
 * Model Derivative manifest (`GET .../<urn>/manifest`). Only the fields
 * the pipeline reads are typed; the rest is preserved via the index
 * signature so we can persist the full blob.
 */
export interface ApsManifest {
  type?: string;
  hasThumbnail?: string;
  status?: string;
  progress?: string;
  region?: string;
  urn?: string;
  derivatives?: ApsDerivative[];
  [key: string]: unknown;
}

export interface ApsDerivative {
  name?: string;
  hasThumbnail?: string;
  status?: string;
  progress?: string;
  outputType?: string;
  children?: ApsDerivativeChild[];
  [key: string]: unknown;
}

export interface ApsDerivativeChild {
  guid?: string;
  type?: string;
  role?: string;
  mime?: string;
  urn?: string;
  status?: string;
  children?: ApsDerivativeChild[];
  [key: string]: unknown;
}

/** A single viewable from `GET .../<urn>/metadata`. */
export interface ApsViewable {
  guid: string;
  name?: string;
  role?: string;
  type?: string;
  [key: string]: unknown;
}

/**
 * One property bag from `GET .../<urn>/metadata/<guid>/properties`. APS
 * nests them under `data.collection[]`; each object carries an arbitrary
 * `properties` map of `{ <group>: { <name>: <value> } }`.
 */
export interface ApsPropertyObject {
  objectid?: number;
  name?: string;
  externalId?: string;
  properties?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

/** Aggregated metadata returned by `getTranslationMetadata`. */
export interface ApsTranslationMetadata {
  properties: ApsPropertyObject[];
  hierarchy: unknown | null;
  viewables: ApsViewable[];
}

/** Result of polling a translation to a terminal-ish state. */
export interface ApsPollResult {
  status: ApsTranslationStatus;
  progress: string;
  manifest: ApsManifest | null;
}

/** Result of the 3-step signed-S3 upload. */
export interface ApsUploadResult {
  /** The APS objectId, e.g. "urn:adsk.objects:os.object:<bucket>/<key>". */
  objectId: string;
  /** URL-safe base64 of objectId — the Model Derivative input urn. */
  base64Urn: string;
}
