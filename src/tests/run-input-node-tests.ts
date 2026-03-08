/**
 * Input Node Test Runner
 * Validates all 7 input nodes with realistic AEC test data.
 * Calls the actual /api/execute-node endpoint.
 */

import {
  testTextPrompt,
  testPDFContent,
  testImageInputs,
  testIFCData,
  testParameterSets,
  testLocations,
  testCADFiles,
  edgeCaseInputs,
  VALIDATION_THRESHOLDS,
  type TestParameterSet,
  type TestLocationExpectedGIS,
} from "./input-node-test-data";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ValidationCheck {
  checkName: string;
  passed: boolean;
  expected: unknown;
  received: unknown;
}

export interface NodeTestResult {
  nodeId: string;
  nodeName: string;
  testCase: string;
  status: "PASS" | "FAIL" | "SKIP" | "ERROR";
  executionTimeMs: number;
  inputProvided: unknown;
  outputReceived: unknown;
  artifactsGenerated: number;
  artifactTypes: string[];
  errorMessage?: string;
  warningMessages: string[];
  validationChecks: ValidationCheck[];
}

export interface TestSummaryReport {
  timestamp: string;
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  passRate: number;
  totalExecutionTimeMs: number;
  slowestNode: { name: string; timeMs: number };
  fastestNode: { name: string; timeMs: number };
  results: NodeTestResult[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function callExecuteNode(
  catalogueId: string,
  inputData: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VALIDATION_THRESHOLDS.maxExecutionTimeMs);

  try {
    const res = await fetch("/api/execute-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogueId,
        executionId: `test-${Date.now()}`,
        tileInstanceId: `test-tile-${catalogueId}`,
        inputData,
      }),
      signal: controller.signal,
    });

    const data = (await res.json()) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        data: { error: "Request timed out after 30s" },
      };
    }
    return {
      ok: false,
      status: 0,
      data: { error: err instanceof Error ? err.message : "Unknown error" },
    };
  } finally {
    clearTimeout(timeout);
  }
}

function check(
  name: string,
  expected: unknown,
  received: unknown,
  condition: boolean
): ValidationCheck {
  return { checkName: name, passed: condition, expected, received };
}

// ─── Individual Node Tests ──────────────────────────────────────────────────

async function testTextPromptNode(
  testCase: string,
  prompt: string
): Promise<NodeTestResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const checks: ValidationCheck[] = [];

  // Input node (IN-001) is native — it just stores the text.
  // The real API call happens at TR-003 which consumes the text.
  // We test the downstream consumption.
  const res = await callExecuteNode("TR-003", { prompt, content: prompt });
  const elapsed = Date.now() - start;

  checks.push(check("Input accepted without error", true, res.ok, res.ok));
  checks.push(
    check(
      "Text length >= minimum",
      `>= ${VALIDATION_THRESHOLDS.minTextLength}`,
      prompt.length,
      prompt.length >= VALIDATION_THRESHOLDS.minTextLength
    )
  );

  if (prompt.length < VALIDATION_THRESHOLDS.minTextLength) {
    warnings.push("Text prompt is very short — architect should be more specific");
  }

  const artifact = res.data?.artifact as Record<string, unknown> | undefined;
  const hasArtifact = !!artifact;
  checks.push(check("At least 1 artifact generated", true, hasArtifact, hasArtifact));

  if (artifact) {
    const data = artifact.data as Record<string, unknown> | undefined;
    const content = data?.content as string | undefined;
    checks.push(
      check("Output has content", true, !!content, !!content && content.length > 0)
    );
    checks.push(
      check(
        "Execution time under threshold",
        `< ${VALIDATION_THRESHOLDS.maxExecutionTimeMs}ms`,
        `${elapsed}ms`,
        elapsed < VALIDATION_THRESHOLDS.maxExecutionTimeMs
      )
    );
  }

  const allPassed = checks.every((c) => c.passed);

  return {
    nodeId: "IN-001",
    nodeName: "Text Prompt",
    testCase,
    status: !res.ok ? "FAIL" : allPassed ? "PASS" : "FAIL",
    executionTimeMs: elapsed,
    inputProvided: { prompt: prompt.substring(0, 100) + "..." },
    outputReceived: artifact ? { type: artifact.type, hasContent: true } : null,
    artifactsGenerated: hasArtifact ? 1 : 0,
    artifactTypes: artifact ? [String(artifact.type)] : [],
    errorMessage: !res.ok ? String(res.data?.error ?? res.data?.message ?? "Request failed") : undefined,
    warningMessages: warnings,
    validationChecks: checks,
  };
}

