#!/usr/bin/env node
/**
 * OG Image Generator for NeoBIM
 * Generates beautiful social preview images for SEO
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, 'public');

// NeoBIM Brand Colors (from landing page)
const COLORS = {
  primary: '#4F8AFF',
  secondary: '#6366F1',
  dark: '#07070D',
  darkAlt: '#0F0F1A',
  text: '#F0F0F5',
  textMuted: '#9898B0',
  beta: '#10B981',
};

/**
 * Generate OG Image (1200x630) - Facebook/LinkedIn
 */
async function generateOGImage() {
  const width = 1200;
  const height = 630;

  // Create SVG with gradient background and text
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Gradient Background -->
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${COLORS.dark};stop-opacity:1" />
          <stop offset="50%" style="stop-color:${COLORS.darkAlt};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${COLORS.dark};stop-opacity:1" />
        </linearGradient>
        
        <!-- Brand Gradient -->
        <linearGradient id="brandGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${COLORS.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${COLORS.secondary};stop-opacity:1" />
        </linearGradient>
        
        <!-- Glow Effect -->
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0%" style="stop-color:${COLORS.primary};stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:${COLORS.primary};stop-opacity:0" />
        </radialGradient>
      </defs>
      
      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#bgGradient)"/>
      
      <!-- Glow circles -->
      <circle cx="200" cy="150" r="300" fill="url(#glow)" opacity="0.4"/>
      <circle cx="1000" cy="500" r="250" fill="url(#glow)" opacity="0.3"/>
      
      <!-- Grid Pattern -->
      <line x1="0" y1="200" x2="${width}" y2="200" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="0" y1="400" x2="${width}" y2="400" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="300" y1="0" x2="300" y2="${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="600" y1="0" x2="600" y2="${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="900" y1="0" x2="900" y2="${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      
      <!-- Logo Icon (Zap/Lightning) -->
      <rect x="80" y="80" width="56" height="56" rx="14" fill="url(#brandGradient)"/>
      <path d="M 102 96 L 118 108 L 108 108 L 114 120 L 98 108 L 108 108 Z" fill="white"/>
      
      <!-- Brand Name -->
      <text x="160" y="120" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="700" fill="${COLORS.text}">
        Neo<tspan fill="${COLORS.primary}">BIM</tspan>
      </text>
      
      <!-- Beta Badge -->
      <rect x="350" y="94" width="68" height="32" rx="16" fill="${COLORS.beta}" opacity="0.15"/>
      <text x="384" y="116" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="${COLORS.beta}" text-anchor="middle">BETA</text>
      
      <!-- Tagline -->
      <text x="80" y="220" font-family="system-ui, -apple-system, sans-serif" font-size="56" font-weight="700" fill="${COLORS.text}">
        <tspan x="80" dy="0">No-Code Workflow</tspan>
        <tspan x="80" dy="68">Builder for AEC</tspan>
      </text>
      
      <!-- Subtext -->
      <text x="80" y="390" font-family="system-ui, -apple-system, sans-serif" font-size="28" font-weight="500" fill="${COLORS.textMuted}">
        <tspan x="80" dy="0">Text → 3D Models → Renders</tspan>
        <tspan x="80" dy="42">in under 30 seconds</tspan>
      </text>
      
      <!-- Feature Pills -->
      <rect x="80" y="510" width="160" height="44" rx="22" fill="rgba(79,138,255,0.12)" stroke="${COLORS.primary}" stroke-width="1"/>
      <text x="160" y="538" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="${COLORS.primary}" text-anchor="middle">⚡ Instant Gen</text>
      
      <rect x="260" y="510" width="180" height="44" rx="22" fill="rgba(99,102,241,0.12)" stroke="${COLORS.secondary}" stroke-width="1"/>
      <text x="350" y="538" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="${COLORS.secondary}" text-anchor="middle">🎨 AI-Powered</text>
      
      <rect x="460" y="510" width="160" height="44" rx="22" fill="rgba(16,185,129,0.12)" stroke="${COLORS.beta}" stroke-width="1"/>
      <text x="540" y="538" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="${COLORS.beta}" text-anchor="middle">📦 No-Code</text>
      
      <!-- Bottom gradient line -->
      <rect x="80" y="590" width="540" height="4" rx="2" fill="url(#brandGradient)"/>
    </svg>
  `;

  const outputPath = join(publicDir, 'og-image.png');
  
  await sharp(Buffer.from(svg))
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(outputPath);
  
  console.log('✅ Generated OG Image (1200x630):', outputPath);
  return outputPath;
}

/**
 * Generate Twitter Card (1200x675) - Twitter
 */
async function generateTwitterCard() {
  const width = 1200;
  const height = 675;

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <!-- Gradient Background -->
        <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${COLORS.dark};stop-opacity:1" />
          <stop offset="50%" style="stop-color:${COLORS.darkAlt};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${COLORS.dark};stop-opacity:1" />
        </linearGradient>
        
        <!-- Brand Gradient -->
        <linearGradient id="brandGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:${COLORS.primary};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${COLORS.secondary};stop-opacity:1" />
        </linearGradient>
        
        <!-- Glow Effect -->
        <radialGradient id="glow" cx="50%" cy="50%">
          <stop offset="0%" style="stop-color:${COLORS.primary};stop-opacity:0.3" />
          <stop offset="100%" style="stop-color:${COLORS.primary};stop-opacity:0" />
        </radialGradient>
      </defs>
      
      <!-- Background -->
      <rect width="${width}" height="${height}" fill="url(#bgGradient)"/>
      
      <!-- Glow circles -->
      <circle cx="200" cy="170" r="320" fill="url(#glow)" opacity="0.4"/>
      <circle cx="1000" cy="530" r="280" fill="url(#glow)" opacity="0.3"/>
      
      <!-- Grid Pattern -->
      <line x1="0" y1="220" x2="${width}" y2="220" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="0" y1="440" x2="${width}" y2="440" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="300" y1="0" x2="300" y2="${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="600" y1="0" x2="600" y2="${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      <line x1="900" y1="0" x2="900" y2="${height}" stroke="rgba(255,255,255,0.03)" stroke-width="1"/>
      
      <!-- Logo Icon (Zap/Lightning) -->
      <rect x="90" y="90" width="60" height="60" rx="15" fill="url(#brandGradient)"/>
      <path d="M 112 106 L 130 120 L 118 120 L 125 134 L 107 120 L 119 120 Z" fill="white"/>
      
      <!-- Brand Name -->
      <text x="175" y="132" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="700" fill="${COLORS.text}">
        Neo<tspan fill="${COLORS.primary}">BIM</tspan>
      </text>
      
      <!-- Beta Badge -->
      <rect x="380" y="102" width="72" height="36" rx="18" fill="${COLORS.beta}" opacity="0.15"/>
      <text x="416" y="127" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="600" fill="${COLORS.beta}" text-anchor="middle">BETA</text>
      
      <!-- Tagline -->
      <text x="90" y="240" font-family="system-ui, -apple-system, sans-serif" font-size="60" font-weight="700" fill="${COLORS.text}">
        <tspan x="90" dy="0">No-Code Workflow</tspan>
        <tspan x="90" dy="72">Builder for AEC</tspan>
      </text>
      
      <!-- Subtext -->
      <text x="90" y="430" font-family="system-ui, -apple-system, sans-serif" font-size="30" font-weight="500" fill="${COLORS.textMuted}">
        <tspan x="90" dy="0">Text → 3D Models → Renders</tspan>
        <tspan x="90" dy="45">in under 30 seconds</tspan>
      </text>
      
      <!-- Feature Pills -->
      <rect x="90" y="565" width="170" height="46" rx="23" fill="rgba(79,138,255,0.12)" stroke="${COLORS.primary}" stroke-width="1"/>
      <text x="175" y="595" font-family="system-ui, -apple-system, sans-serif" font-size="19" font-weight="600" fill="${COLORS.primary}" text-anchor="middle">⚡ Instant Gen</text>
      
      <rect x="280" y="565" width="190" height="46" rx="23" fill="rgba(99,102,241,0.12)" stroke="${COLORS.secondary}" stroke-width="1"/>
      <text x="375" y="595" font-family="system-ui, -apple-system, sans-serif" font-size="19" font-weight="600" fill="${COLORS.secondary}" text-anchor="middle">🎨 AI-Powered</text>
      
      <rect x="490" y="565" width="170" height="46" rx="23" fill="rgba(16,185,129,0.12)" stroke="${COLORS.beta}" stroke-width="1"/>
      <text x="575" y="595" font-family="system-ui, -apple-system, sans-serif" font-size="19" font-weight="600" fill="${COLORS.beta}" text-anchor="middle">📦 No-Code</text>
      
      <!-- Bottom gradient line -->
      <rect x="90" y="640" width="570" height="4" rx="2" fill="url(#brandGradient)"/>
    </svg>
  `;

  const outputPath = join(publicDir, 'twitter-card.png');
  
  await sharp(Buffer.from(svg))
    .png({ quality: 100, compressionLevel: 9 })
    .toFile(outputPath);
  
  console.log('✅ Generated Twitter Card (1200x675):', outputPath);
  return outputPath;
}

/**
 * Main execution
 */
async function main() {
  console.log('🎨 Generating OG Images for NeoBIM...\n');
  
  try {
    const [ogPath, twitterPath] = await Promise.all([
      generateOGImage(),
      generateTwitterCard(),
    ]);
    
    console.log('\n🎉 SUCCESS! Both images generated:');
    console.log('   → OG Image: /public/og-image.png (1200x630px)');
    console.log('   → Twitter Card: /public/twitter-card.png (1200x675px)');
    console.log('\n💡 Add to your Next.js metadata:');
    console.log('   openGraph: { images: ["/og-image.png"] }');
    console.log('   twitter: { images: ["/twitter-card.png"] }');
    
  } catch (error) {
    console.error('❌ Error generating images:', error);
    process.exit(1);
  }
}

main();
