#!/bin/bash
# generate-status.sh - Status Update Generator
# Aggregates metrics and sends formatted updates to Telegram

set -e

echo "📊 STATUS UPDATE GENERATOR - $(date)"
echo "======================================="

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ============================================================
# CONFIGURATION
# ============================================================
PROD_URL="${NEXT_PUBLIC_APP_URL:-https://workflow-builder.vercel.app}"
AGENT_LOG_DIR="automation/logs/agents"
STATUS_FILE="automation/logs/last-status.json"

mkdir -p "$(dirname "$STATUS_FILE")"

# ============================================================
# COLLECT METRICS
# ============================================================
echo ""
echo "Collecting metrics..."

# 1. Deployment Status
if curl -sf "$PROD_URL/api/health" > /dev/null 2>&1; then
    DEPLOYMENT_STATUS="🟢 LIVE"
else
    DEPLOYMENT_STATUS="🔴 DOWN"
fi

# 2. Agent Completions (from logs)
if [ -d "$AGENT_LOG_DIR" ]; then
    AGENT_LOGS=$(find "$AGENT_LOG_DIR" -name "*.log" -mtime -1 2>/dev/null | wc -l | tr -d ' ')
else
    AGENT_LOGS=0
fi

# 3. Recent Commits (last 24h)
RECENT_COMMITS=$(git log --since="24 hours ago" --oneline 2>/dev/null | wc -l | tr -d ' ')

# 4. Open Issues/PRs (if gh CLI available)
if command -v gh &> /dev/null; then
    OPEN_ISSUES=$(gh issue list --limit 100 2>/dev/null | wc -l | tr -d ' ')
    OPEN_PRS=$(gh pr list --limit 100 2>/dev/null | wc -l | tr -d ' ')
else
    OPEN_ISSUES="N/A"
    OPEN_PRS="N/A"
fi

# 5. Test Coverage (if available)
if [ -f "coverage/coverage-summary.json" ]; then
    COVERAGE=$(grep -o '"lines":{"pct":[0-9.]*' coverage/coverage-summary.json | head -1 | grep -o '[0-9.]*' || echo "N/A")
    if [ "$COVERAGE" != "N/A" ]; then
        TEST_COVERAGE="${COVERAGE}%"
    else
        TEST_COVERAGE="N/A"
    fi
else
    TEST_COVERAGE="N/A"
fi

# 6. Build Status (check if .next exists and is recent)
if [ -d ".next" ]; then
    BUILD_AGE=$(find .next -name "BUILD_ID" -mmin -60 2>/dev/null | wc -l | tr -d ' ')
    if [ "$BUILD_AGE" -gt 0 ]; then
        BUILD_STATUS="🟢 Fresh (<1h)"
    else
        BUILD_STATUS="🟡 Stale (>1h)"
    fi
else
    BUILD_STATUS="🔴 Missing"
fi

# ============================================================
# GENERATE STATUS REPORT
# ============================================================
echo ""
echo "Generating status report..."

cat > "$STATUS_FILE" <<JSONEOF
{
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deployment": "$DEPLOYMENT_STATUS",
  "agentLogs": $AGENT_LOGS,
  "commits24h": $RECENT_COMMITS,
  "openIssues": "$OPEN_ISSUES",
  "openPRs": "$OPEN_PRS",
  "testCoverage": "$TEST_COVERAGE",
  "buildStatus": "$BUILD_STATUS"
}
JSONEOF

# ============================================================
# FORMAT FOR TELEGRAM
# ============================================================
TELEGRAM_MESSAGE="📊 *STATUS UPDATE*%0A%0A"
TELEGRAM_MESSAGE+="🌐 *Deployment:* $DEPLOYMENT_STATUS%0A"
TELEGRAM_MESSAGE+="🤖 *Agent Logs (24h):* $AGENT_LOGS%0A"
TELEGRAM_MESSAGE+="📝 *Commits (24h):* $RECENT_COMMITS%0A"
TELEGRAM_MESSAGE+="🐛 *Open Issues:* $OPEN_ISSUES%0A"
TELEGRAM_MESSAGE+="🔀 *Open PRs:* $OPEN_PRS%0A"
TELEGRAM_MESSAGE+="🏗️  *Build Status:* $BUILD_STATUS%0A"
TELEGRAM_MESSAGE+="%0A⏰ $(date)"

# ============================================================
# SEND TO TELEGRAM
# ============================================================
TELEGRAM_TOKEN="${TELEGRAM_BOT_TOKEN}"
TELEGRAM_CHAT="${TELEGRAM_CHAT_ID}"

if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT" ]; then
    echo ""
    echo "Sending to Telegram..."
    
    if curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_TOKEN/sendMessage" \
        -d "chat_id=$TELEGRAM_CHAT" \
        -d "text=$TELEGRAM_MESSAGE" \
        -d "parse_mode=Markdown" > /dev/null; then
        echo -e "${GREEN}✅ Status update sent to Telegram${NC}"
    else
        echo -e "${RED}❌ Failed to send Telegram message${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Telegram credentials not set${NC}"
    echo "   Set: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"
    echo ""
    echo "Status report saved to: $STATUS_FILE"
fi

# ============================================================
# CONSOLE OUTPUT
# ============================================================
echo ""
echo "======================================="
echo "STATUS SUMMARY"
echo "======================================="
echo ""
echo "Deployment:       $DEPLOYMENT_STATUS"
echo "Agent Logs (24h): $AGENT_LOGS"
echo "Commits (24h):    $RECENT_COMMITS"
echo "Open Issues:      $OPEN_ISSUES"
echo "Open PRs:         $OPEN_PRS"
echo "Test Coverage:    $TEST_COVERAGE"
echo "Build Status:     $BUILD_STATUS"
echo ""
echo "Full report: $STATUS_FILE"
echo ""

# ============================================================
# SCHEDULED RUN (CRON EXAMPLE)
# ============================================================
# To run automatically every 30 minutes during launch day (8 AM - 10 PM):
#
# Add to crontab (run: crontab -e):
# */30 8-22 * * * cd /Users/rutikerole/Projects/NeoBIM\ Workflow\ Builder/workflow_builder && ./automation/generate-status.sh
#
# Or use launchd on macOS (more reliable):
# See: https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/ScheduledJobs.html
