/**
 * Phase 1 Track D — TS-side payload shape test for the IFC service boundary.
 *
 * The Python-side baseline test (neobim-ifc-service/tests/test_baseline_quality.py)
 * validates what the service DOES with a payload. This test validates what
 * the TS client SENDS. Together they lock both sides of the wire:
 *
 *     EX-001 → generateIFCViaService → fetch(/api/v1/export-ifc)
 *          ^^^ this test                ^^^ Python test
 *
 * Invariants enforced here:
 *   1. Request method is POST to `${IFC_SERVICE_URL}/api/v1/export-ifc`.
 *   2. Authorization header carries the bearer token from IFC_SERVICE_API_KEY.
 *   3. Body matches Python's ExportIFCRequest shape:
 *        {geometry, options:{projectName, buildingName, author, disciplines, richMode?}, filePrefix}
 *   4. richMode is forwarded only when supplied; absent otherwise.
 *   5. Discipline list defaults to [architectural, structural, mep, combined].
 *   6. Track C camelCase fields survive (materialGrade, fireRating, mepSystem, …).
 *
 * Each `it()` uses `vi.resetModules()` + dynamic import so module-level
 * `const IFC_SERVICE_URL = process.env.…` reads the stubbed env freshly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MassingGeometry } from "@/types/geometry";

const MOCK_URL = "https://mock-ifc-service.local";
const MOCK_KEY = "test-api-key-42";

// ── Minimal geometry exercising Track C on the wire ─────────────────────

const richGeometry: MassingGeometry = {
  buildingType: "Office Building",
  floors: 1,
  totalHeight: 3.6,
  footprintArea: 100,
  gfa: 100,
  footprint: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
  storeys: [
    {
      index: 0,
      name: "GF",
      elevation: 0,
      height: 3.6,
      elements: [
        {
          id: "w1",
          type: "wall",
          ifcType: "IfcWall",
          vertices: [
            { x: 0, y: 0, z: 0 },
            { x: 10, y: 0, z: 0 },
          ],
          faces: [],
          properties: {
            name: "W1",
            storeyIndex: 0,
            length: 10,
            height: 3.6,
            thickness: 0.25,
            wallType: "exterior",
            loadBearing: true,
            fireRating: "2HR",
            uValue: 0.28,
            materialGrade: "C30/37",
            mepSystem: "hvac-supply",
          },
        },
      ],
    },
  ],
  boundingBox: {
    min: { x: 0, y: 0, z: 0 },
    max: { x: 10, y: 10, z: 3.6 },
  },
  metrics: [],
};

// Success response fetched by the client — minimal to let the call complete.
const stubOkResponse = () =>
  new Response(
    JSON.stringify({
      status: "success",
      files: [
        {
          discipline: "combined",
          file_name: "x.ifc",
          download_url: "https://r2.example/x.ifc",
          size: 1,
          schema_version: "IFC4",
          entity_count: 1,
        },
      ],
      metadata: {
        engine: "ifcopenshell",
        ifcopenshell_version: "0.8.5",
        generation_time_ms: 1,
        validation_passed: true,
        entity_counts: {},
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

// ── Shared helpers ─────────────────────────────────────────────────────

async function importClientFreshly() {
  vi.resetModules();
  return import("@/features/ifc/services/ifc-service-client");
}

beforeEach(() => {
  vi.stubEnv("IFC_SERVICE_URL", MOCK_URL);
  vi.stubEnv("IFC_SERVICE_API_KEY", MOCK_KEY);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────

describe("ifc-service-client payload shape (Track D)", () => {
  it("POSTs to /api/v1/export-ifc with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stubOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { generateIFCViaService } = await importClientFreshly();
    await generateIFCViaService(
      richGeometry,
      { projectName: "Proj", buildingName: "Bldg" },
      "prefix",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers?: Record<string, string> },
    ];
    expect(url).toBe(`${MOCK_URL}/api/v1/export-ifc`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Authorization"]).toBe(`Bearer ${MOCK_KEY}`);
  });

  it("request body matches Python ExportIFCRequest shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stubOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { generateIFCViaService } = await importClientFreshly();
    await generateIFCViaService(
      richGeometry,
      { projectName: "Proj", buildingName: "Bldg", author: "Tester" },
      "track-d-prefix",
    );

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);

    // Top-level shape
    expect(body).toHaveProperty("geometry");
    expect(body).toHaveProperty("options");
    expect(body).toHaveProperty("filePrefix", "track-d-prefix");

    // Geometry shape (camelCase — Pydantic alias map)
    expect(body.geometry).toMatchObject({
      buildingType: "Office Building",
      floors: 1,
      totalHeight: 3.6,
      footprintArea: 100,
      gfa: 100,
    });
    expect(Array.isArray(body.geometry.storeys)).toBe(true);
    expect(body.geometry.storeys[0]).toMatchObject({
      index: 0,
      name: "GF",
      elevation: 0,
    });

    // Options defaults
    expect(body.options).toMatchObject({
      projectName: "Proj",
      buildingName: "Bldg",
      author: "Tester",
      disciplines: ["architectural", "structural", "mep", "combined"],
    });
  });

  it("richMode is present when supplied, absent otherwise", async () => {
    // No richMode → field absent
    {
      const fetchMock = vi.fn().mockResolvedValue(stubOkResponse());
      vi.stubGlobal("fetch", fetchMock);
      const { generateIFCViaService } = await importClientFreshly();
      await generateIFCViaService(
        richGeometry,
        { projectName: "P", buildingName: "B" },
        "nore",
      );
      const body = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      );
      expect(body.options).not.toHaveProperty("richMode");
    }

    // richMode="full" → forwarded
    {
      const fetchMock = vi.fn().mockResolvedValue(stubOkResponse());
      vi.stubGlobal("fetch", fetchMock);
      const { generateIFCViaService } = await importClientFreshly();
      await generateIFCViaService(
        richGeometry,
        { projectName: "P", buildingName: "B", richMode: "full" },
        "full",
      );
      const body = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      );
      expect(body.options.richMode).toBe("full");
    }

    // richMode="structural" → forwarded verbatim
    {
      const fetchMock = vi.fn().mockResolvedValue(stubOkResponse());
      vi.stubGlobal("fetch", fetchMock);
      const { generateIFCViaService } = await importClientFreshly();
      await generateIFCViaService(
        richGeometry,
        { projectName: "P", buildingName: "B", richMode: "structural" },
        "struct",
      );
      const body = JSON.parse(
        fetchMock.mock.calls[0][1].body as string,
      );
      expect(body.options.richMode).toBe("structural");
    }
  });

  it("Track C camelCase fields survive JSON.stringify round-trip", async () => {
    const fetchMock = vi.fn().mockResolvedValue(stubOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { generateIFCViaService } = await importClientFreshly();
    await generateIFCViaService(
      richGeometry,
      { projectName: "P", buildingName: "B" },
      "track-c",
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const wall = body.geometry.storeys[0].elements[0];
    expect(wall.properties).toMatchObject({
      wallType: "exterior",
      loadBearing: true,
      fireRating: "2HR",
      uValue: 0.28,
      materialGrade: "C30/37",
      mepSystem: "hvac-supply",
    });
  });

  it("returns null (→ TS fallback) when service URL unset", async () => {
    vi.stubEnv("IFC_SERVICE_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { generateIFCViaService } = await importClientFreshly();
    const result = await generateIFCViaService(
      richGeometry,
      { projectName: "P", buildingName: "B" },
      "x",
    );
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns null when service responds with HTTP error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { generateIFCViaService } = await importClientFreshly();
    const result = await generateIFCViaService(
      richGeometry,
      { projectName: "P", buildingName: "B" },
      "x",
    );
    expect(result).toBeNull();
  });
});
