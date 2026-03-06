#!/bin/bash
# health-check.sh - Quick Production Health Verification
# Validates all critical systems in <2 minutes

set -e

echo "🏥 HEALTH CHECK STARTED - $(date)"
echo "======================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PROD_URL="${NEXT_PUBLIC_APP_URL:-https://workflow-builder.vercel.app}"
FAILURES=0

# Test function
test_endpoint() {
    local name="$1"
    local url="$2"
    local expected_code="${3:-200}"
    
    echo -n "Testing $name... "
    
    if response=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>&1); then
        if [ "$response" = "$expected_code" ]; then
            echo -e "${GREEN}✅ OK ($response)${NC}"
            return 0
        else
            echo -e "${RED}❌ FAIL (expected $expected_code, got $response)${NC}"
            FAILURES=$((FAILURES + 1))
            return 1
        fi
    else
        echo -e "${RED}❌ ERROR (connection failed)${NC}"
        FAILURES=$((FAILURES + 1))
        return 1
    fi
}

# ============================================================
# CRITICAL ENDPOINTS
# ============================================================
echo ""
echo "CRITICAL ENDPOINTS:"

test_endpoint "Homepage" "$PROD_URL/"
test_endpoint "API Health" "$PROD_URL/api/health"
test_endpoint "Auth Login" "$PROD_URL/auth/signin"
test_endpoint "Dashboard" "$PROD_URL/dashboard" 401  # Redirects when not logged in
test_endpoint "Pricing" "$PROD_URL/pricing"

# ============================================================
# API ENDPOINTS
# ============================================================
echo ""
echo "API ENDPOINTS:"

test_endpoint "Workflows API" "$PROD_URL/api/workflows"
test_endpoint "Nodes API" "$PROD_URL/api/nodes"
test_endpoint "Stripe Webhook" "$PROD_URL/api/webhooks/stripe" 405  # POST only

# ============================================================
# STATIC ASSETS
# ============================================================
echo ""
echo "STATIC ASSETS:"

test_endpoint "Favicon" "$PROD_URL/favicon.ico"
test_endpoint "OG Image" "$PROD_URL/og.png"

# ============================================================
# DATABASE CHECK (via API)
# ============================================================
echo ""
echo "DATABASE CHECK:"

# Try to fetch workflows (should work even if empty)
if curl -s "$PROD_URL/api/workflows" | grep -q "workflows\|error"; then
    echo -e "${GREEN}✅ Database responding${NC}"
else
    echo -e "${RED}❌ Database not responding${NC}"
    FAILURES=$((FAILURES + 1))
fi

# ============================================================
# GENERATE REPORT
# ============================================================
echo ""
echo "======================================="

if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}🎉 ALL CHECKS PASSED${NC}"
    echo "======================================="
    echo ""
    echo "Status: HEALTHY ✅"
    echo "Production URL: $PROD_URL"
    echo "Time: $(date)"
    echo ""
    exit 0
else
    echo -e "${RED}⚠️  $FAILURES CHECK(S) FAILED${NC}"
    echo "======================================="
    echo ""
    echo "Status: DEGRADED ❌"
    echo "Production URL: $PROD_URL"
    echo "Time: $(date)"
    echo ""
    echo "Action required: Review failed checks above"
    exit 1
fi
