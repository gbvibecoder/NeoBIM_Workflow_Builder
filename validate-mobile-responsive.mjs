#!/usr/bin/env node

/**
 * 📱 MOBILE RESPONSIVE VALIDATION
 * Checks all pages for mobile-ready compliance
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

console.log('📱 MOBILE RESPONSIVE VALIDATION\n');
console.log('═'.repeat(60));

const PAGES = [
  { path: 'src/app/page.tsx', name: 'Landing Page' },
  { path: 'src/app/dashboard/page.tsx', name: 'Dashboard' },
  { path: 'src/app/dashboard/canvas/page.tsx', name: 'Canvas' },
  { path: 'src/app/dashboard/billing/page.tsx', name: 'Billing' },
  { path: 'src/app/(auth)/login/page.tsx', name: 'Login' },
  { path: 'src/app/(auth)/register/page.tsx', name: 'Register' },
];

const checks = {
  hasTailwind: (content) => /className=/.test(content),
  hasResponsiveGrid: (content) => /(grid|flex)/.test(content),
  hasMediaQueries: (content) => /@media/.test(content),
  hasTouchTargets: (content) => /(min-height.*44|h-11|h-12|py-3)/.test(content),
  noFixedWidths: (content) => !/(width:\s*\d+px)(?!.*max-width)/.test(content),
};

let totalPassed = 0;
let totalChecks = 0;

PAGES.forEach(({ path, name }) => {
  console.log(`\n🔍 ${name} (${path})`);
  console.log('─'.repeat(60));
  
  try {
    const content = readFileSync(path, 'utf-8');
    let passed = 0;
    
    Object.entries(checks).forEach(([checkName, checkFn]) => {
      totalChecks++;
      const result = checkFn(content);
      if (result) {
        console.log(`  ✅ ${checkName}`);
        passed++;
        totalPassed++;
      } else {
        console.log(`  ❌ ${checkName}`);
      }
    });
    
    const percentage = Math.round((passed / Object.keys(checks).length) * 100);
    console.log(`  📊 Score: ${passed}/${Object.keys(checks).length} (${percentage}%)`);
    
  } catch (err) {
    console.log(`  ❌ Error reading file: ${err.message}`);
  }
});

// Check for mobile CSS
console.log('\n📄 Global Mobile CSS');
console.log('─'.repeat(60));
try {
  const mobileCss = readFileSync('src/styles/mobile-responsive.css', 'utf-8');
  console.log(`  ✅ Mobile CSS exists (${(mobileCss.length / 1024).toFixed(1)} KB)`);
  console.log(`  ✅ Media queries: ${(mobileCss.match(/@media/g) || []).length}`);
  totalPassed += 2;
  totalChecks += 2;
} catch (err) {
  console.log('  ❌ Mobile CSS not found');
  totalChecks += 2;
}

// Final summary
console.log('\n' + '═'.repeat(60));
console.log('📊 FINAL SCORE');
console.log('═'.repeat(60));
const finalPercentage = Math.round((totalPassed / totalChecks) * 100);
console.log(`Total Checks: ${totalPassed}/${totalChecks} (${finalPercentage}%)`);

if (finalPercentage >= 80) {
  console.log('\n🎉 MOBILE RESPONSIVE: EXCELLENT');
  process.exit(0);
} else if (finalPercentage >= 60) {
  console.log('\n⚠️  MOBILE RESPONSIVE: NEEDS WORK');
  process.exit(1);
} else {
  console.log('\n❌ MOBILE RESPONSIVE: FAILED');
  process.exit(1);
}
