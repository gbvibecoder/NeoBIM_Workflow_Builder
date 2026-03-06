#!/bin/bash

# 🔥 DEVOPS GOAT - Pre-Deployment Verification Script
# Run this before pushing to production

set -e

echo "🔥 Starting Pre-Deployment Verification..."
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Counters
CHECKS_PASSED=0
CHECKS_FAILED=0

check_pass() {
  echo -e "${GREEN}✅ $1${NC}"
  ((CHECKS_PASSED++))
}

check_fail() {
  echo -e "${RED}❌ $1${NC}"
  ((CHECKS_FAILED++))
}

check_warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1. BUILD VERIFICATION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Clean build
echo "🧹 Cleaning previous build..."
rm -rf .next

# Build
echo "🔨 Running production build..."
if npm run build > /dev/null 2>&1; then
  check_pass "Production build successful"
else
  check_fail "Production build failed"
  exit 1
fi

# Check bundle size
STATIC_SIZE=$(du -sh .next/static 2>/dev/null | cut -f1)
SERVER_SIZE=$(du -sh .next/server 2>/dev/null | cut -f1)
echo "   Static: $STATIC_SIZE | Server: $SERVER_SIZE"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2. ENVIRONMENT VARIABLES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check critical env vars (from .env.local, NOT committed)
if [ -f .env.local ]; then
  check_pass ".env.local exists"
  
  # Check for critical vars
  if grep -q "DATABASE_URL=" .env.local; then
    check_pass "DATABASE_URL configured"
  else
    check_fail "DATABASE_URL missing"
  fi

  if grep -q "NEXTAUTH_SECRET=" .env.local; then
    check_pass "NEXTAUTH_SECRET configured"
  else
    check_fail "NEXTAUTH_SECRET missing"
  fi

  if grep -q "UPSTASH_REDIS_REST_URL=" .env.local || grep -q "REDIS_URL=" .env.local; then
    check_pass "Redis configured"
  else
    check_warn "Redis not configured (rate limiting disabled)"
  fi

  if grep -q "OPENAI_API_KEY=" .env.local; then
    check_pass "OpenAI API key configured"
  else
    check_warn "OpenAI API key missing (AI nodes disabled)"
  fi
else
  check_fail ".env.local not found"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3. DATABASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Prisma schema
if [ -f prisma/schema.prisma ]; then
  check_pass "Prisma schema exists"
else
  check_fail "Prisma schema missing"
fi

# Check Prisma Client generation
if [ -d node_modules/@prisma/client ]; then
  check_pass "Prisma Client generated"
else
  check_fail "Prisma Client not generated"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "4. GIT STATUS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for uncommitted changes
if [ -z "$(git status --porcelain)" ]; then
  check_pass "No uncommitted changes"
else
  check_warn "Uncommitted changes detected"
  git status --short
fi

# Check current branch
BRANCH=$(git branch --show-current)
echo "   Branch: $BRANCH"

# Check for untracked critical files
if git ls-files --others --exclude-standard | grep -E '\.(ts|tsx|js|jsx)$' > /dev/null; then
  check_warn "Untracked source files detected"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "5. DEPENDENCIES"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check for known vulnerabilities
echo "🔍 Checking for vulnerabilities (quick scan)..."
if npm audit --omit=dev --audit-level=high 2>&1 | grep -q "0 vulnerabilities"; then
  check_pass "No high/critical vulnerabilities"
else
  check_warn "Vulnerabilities detected (review npm audit)"
fi

# Check for outdated critical packages
echo "📦 Checking critical packages..."
if npm outdated next prisma @prisma/client 2>&1 | grep -q "next"; then
  check_warn "Next.js update available"
else
  check_pass "Next.js up to date"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "6. TYPE SAFETY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# TypeScript check (already done in build, but explicit)
echo "🔍 Verifying TypeScript compilation..."
if npx tsc --noEmit > /dev/null 2>&1; then
  check_pass "TypeScript compilation successful"
else
  check_fail "TypeScript errors detected"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "SUMMARY"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo -e "${GREEN}✅ Checks passed: $CHECKS_PASSED${NC}"
if [ $CHECKS_FAILED -gt 0 ]; then
  echo -e "${RED}❌ Checks failed: $CHECKS_FAILED${NC}"
  echo ""
  echo "⛔ DEPLOYMENT BLOCKED - Fix failing checks before deploying"
  exit 1
else
  echo -e "${YELLOW}⚠️  Warnings: Check above${NC}"
  echo ""
  echo "🚀 Ready to deploy!"
  echo ""
  echo "Next steps:"
  echo "  1. Commit changes: git commit -am 'Ready for production'"
  echo "  2. Push to main: git push origin main"
  echo "  3. Or deploy directly: vercel --prod"
  echo ""
  echo "📋 Don't forget:"
  echo "  - Set Vercel environment variables"
  echo "  - Configure Stripe webhook URL"
  echo "  - Enable Vercel Analytics"
fi

exit 0
