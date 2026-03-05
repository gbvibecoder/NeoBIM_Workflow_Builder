#!/usr/bin/env node
/**
 * API FIXES END-TO-END TEST
 * Tests all 5 real nodes with real APIs + error scenarios
 */

console.log("🔥 API FIXES E2E TEST\n");

const BASE_URL = "http://localhost:3000";

// Test scenarios
const tests = [
  {
    name: "TR-003: Valid prompt",
    catalogueId: "TR-003",
    inputData: { prompt: "7-story mixed-use building in Berlin, Germany" },
    expectedPass: true,
  },
  {
    name: "TR-003: Prompt too short (validation error)",
    catalogueId: "TR-003",
    inputData: { prompt: "test" },
    expectedPass: false,
    expectedError: "VAL_002", // PROMPT_TOO_SHORT
  },
  {
    name: "TR-003: Prompt too long (validation error)",
    catalogueId: "TR-003",
    inputData: { prompt: "x".repeat(600) },
    expectedPass: false,
    expectedError: "VAL_003", // PROMPT_TOO_LONG
  },
  {
    name: "GN-003: Valid description",
    catalogueId: "GN-003",
    inputData: {
      _raw: {
        projectName: "Berlin Mixed-Use Tower",
        buildingType: "Mixed-Use",
        floors: 7,
        totalArea: 5600,
        structure: "Reinforced concrete",
        facade: "Glass curtain wall",
        sustainabilityFeatures: ["Green roof"],
        programSummary: "Mixed-use with retail and office",
        estimatedCost: "$15M",
        constructionDuration: "18 months",
      },
      prompt: "Modern 7-story building",
    },
    expectedPass: true,
  },
  {
    name: "GN-003: Missing input (validation error)",
    catalogueId: "GN-003",
    inputData: null,
    expectedPass: false,
    expectedError: "VAL_004", // MISSING_REQUIRED_FIELD
  },
  {
    name: "TR-007: With fallback (no IFC)",
    catalogueId: "TR-007",
    inputData: {},
    expectedPass: true,
    expectWarning: true,
  },
  {
    name: "TR-008: Valid elements",
    catalogueId: "TR-008",
    inputData: {
      _elements: [
        { description: "External Walls", category: "Walls", quantity: 1240, unit: "m²" },
        { description: "Floor Slabs", category: "Slabs", quantity: 2400, unit: "m²" },
      ],
      region: "Berlin, Germany",
    },
    expectedPass: true,
  },
  {
    name: "TR-008: Missing elements (validation error)",
    catalogueId: "TR-008",
    inputData: {},
    expectedPass: false,
    expectedError: "VAL_004", // MISSING_REQUIRED_FIELD
  },
  {
    name: "EX-002: Valid BOQ data",
    catalogueId: "EX-002",
    inputData: {
      headers: ["Description", "Unit", "Qty", "Rate", "Total"],
      rows: [
        ["External Walls", "m²", "1240", "$50", "$62,000"],
        ["Floor Slabs", "m²", "2400", "$80", "$192,000"],
      ],
    },
    expectedPass: true,
  },
  {
    name: "EX-002: Missing rows (validation error)",
    catalogueId: "EX-002",
    inputData: { headers: ["Test"] },
    expectedPass: false,
    expectedError: "VAL_004", // MISSING_REQUIRED_FIELD
  },
];

// Mock session token (for local testing with dev server)
// In real testing, you'd need a valid session cookie
const mockSession = "test-session-token";

async function runTest(test) {
  console.log(`\n🧪 ${test.name}`);
  
  try {
    const res = await fetch(`${BASE_URL}/api/execute-node`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Note: In real testing, you'd need valid auth
      },
      body: JSON.stringify({
        catalogueId: test.catalogueId,
        executionId: "test-" + Date.now(),
        tileInstanceId: "test-tile",
        inputData: test.inputData,
      }),
    });

    const data = await res.json();

    if (test.expectedPass) {
      if (res.ok) {
        console.log(`✅ PASS: Request succeeded`);
        
        // Check for warnings
        if (test.expectWarning && data.artifact?.metadata?.warnings) {
          console.log(`⚠️  Warning detected (expected):`, data.artifact.metadata.warnings[0]);
        }
        
        return true;
      } else {
        console.log(`❌ FAIL: Expected success, got error:`, data.error?.message || data.error);
        return false;
      }
    } else {
      // Expected to fail
      if (!res.ok) {
        const errorCode = data.error?.code;
        if (test.expectedError && errorCode === test.expectedError) {
          console.log(`✅ PASS: Got expected error ${errorCode}`);
          console.log(`   Message: "${data.error.message}"`);
          return true;
        } else {
          console.log(`❌ FAIL: Expected error ${test.expectedError}, got ${errorCode}`);
          console.log(`   Message: "${data.error?.message}"`);
          return false;
        }
      } else {
        console.log(`❌ FAIL: Expected error, but request succeeded`);
        return false;
      }
    }
  } catch (error) {
    console.log(`❌ FAIL: Request threw error:`, error.message);
    return false;
  }
}

async function main() {
  console.log("Testing validation + error handling improvements\n");
  console.log("⚠️  NOTE: This requires dev server running on localhost:3000");
  console.log("⚠️  NOTE: Authentication required - run this in a logged-in browser context or mock auth\n");

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    const result = await runTest(test);
    if (result) {
      passed++;
    } else {
      failed++;
    }
    
    // Small delay between tests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n" + "=".repeat(60));
  console.log(`📊 TEST SUMMARY`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📈 Success Rate: ${((passed / tests.length) * 100).toFixed(1)}%`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\n⚠️  Some tests failed. Review errors above.");
    process.exit(1);
  } else {
    console.log("\n🎉 All tests passed!");
    process.exit(0);
  }
}

main().catch(console.error);
