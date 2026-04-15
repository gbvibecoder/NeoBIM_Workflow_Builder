"use client";

/**
 * IndexedDB cache for the last-opened IFC file so a page refresh doesn't
 * drop the user back to the empty upload screen.
 *
 * Storage shape: { blob: Blob, name: string, savedAt: number }
 *
 * Why a Blob (not a raw ArrayBuffer): `new Blob([buffer])` synchronously
 * copies the bytes into the Blob's backing store, so the Blob survives even
 * if the caller subsequently transfers the same ArrayBuffer into a Web
 * Worker via `postMessage(..., [buffer])`. That ordering is unavoidable —
 * the 3D viewer transfers the buffer as soon as we hand it to it — so the
 * cache snapshot must be captured synchronously, without relying on a
 * post-`await` copy that could race the transfer.
 *
 * Why IndexedDB (not localStorage): IFC files routinely weigh 10s of MB;
 * localStorage caps at ~5 MB per origin and stores only strings.
 */

const DB_NAME = "neobim-ifc-cache";
const STORE_NAME = "lastFile";
const KEY = "current";
const DB_VERSION = 1;
const DEBUG = true; // toggle to quiet the console

interface StoredRecord {
  blob: Blob;
  name: string;
  savedAt: number;
}

export interface CachedIFCFile {
  buffer: ArrayBuffer;
  name: string;
  savedAt: number;
}

function log(...args: unknown[]) {
  if (DEBUG && typeof console !== "undefined") console.info("[ifc-cache]", ...args);
}
function warn(...args: unknown[]) {
  if (typeof console !== "undefined") console.warn("[ifc-cache]", ...args);
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onblocked = () => reject(new Error("IndexedDB open blocked"));
  });
}

export async function saveLastIFCFile(buffer: ArrayBuffer, name: string): Promise<void> {
  /* CRITICAL: capture the bytes synchronously before any `await`.
     `new Blob([buffer])` copies the bytes into the Blob's backing store in
     the same microtask, so a subsequent transfer of the same ArrayBuffer
     into a Worker thread can't steal them out from under us. */
  if (!buffer || buffer.byteLength === 0) {
    warn("save skipped — empty buffer");
    return;
  }
  let blob: Blob;
  try {
    blob = new Blob([buffer]);
  } catch (err) {
    warn("Blob() construction failed:", err);
    return;
  }
  log(`saving ${blob.size} bytes (${name})`);

  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const record: StoredRecord = { blob, name, savedAt: Date.now() };
      tx.objectStore(STORE_NAME).put(record, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    log("save committed");
  } catch (err) {
    warn("save failed:", err);
  }
}

export async function loadLastIFCFile(): Promise<CachedIFCFile | null> {
  try {
    const db = await openDB();
    const record = await new Promise<StoredRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(KEY);
      req.onsuccess = () => resolve((req.result as StoredRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (!record) {
      log("load — no cached file");
      return null;
    }

    /* Older iterations of this cache stored `{ buffer }` (ArrayBuffer) or
       `{ blob }` (File). Accept both; only `blob` is Blob-like and has
       .arrayBuffer(). If the record predates this version, bail out so the
       caller shows the upload screen and the next upload refreshes the
       record into the current shape. */
    if (!record.blob || typeof (record.blob as Blob).arrayBuffer !== "function") {
      warn("load — cached record missing blob (stale format); clearing");
      void clearLastIFCFile();
      return null;
    }

    const buffer = await record.blob.arrayBuffer();
    log(`load — ${buffer.byteLength} bytes (${record.name})`);
    return { buffer, name: record.name, savedAt: record.savedAt };
  } catch (err) {
    warn("load failed:", err);
    return null;
  }
}

export async function clearLastIFCFile(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    log("cleared");
  } catch (err) {
    warn("clear failed:", err);
  }
}
