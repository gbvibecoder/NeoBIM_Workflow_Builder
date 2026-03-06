#!/usr/bin/env node
// 🔍 SEO VALIDATION SCRIPT
// Run: node scripts/validate-seo.mjs

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

const checks = {
  passed: [],
  failed: [],
  warnings: [],
};

function pass(message) {
  checks.passed.push(message);
  console.log(`✅ ${message}`);
}

function fail(message) {
  checks.failed.push(message);
  console.log(`❌ ${message}`);
}

function warn(message) {
  checks.warnings.push(message);
  console.log(`⚠️  ${message}`);
}

console.log('🔍 SEO VALIDATION — NeoBIM\n');

// 1. Check robots.txt
const robotsPath = join(projectRoot, 'public', 'robots.txt');
if (existsSync(robotsPath)) {
  const content = await readFile(robotsPath, 'utf-8');
  if (content.includes('Sitemap:')) {
    pass('robots.txt exists with sitemap reference');
  } else {
    warn('robots.txt exists but missing sitemap reference');
  }
} else {
  fail('robots.txt not found');
}

// 2. Check sitemap.ts
const sitemapPath = join(projectRoot, 'src', 'app', 'sitemap.ts');
if (existsSync(sitemapPath)) {
  pass('sitemap.ts exists');
} else {
  fail('sitemap.ts not found');
}

// 3. Check site.webmanifest
const manifestPath = join(projectRoot, 'public', 'site.webmanifest');
if (existsSync(manifestPath)) {
  pass('site.webmanifest exists');
} else {
  warn('site.webmanifest not found (optional but recommended)');
}

// 4. Check layout.tsx for metadata
const layoutPath = join(projectRoot, 'src', 'app', 'layout.tsx');
if (existsSync(layoutPath)) {
  const content = await readFile(layoutPath, 'utf-8');
  
  if (content.includes('export const metadata')) {
    pass('Metadata export found in layout.tsx');
  } else {
    fail('No metadata export in layout.tsx');
  }
  
  if (content.includes('openGraph')) {
    pass('Open Graph tags configured');
  } else {
    fail('Open Graph tags missing');
  }
  
  if (content.includes('twitter')) {
    pass('Twitter Card tags configured');
  } else {
    fail('Twitter Card tags missing');
  }
  
  if (content.includes('application/ld+json')) {
    pass('JSON-LD structured data present');
  } else {
    fail('JSON-LD structured data missing');
  }
  
  if (content.includes('canonical')) {
    pass('Canonical URLs configured');
  } else {
    warn('Canonical URLs not configured');
  }
} else {
  fail('layout.tsx not found');
}

// 5. Check for OG images
const ogImagePath = join(projectRoot, 'public', 'og-image.png');
if (existsSync(ogImagePath)) {
  pass('OG image exists');
} else {
  warn('OG image (og-image.png) not found — CREATE BEFORE LAUNCH');
}

const twitterCardPath = join(projectRoot, 'public', 'twitter-card.png');
if (existsSync(twitterCardPath)) {
  pass('Twitter card image exists');
} else {
  warn('Twitter card image (twitter-card.png) not found — CREATE BEFORE LAUNCH');
}

// 6. Check SEO utility library
const seoLibPath = join(projectRoot, 'src', 'lib', 'seo', 'metadata.ts');
if (existsSync(seoLibPath)) {
  pass('SEO utility library (metadata.ts) exists');
} else {
  warn('SEO utility library not found');
}

// 7. Check favicon
const faviconPath = join(projectRoot, 'public', 'favicon.ico');
if (existsSync(faviconPath)) {
  pass('favicon.ico exists');
} else {
  fail('favicon.ico not found');
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 SEO VALIDATION SUMMARY\n');
console.log(`✅ Passed:   ${checks.passed.length}`);
console.log(`⚠️  Warnings: ${checks.warnings.length}`);
console.log(`❌ Failed:   ${checks.failed.length}`);

const score = Math.round(
  (checks.passed.length / (checks.passed.length + checks.failed.length + checks.warnings.length)) * 100
);

console.log(`\n🎯 SEO Score: ${score}%`);

if (checks.failed.length === 0 && checks.warnings.length <= 3) {
  console.log('\n🚀 READY FOR LAUNCH!\n');
} else if (checks.failed.length === 0) {
  console.log('\n✅ SEO optimized! Address warnings before launch.\n');
} else {
  console.log('\n⚠️  Fix failed checks before launch.\n');
}

// Exit code
process.exit(checks.failed.length > 0 ? 1 : 0);