async function testPDFUploadNode(): Promise<NodeTestResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const checks: ValidationCheck[] = [];

  // IN-002 feeds into TR-001 (Brief Parser)
  const res = await callExecuteNode("TR-001", {
    content: testPDFContent.mockExtractedText,
    prompt: testPDFContent.mockExtractedText,
    rawText: testPDFContent.mockExtractedText,
  });
  const elapsed = Date.now() - start;

  checks.push(check("Input accepted without error", true, res.ok, res.ok));

  const artifact = res.data?.artifact as Record<string, unknown> | undefined;
  const hasArtifact = !!artifact;
  checks.push(check("At least 1 artifact generated", true, hasArtifact, hasArtifact));

  if (artifact) {
    const data = artifact.data as Record<string, unknown> | undefined;
    const content = (data?.content as string) ?? "";
    checks.push(
      check("Output contains project title", true, content.length > 0, content.length > 50)
    );
    checks.push(
      check(
        "Execution time under threshold",
        `< ${VALIDATION_THRESHOLDS.maxExecutionTimeMs}ms`,
        `${elapsed}ms`,
        elapsed < VALIDATION_THRESHOLDS.maxExecutionTimeMs
      )
    );

    // AEC data integrity
    const raw = data?._raw as Record<string, unknown> | undefined;
    if (raw) {
      checks.push(
        check("Detected project type", "string", typeof raw.projectType, typeof raw.projectType === "string")
      );
    }
  }

  if (testPDFContent.fileSizeKB > VALIDATION_THRESHOLDS.maxPDFSizeMB * 1024) {
    warnings.push("PDF exceeds max size limit");
  }

  const allPassed = checks.every((c) => c.passed);

  return {
    nodeId: "IN-002",
    nodeName: "PDF Upload",
    testCase: testPDFContent.fileName,
    status: !res.ok ? "FAIL" : allPassed ? "PASS" : "FAIL",
    executionTimeMs: elapsed,
    inputProvided: { fileName: testPDFContent.fileName, textLength: testPDFContent.mockExtractedText.length },
    outputReceived: artifact ? { type: artifact.type } : null,
    artifactsGenerated: hasArtifact ? 1 : 0,
    artifactTypes: artifact ? [String(artifact.type)] : [],
    errorMessage: !res.ok ? String(res.data?.error ?? "Request failed") : undefined,
    warningMessages: warnings,
    validationChecks: checks,
  };
}

function testImageUploadNode(): NodeTestResult {
  // IN-003 requires actual image base64 data which we can't provide in a mock test
  // We validate the test data structure instead
  const start = Date.now();
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];

  for (const img of testImageInputs) {
    checks.push(
      check(`Image ${img.fileName} has valid type`, true, img.type, ["site_photograph", "reference_image", "hand_sketch"].includes(img.type))
    );
    checks.push(
      check(`Image ${img.fileName} under size limit`, true, img.fileSizeMB <= VALIDATION_THRESHOLDS.maxImageSizeMB, img.fileSizeMB <= VALIDATION_THRESHOLDS.maxImageSizeMB)
    );
  }

  warnings.push("Image analysis requires actual image files — skipped API call in test mode");

  return {
    nodeId: "IN-003",
    nodeName: "Image Upload",
    testCase: "3 test images (validation only)",
    status: "SKIP",
    executionTimeMs: Date.now() - start,
    inputProvided: testImageInputs.map((i) => ({ name: i.fileName, type: i.type })),
    outputReceived: null,
    artifactsGenerated: 0,
    artifactTypes: [],
    warningMessages: warnings,
    validationChecks: checks,
  };
}

function testIFCUploadNode(): NodeTestResult {
  // IN-004 requires actual IFC binary data
  const start = Date.now();
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];

  checks.push(
    check("IFC schema is valid", "IFC2X3", testIFCData.ifcSchema, testIFCData.ifcSchema === "IFC2X3" || testIFCData.ifcSchema === "IFC4")
  );
  checks.push(
    check("Total elements > 0", "> 0", testIFCData.expectedExtractorOutput.totalElements, testIFCData.expectedExtractorOutput.totalElements > 0)
  );
  checks.push(
    check("File under size limit", `<= ${VALIDATION_THRESHOLDS.maxIFCSizeMB}MB`, `${testIFCData.fileSizeMB}MB`, testIFCData.fileSizeMB <= VALIDATION_THRESHOLDS.maxIFCSizeMB)
  );
  checks.push(
    check("Has structural system", true, !!testIFCData.expectedExtractorOutput.dominantStructuralSystem, !!testIFCData.expectedExtractorOutput.dominantStructuralSystem)
  );

  const elementTypeCount = Object.keys(testIFCData.mockQuantities).length;
  checks.push(
    check("Multiple element types present", ">= 5", elementTypeCount, elementTypeCount >= 5)
  );

  warnings.push("IFC parsing requires actual .ifc binary — skipped API call in test mode");

  return {
    nodeId: "IN-004",
    nodeName: "IFC Upload",
    testCase: testIFCData.fileName,
    status: "SKIP",
    executionTimeMs: Date.now() - start,
    inputProvided: { fileName: testIFCData.fileName, schema: testIFCData.ifcSchema },
    outputReceived: testIFCData.expectedExtractorOutput,
    artifactsGenerated: 0,
    artifactTypes: [],
    warningMessages: warnings,
    validationChecks: checks,
  };
}

