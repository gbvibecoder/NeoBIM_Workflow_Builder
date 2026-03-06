#!/bin/bash

echo "🚀 NeoBIM Pre-Flight Checklist"
echo "=============================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASSED=0
FAILED=0
WARNINGS=0

# Function to check
check() {
  if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ $1${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ $1${NC}"
    ((FAILED++))
  fi
}

warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
  ((WARNINGS++))
}

echo "1️⃣ Checking Production URL..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" https://neo-bim-workflow-builder.vercel.app)
if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ Production URL accessible (200 OK)${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Production URL failed (HTTP $HTTP_CODE)${NC}"
  ((FAILED++))
fi

echo ""
echo "2️⃣ Checking Build..."
if npm run build > /dev/null 2>&1; then
  echo -e "${GREEN}✅ Build passes${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Build fails${NC}"
  ((FAILED++))
fi

echo ""
echo "3️⃣ Checking TypeScript..."
if npx tsc --noEmit > /dev/null 2>&1; then
  echo -e "${GREEN}✅ No TypeScript errors${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ TypeScript errors found${NC}"
  ((FAILED++))
fi

echo ""
echo "4️⃣ Checking for hardcoded secrets..."
if ! grep -r "sk_test_" src/ > /dev/null 2>&1; then
  echo -e "${GREEN}✅ No test API keys in code${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Test API keys found in code!${NC}"
  ((FAILED++))
fi

if ! grep -r "sk_live_" src/ > /dev/null 2>&1; then
  echo -e "${GREEN}✅ No live API keys in code${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ Live API keys found in code!${NC}"
  ((FAILED++))
fi

echo ""
echo "5️⃣ Checking Security Headers..."
if curl -s -I https://neo-bim-workflow-builder.vercel.app | grep -q "X-Frame-Options"; then
  echo -e "${GREEN}✅ X-Frame-Options header present${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ X-Frame-Options header missing${NC}"
  ((FAILED++))
fi

if curl -s -I https://neo-bim-workflow-builder.vercel.app | grep -q "Content-Security-Policy"; then
  echo -e "${GREEN}✅ CSP header present${NC}"
  ((PASSED++))
else
  echo -e "${RED}❌ CSP header missing${NC}"
  ((FAILED++))
fi

echo ""
echo "6️⃣ Checking HTTPS..."
HTTP_REDIRECT=$(curl -s -o /dev/null -w "%{http_code}" http://neo-bim-workflow-builder.vercel.app)
if [ "$HTTP_REDIRECT" = "301" ] || [ "$HTTP_REDIRECT" = "308" ]; then
  echo -e "${GREEN}✅ HTTP → HTTPS redirect works${NC}"
  ((PASSED++))
else
  echo -e "${YELLOW}⚠️  HTTP redirect may not be configured (HTTP $HTTP_REDIRECT)${NC}"
  ((WARNINGS++))
fi

echo ""
echo "7️⃣ Checking Environment Variables..."
if [ -f ".env.local" ]; then
  echo -e "${GREEN}✅ .env.local file exists${NC}"
  ((PASSED++))
  
  # Check for critical env vars
  if grep -q "DATABASE_URL" .env.local; then
    echo -e "${GREEN}✅ DATABASE_URL present${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ DATABASE_URL missing${NC}"
    ((FAILED++))
  fi
  
  if grep -q "NEXTAUTH_SECRET" .env.local; then
    echo -e "${GREEN}✅ NEXTAUTH_SECRET present${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ NEXTAUTH_SECRET missing${NC}"
    ((FAILED++))
  fi
  
  if grep -q "OPENAI_API_KEY" .env.local; then
    echo -e "${GREEN}✅ OPENAI_API_KEY present${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ OPENAI_API_KEY missing${NC}"
    ((FAILED++))
  fi
  
  if grep -q "STRIPE_SECRET_KEY" .env.local; then
    echo -e "${GREEN}✅ STRIPE_SECRET_KEY present${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ STRIPE_SECRET_KEY missing${NC}"
    ((FAILED++))
  fi
  
  if grep -q "ADMIN_EMAILS" .env.local; then
    echo -e "${GREEN}✅ ADMIN_EMAILS present${NC}"
    ((PASSED++))
  else
    echo -e "${RED}❌ ADMIN_EMAILS missing (NEW REQUIREMENT!)${NC}"
    ((FAILED++))
  fi
else
  echo -e "${RED}❌ .env.local file not found${NC}"
  ((FAILED++))
fi

echo ""
echo "=============================="
echo "📊 RESULTS"
echo "=============================="
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo -e "${YELLOW}⚠️  Warnings: $WARNINGS${NC}"
echo ""

TOTAL=$((PASSED + FAILED))
if [ $TOTAL -gt 0 ]; then
  PERCENTAGE=$((PASSED * 100 / TOTAL))
  echo "Confidence Score: $PERCENTAGE%"
  echo ""
fi

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}🚀 READY TO LAUNCH${NC}"
  echo "All critical checks passed!"
  exit 0
else
  echo -e "${RED}🛑 FIX FAILURES BEFORE LAUNCH${NC}"
  echo "Please resolve the failed checks above."
  exit 1
fi
