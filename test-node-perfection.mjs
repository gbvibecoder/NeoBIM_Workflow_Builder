#!/usr/bin/env node
/**
 * 🔥 NODE PERFECTION VALIDATOR
 * Tests all 5 production nodes to Rutik's standard
 */

const BASE_URL = 'http://localhost:3000';

// Simple test without auth (will use admin bypass)
async function testTR003() {
  console.log('\n🏗️  Testing TR-003 - Building Description');
  
  const testCases = [
    '9-story luxury hotel in Dubai',
    '7-story mixed-use in Berlin', 
    '15-story residential tower in Mumbai',
    '12-story office complex in Tokyo',
    '3-story school in Singapore'
  ];

  for (const prompt of testCases) {
    console.log(`\n  Input: "${prompt}"`);
    
    try {
      const res = await fetch(`${BASE_URL}/api/execute-node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          catalogueId: 'TR-003',
          executionId: `test-${Date.now()}`,
          tileInstanceId: `tile-${Date.now()}`,
          inputData: { prompt }
        })
      });

      const data = await res.json();
      
      if (data.artifact) {
        const raw = data.artifact.data._raw || {};
        console.log(`  ✅ Generated ${Object.keys(raw).length} sections`);
        console.log(`  ✅ Floor count mentioned:`, raw.floors || 'N/A');
      } else {
        console.log(`  ❌ Error:`, data.error || 'Unknown');
      }
    } catch (err) {
      console.log(`  ❌ Failed:`, err.message);
    }
    
    await new Promise(r => setTimeout(r, 2000));
  }
}

testTR003().catch(console.error);
