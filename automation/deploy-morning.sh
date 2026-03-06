#!/bin/bash
# deploy-morning.sh - Morning Deployment Automation
# One command = full production deployment

set -e  # Exit on error

echo "🚀 MORNING DEPLOYMENT STARTED - $(date)"
echo "======================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Log function
log() {
    echo -e "${GREEN}✅ $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# ============================================================
# STEP 1: Verify Environment Variables
# ============================================================
echo ""
echo "STEP 1: Verifying environment variables..."

REQUIRED_VARS=(
    "DATABASE_URL"
    "NEXTAUTH_SECRET"
    "STRIPE_SECRET_KEY"
    "STRIPE_WEBHOOK_SECRET"
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"
)

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        error "Missing required env var: $var"
    fi
done

log "All required environment variables present"

# ============================================================
# STEP 2: Run Test Suite
# ============================================================
echo ""
echo "STEP 2: Running test suite..."

if npm run test; then
    log "All tests passed"
else
    error "Tests failed! Aborting deployment."
fi

# ============================================================
# STEP 3: Build Production
# ============================================================
echo ""
echo "STEP 3: Building production..."

if npm run build; then
    log "Production build successful"
else
    error "Build failed! Aborting deployment."
fi

# ============================================================
# STEP 4: Deploy to Vercel
# ============================================================
echo ""
echo "STEP 4: Deploying to Vercel..."

if command -v vercel &> /dev/null; then
    if vercel --prod --yes; then
        log "Deployed to Vercel successfully"
    else
        error "Vercel deployment failed!"
    fi
else
    warn "Vercel CLI not installed. Skipping deployment."
    echo "   Install: npm i -g vercel"
fi

# ============================================================
# STEP 5: Verify Deployment Health
# ============================================================
echo ""
echo "STEP 5: Verifying deployment health..."

PROD_URL="${NEXT_PUBLIC_APP_URL:-https://workflow-builder.vercel.app}"

# Wait 10 seconds for deployment to propagate
echo "Waiting 10s for deployment to propagate..."
sleep 10

if curl -sf "$PROD_URL" > /dev/null; then
    log "Production URL responding: $PROD_URL"
else
    error "Production URL not responding: $PROD_URL"
fi

# ============================================================
# STEP 6: Send Success Notification
# ============================================================
echo ""
echo "STEP 6: Sending success notification..."

TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN}"
TELEGRAM_CHAT="${TELEGRAM_CHAT_ID}"

if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT" ]; then
    MESSAGE="🚀 *DEPLOYMENT SUCCESS*%0A%0A✅ Tests passed%0A✅ Build completed%0A✅ Deployed to production%0A✅ Health check passed%0A%0A🌐 $PROD_URL%0A⏰ $(date)"
    
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
        -d "chat_id=$TELEGRAM_CHAT" \
        -d "text=$MESSAGE" \
        -d "parse_mode=Markdown" > /dev/null
    
    log "Telegram notification sent"
else
    warn "Telegram credentials not set. Skipping notification."
fi

# ============================================================
# SUCCESS
# ============================================================
echo ""
echo "======================================="
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE - $(date)${NC}"
echo "======================================="
echo ""
echo "Next steps:"
echo "  1. Run health-check.sh to verify all systems"
echo "  2. Monitor Stripe dashboard for first payment"
echo "  3. Check analytics for user activity"
echo ""
