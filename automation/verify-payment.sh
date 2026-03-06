#!/bin/bash
# verify-payment.sh - First Payment Verifier
# Monitors Stripe dashboard for first successful payment

set -e

echo "💰 PAYMENT VERIFIER - $(date)"
echo "======================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ============================================================
# CHECK 1: Stripe Dashboard (requires Stripe CLI)
# ============================================================
echo ""
echo "CHECK 1: Checking Stripe payments..."

if command -v stripe &> /dev/null; then
    # Get recent payments
    PAYMENTS=$(stripe payments list --limit 10 2>/dev/null || echo "error")
    
    if [ "$PAYMENTS" != "error" ]; then
        SUCCESS_COUNT=$(echo "$PAYMENTS" | grep -c "succeeded" || echo "0")
        
        if [ "$SUCCESS_COUNT" -gt 0 ]; then
            echo -e "${GREEN}✅ Found $SUCCESS_COUNT successful payment(s)${NC}"
            
            # Extract latest payment details
            echo ""
            echo "Latest payments:"
            stripe payments list --limit 3
        else
            echo -e "${YELLOW}⏳ No successful payments yet${NC}"
        fi
    else
        echo -e "${RED}❌ Unable to fetch Stripe data${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Stripe CLI not installed${NC}"
    echo "   Install: brew install stripe/stripe-cli/stripe"
fi

# ============================================================
# CHECK 2: Webhook Status (via logs)
# ============================================================
echo ""
echo "CHECK 2: Checking webhook deliveries..."

if command -v stripe &> /dev/null; then
    WEBHOOKS=$(stripe webhook-endpoints list 2>/dev/null || echo "error")
    
    if [ "$WEBHOOKS" != "error" ]; then
        echo -e "${GREEN}✅ Webhook endpoints configured${NC}"
        stripe webhook-endpoints list
    else
        echo -e "${RED}❌ Unable to fetch webhook status${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Stripe CLI required${NC}"
fi

# ============================================================
# CHECK 3: Database User Upgrades
# ============================================================
echo ""
echo "CHECK 3: Checking user subscription upgrades..."

PROD_URL="${NEXT_PUBLIC_APP_URL:-https://workflow-builder.vercel.app}"

# Try to check via API (requires auth)
if curl -s "$PROD_URL/api/health" | grep -q "ok"; then
    echo -e "${GREEN}✅ API responding${NC}"
    echo "   Manual check: Log into dashboard and verify user subscriptions"
else
    echo -e "${YELLOW}⚠️  API not responding${NC}"
fi

# ============================================================
# MONITORING INSTRUCTIONS
# ============================================================
echo ""
echo "======================================="
echo "MANUAL VERIFICATION STEPS:"
echo "======================================="
echo ""
echo "1. Stripe Dashboard:"
echo "   → https://dashboard.stripe.com/payments"
echo ""
echo "2. NeoBIM Dashboard:"
echo "   → $PROD_URL/dashboard"
echo "   → Check user subscription status"
echo ""
echo "3. Webhook Logs:"
echo "   → https://dashboard.stripe.com/webhooks"
echo "   → Verify 'checkout.session.completed' events"
echo ""
echo "4. Database Check:"
echo "   → Run: npx prisma studio"
echo "   → Check User.subscriptionTier field"
echo ""

# ============================================================
# CELEBRATION TRIGGER
# ============================================================
echo ""
echo "CELEBRATION PROTOCOL:"
echo "When first payment confirmed:"
echo "  1. Send team celebration message"
echo "  2. Document customer details (no PII)"
echo "  3. Monitor for support needs"
echo "  4. Update launch metrics"
echo ""

TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN}"
TELEGRAM_CHAT="${TELEGRAM_CHAT_ID}"

if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT" ]; then
    # Check if we should celebrate
    if [ "${SUCCESS_COUNT:-0}" -gt 0 ]; then
        MESSAGE="🎉 *FIRST PAYMENT RECEIVED!*%0A%0A💰 $SUCCESS_COUNT successful payment(s)%0A⏰ $(date)%0A%0A🚀 WE ARE LIVE!%0A%0AAction: Verify in Stripe dashboard"
        
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
            -d "chat_id=$TELEGRAM_CHAT" \
            -d "text=$MESSAGE" \
            -d "parse_mode=Markdown" > /dev/null
        
        echo -e "${GREEN}🎉 Celebration notification sent!${NC}"
    fi
fi

echo ""
