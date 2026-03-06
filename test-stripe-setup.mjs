#!/usr/bin/env node

/**
 * 🧪 Stripe Setup Verification
 * Checks if all Stripe environment variables are configured
 */

const requiredEnvVars = [
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
  'STRIPE_PRO_PRICE_ID',
  'STRIPE_TEAM_PRICE_ID',
];

console.log('🧪 Stripe Setup Verification\n');

let allConfigured = true;

for (const envVar of requiredEnvVars) {
  const value = process.env[envVar];
  const isPlaceholder = value && (value.includes('placeholder') || value.length < 20);
  const status = value && !isPlaceholder ? '✅' : isPlaceholder ? '⚠️ ' : '❌';
  
  console.log(`${status} ${envVar}: ${value ? (isPlaceholder ? 'PLACEHOLDER - Replace with real value' : 'Configured') : 'Missing'}`);
  
  if (!value || isPlaceholder) {
    allConfigured = false;
  }
}

console.log('\n' + '='.repeat(60));

if (allConfigured) {
  console.log('✅ All Stripe environment variables configured!');
  console.log('\nNext steps:');
  console.log('1. Deploy to Vercel');
  console.log('2. Test checkout flow with test card: 4242 4242 4242 4242');
  console.log('3. Verify webhook events in Stripe Dashboard');
} else {
  console.log('❌ Some environment variables are missing or placeholders');
  console.log('\nRequired actions:');
  console.log('1. Create products in Stripe Dashboard → https://dashboard.stripe.com/test/products');
  console.log('2. Create webhook endpoint → https://dashboard.stripe.com/test/webhooks');
  console.log('3. Update .env.local with real values');
  console.log('4. Redeploy to Vercel');
}

console.log('\n📖 Full guide: See REVENUE_SYSTEM_LIVE.md');