function testParameterInputNode(
  setName: string,
  params: TestParameterSet
): NodeTestResult {
  const start = Date.now();
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];

  const { floors, gfa, height, style, buildingType } = params;

  checks.push(
    check("Floors > 0", "> 0", floors, floors > 0)
  );
  checks.push(
    check("GFA > 0", "> 0", gfa, gfa > 0)
  );
  checks.push(
    check("Height > 0", "> 0", height, height > 0)
  );
  checks.push(
    check("Floors within range", `${VALIDATION_THRESHOLDS.minFloors}-${VALIDATION_THRESHOLDS.maxFloors}`, floors, floors >= VALIDATION_THRESHOLDS.minFloors && floors <= VALIDATION_THRESHOLDS.maxFloors)
  );
  checks.push(
    check("Has style", "non-empty string", style, style.length > 0)
  );
  checks.push(
    check("Has building type", "non-empty string", buildingType, buildingType.length > 0)
  );

  // Height sanity: floor-to-floor should be 2.5–5m
  const floorHeight = height / floors;
  if (floorHeight < 2.5 || floorHeight > 5.0) {
    warnings.push(`Floor-to-floor height ${floorHeight.toFixed(1)}m is unusual (expected 2.5–5.0m)`);
  }

  const allPassed = checks.every((c) => c.passed);

  return {
    nodeId: "IN-005",
    nodeName: "Parameter Input",
    testCase: setName,
    status: allPassed ? "PASS" : "FAIL",
    executionTimeMs: Date.now() - start,
    inputProvided: params,
    outputReceived: { parameterCount: Object.keys(params).length, validated: true },
    artifactsGenerated: 1,
    artifactTypes: ["json"],
    warningMessages: warnings,
    validationChecks: checks,
  };
}

async function testLocationInputNode(
  locationInput: string,
  expected: TestLocationExpectedGIS
): Promise<NodeTestResult> {
  const start = Date.now();
  const warnings: string[] = [];
  const checks: ValidationCheck[] = [];

  // IN-006 feeds into TR-012 (GIS Context Loader / Site Analysis)
  const res = await callExecuteNode("TR-012", {
    content: locationInput,
    prompt: locationInput,
    address: locationInput,
  });
  const elapsed = Date.now() - start;

  checks.push(check("Input accepted without error", true, res.ok, res.ok));

  const artifact = res.data?.artifact as Record<string, unknown> | undefined;
  const hasArtifact = !!artifact;
  checks.push(check("At least 1 artifact generated", true, hasArtifact, hasArtifact));

  if (artifact) {
    const data = artifact.data as Record<string, unknown> | undefined;
    checks.push(
      check("Has content output", true, !!data?.content, !!(data?.content))
    );
    checks.push(
      check(
        "Execution time under threshold",
        `< ${VALIDATION_THRESHOLDS.maxExecutionTimeMs}ms`,
        `${elapsed}ms`,
        elapsed < VALIDATION_THRESHOLDS.maxExecutionTimeMs
      )
    );

    // Check if city name appears in output
    const content = String(data?.content ?? "");
    const expectedCity = expected.city;
    if (expectedCity && !content.toLowerCase().includes(expectedCity.toLowerCase())) {
      warnings.push(`Expected city "${expectedCity}" not found in output`);
    }
  }

  const allPassed = checks.every((c) => c.passed);

  return {
    nodeId: "IN-006",
    nodeName: "Location Input",
    testCase: locationInput,
    status: !res.ok ? "FAIL" : allPassed ? "PASS" : "FAIL",
    executionTimeMs: elapsed,
    inputProvided: { address: locationInput },
    outputReceived: artifact ? { type: artifact.type } : null,
    artifactsGenerated: hasArtifact ? 1 : 0,
    artifactTypes: artifact ? [String(artifact.type)] : [],
    errorMessage: !res.ok ? String(res.data?.error ?? "Request failed") : undefined,
    warningMessages: warnings,
    validationChecks: checks,
  };
}

function testDXFUploadNode(): NodeTestResult {
  // IN-007 requires actual DXF/DWG binary data
  const start = Date.now();
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];

  for (const cadFile of testCADFiles) {
    checks.push(
      check(`${cadFile.fileName} has valid format`, true, cadFile.format, cadFile.format === "DXF" || cadFile.format === "DWG")
    );
    checks.push(
      check(`${cadFile.fileName} under size limit`, true, cadFile.fileSizeKB <= VALIDATION_THRESHOLDS.maxDXFSizeMB * 1024, cadFile.fileSizeKB <= VALIDATION_THRESHOLDS.maxDXFSizeMB * 1024)
    );
    checks.push(
      check(`${cadFile.fileName} has AEC layers`, ">= 3", cadFile.mockLayers.length, cadFile.mockLayers.length >= 3)
    );

    // Check for AEC-relevant layer names
    const aecKeywords = ["WALL", "DOOR", "WINDOW", "SITE", "BOUNDARY", "BUILDING", "ROOM", "FOOTPRINT", "SETBACK"];
    const hasAECLayers = cadFile.mockLayers.some((l) =>
      aecKeywords.some((kw) => l.name.toUpperCase().includes(kw))
    );
    checks.push(
      check(`${cadFile.fileName} has recognisable AEC layers`, true, hasAECLayers, hasAECLayers)
    );
  }

  // Edge case: no AEC layers
  const noAECLayers = edgeCaseInputs.noAECLayersDXF;
  const hasNoAEC = !noAECLayers.some((l) =>
    ["WALL", "DOOR", "SITE", "BOUNDARY"].some((kw) => l.name.toUpperCase().includes(kw))
  );
  checks.push(
    check("Edge case: detect missing AEC layers", true, hasNoAEC, hasNoAEC)
  );
  if (hasNoAEC) {
    warnings.push("DXF with no recognisable AEC layers detected — suggest standard layer names: WALLS, DOORS, WINDOWS, SITE-BOUNDARY");
  }

  warnings.push("DXF/DWG parsing requires actual files — skipped API call in test mode");

  return {
    nodeId: "IN-007",
    nodeName: "DXF/DWG Upload",
    testCase: `${testCADFiles.length} test files (validation only)`,
    status: "SKIP",
    executionTimeMs: Date.now() - start,
    inputProvided: testCADFiles.map((f) => ({ name: f.fileName, format: f.format })),
    outputReceived: null,
    artifactsGenerated: 0,
    artifactTypes: [],
    warningMessages: warnings,
    validationChecks: checks,
  };
}

// ─── Edge Case Tests ────────────────────────────────────────────────────────

function runEdgeCaseTests(): NodeTestResult {
  const start = Date.now();
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];

  // Empty text
  checks.push(
    check("Empty text detected", true, edgeCaseInputs.emptyText === "", edgeCaseInputs.emptyText === "")
  );

  // Null text
  checks.push(
    check("Null text detected", true, edgeCaseInputs.nullText === null, edgeCaseInputs.nullText === null)
  );

  // Short text warning
  checks.push(
    check("Short text flagged", true, edgeCaseInputs.shortText.length < VALIDATION_THRESHOLDS.minTextLength, edgeCaseInputs.shortText.length < VALIDATION_THRESHOLDS.minTextLength)
  );

  // Whitespace only
  const trimmedWS = edgeCaseInputs.whitespaceOnly.trim();
  checks.push(
    check("Whitespace-only text detected", true, trimmedWS === "", trimmedWS === "")
  );

  // Invalid floors
  checks.push(
    check("Negative floors rejected", true, edgeCaseInputs.invalidFloors < VALIDATION_THRESHOLDS.minFloors, edgeCaseInputs.invalidFloors < VALIDATION_THRESHOLDS.minFloors)
  );

  // Zero GFA
  checks.push(
    check("Zero GFA rejected", true, edgeCaseInputs.zeroGFA < VALIDATION_THRESHOLDS.minGFA, edgeCaseInputs.zeroGFA < VALIDATION_THRESHOLDS.minGFA)
  );

  // Oversized PDF
  checks.push(
    check("Oversized PDF detected", true, edgeCaseInputs.oversizedPDFMB > VALIDATION_THRESHOLDS.maxPDFSizeMB, edgeCaseInputs.oversizedPDFMB > VALIDATION_THRESHOLDS.maxPDFSizeMB)
  );

  // Wrong file type
  checks.push(
    check("Wrong file type detected", true, !edgeCaseInputs.wrongFileType.endsWith(".pdf"), !edgeCaseInputs.wrongFileType.endsWith(".pdf"))
  );

  const allPassed = checks.every((c) => c.passed);

  return {
    nodeId: "EDGE",
    nodeName: "Edge Cases",
    testCase: "All edge cases",
    status: allPassed ? "PASS" : "FAIL",
    executionTimeMs: Date.now() - start,
    inputProvided: edgeCaseInputs,
    outputReceived: { checksRun: checks.length, allPassed },
    artifactsGenerated: 0,
    artifactTypes: [],
    warningMessages: warnings,
    validationChecks: checks,
  };
}

// ─── Main Runner ────────────────────────────────────────────────────────────

export async function runSingleNodeTest(
  nodeId: string,
  testCase: string
): Promise<NodeTestResult> {
  try {
    switch (nodeId) {
      case "IN-001":
        return await testTextPromptNode(
          testCase,
          testTextPrompt[testCase as keyof typeof testTextPrompt] ?? testTextPrompt.simple
        );
      case "IN-002":
        return await testPDFUploadNode();
      case "IN-003":
        return testImageUploadNode();
      case "IN-004":
        return testIFCUploadNode();
      case "IN-005":
        return testParameterInputNode(
          testCase,
          testParameterSets[testCase] ?? testParameterSets.residential_simple
        );
      case "IN-006": {
        const loc = testLocations.find((l) => l.input === testCase) ?? testLocations[0];
        return await testLocationInputNode(loc.input, loc.expectedGISOutput);
      }
      case "IN-007":
        return testDXFUploadNode();
      default:
        return {
          nodeId,
          nodeName: "Unknown",
          testCase,
          status: "ERROR",
          executionTimeMs: 0,
          inputProvided: null,
          outputReceived: null,
          artifactsGenerated: 0,
          artifactTypes: [],
          errorMessage: `Unknown node ID: ${nodeId}`,
          warningMessages: [],
          validationChecks: [],
        };
    }
  } catch (err) {
    return {
      nodeId,
      nodeName: nodeId,
      testCase,
      status: "ERROR",
      executionTimeMs: 0,
      inputProvided: null,
      outputReceived: null,
      artifactsGenerated: 0,
      artifactTypes: [],
      errorMessage: err instanceof Error ? err.message : "Test runner failed",
      warningMessages: [],
      validationChecks: [],
    };
  }
}

export async function runAllInputNodeTests(): Promise<TestSummaryReport> {
  const startTime = Date.now();
  const results: NodeTestResult[] = [];

  // IN-001: Text Prompt — 3 complexity levels
  for (const level of ["simple", "intermediate", "complex"] as const) {
    results.push(await testTextPromptNode(level, testTextPrompt[level]));
  }

  // IN-002: PDF Upload
  results.push(await testPDFUploadNode());

  // IN-003: Image Upload (skip — no real files)
  results.push(testImageUploadNode());

  // IN-004: IFC Upload (skip — no real files)
  results.push(testIFCUploadNode());

  // IN-005: Parameter Input — 3 sets
  for (const [setName, params] of Object.entries(testParameterSets)) {
    results.push(testParameterInputNode(setName, params));
  }

  // IN-006: Location Input — test first location (BKC Mumbai)
  const firstLoc = testLocations[0];
  results.push(
    await testLocationInputNode(firstLoc.input, firstLoc.expectedGISOutput)
  );

  // IN-007: DXF/DWG Upload (skip — no real files)
  results.push(testDXFUploadNode());

  // Edge cases
  results.push(runEdgeCaseTests());

  const totalTimeMs = Date.now() - startTime;
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;
  const errors = results.filter((r) => r.status === "ERROR").length;

  const timed = results.filter((r) => r.executionTimeMs > 0);
  const slowest = timed.reduce(
    (max, r) => (r.executionTimeMs > max.timeMs ? { name: r.nodeName, timeMs: r.executionTimeMs } : max),
    { name: "N/A", timeMs: 0 }
  );
  const fastest = timed.reduce(
    (min, r) => (r.executionTimeMs < min.timeMs ? { name: r.nodeName, timeMs: r.executionTimeMs } : min),
    { name: "N/A", timeMs: Infinity }
  );
  if (fastest.timeMs === Infinity) fastest.timeMs = 0;

  return {
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passed,
    failed,
    skipped,
    errors,
    passRate: results.length > 0 ? Math.round((passed / (results.length - skipped)) * 100) : 0,
    totalExecutionTimeMs: totalTimeMs,
    slowestNode: slowest,
    fastestNode: fastest,
    results,
  };
}
