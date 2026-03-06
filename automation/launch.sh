#!/bin/bash
# launch.sh - Master Launch Day Automator
# ONE COMMAND = FULL DEPLOYMENT + MONITORING

set -e

echo "🚀 LAUNCH DAY AUTOMATION - MASTER CONTROL"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

AUTOMATION_DIR="$(cd "$(dirname "$0")" && pwd)"

# ============================================================
# MENU
# ============================================================
show_menu() {
    echo ""
    echo "Select automation mode:"
    echo ""
    echo "  1) 🚀 Full Deploy     - Complete morning deployment"
    echo "  2) 🏥 Health Check    - Verify production status"
    echo "  3) 💰 Payment Monitor - Check Stripe payments"
    echo "  4) 🤖 Deploy Agents   - Spawn 5 task agents"
    echo "  5) 📊 Status Report   - Generate current status"
    echo "  6) 🔥 ALL AT ONCE     - Deploy + Agents + Monitor"
    echo "  7) ⏰ Scheduled Mode  - Status every 30 min"
    echo "  0) Exit"
    echo ""
    echo -n "Choice: "
}

# ============================================================
# FULL DEPLOY
# ============================================================
run_deploy() {
    echo ""
    echo -e "${BLUE}=== RUNNING FULL DEPLOYMENT ===${NC}"
    "$AUTOMATION_DIR/deploy-morning.sh"
}

# ============================================================
# HEALTH CHECK
# ============================================================
run_health() {
    echo ""
    echo -e "${BLUE}=== RUNNING HEALTH CHECK ===${NC}"
    "$AUTOMATION_DIR/health-check.sh"
}

# ============================================================
# PAYMENT MONITOR
# ============================================================
run_payment() {
    echo ""
    echo -e "${BLUE}=== RUNNING PAYMENT MONITOR ===${NC}"
    "$AUTOMATION_DIR/verify-payment.sh"
}

# ============================================================
# DEPLOY AGENTS
# ============================================================
run_agents() {
    echo ""
    echo -e "${BLUE}=== DEPLOYING AGENTS ===${NC}"
    "$AUTOMATION_DIR/deploy-agents.sh"
}

# ============================================================
# STATUS REPORT
# ============================================================
run_status() {
    echo ""
    echo -e "${BLUE}=== GENERATING STATUS ===${NC}"
    "$AUTOMATION_DIR/generate-status.sh"
}

# ============================================================
# ALL AT ONCE (THE NUCLEAR OPTION)
# ============================================================
run_all() {
    echo ""
    echo -e "${BLUE}=== FULL AUTOMATION SEQUENCE ===${NC}"
    echo ""
    
    # Step 1: Deploy
    echo "Step 1/4: Deployment..."
    run_deploy
    echo ""
    
    # Step 2: Health check
    echo "Step 2/4: Health verification..."
    run_health
    echo ""
    
    # Step 3: Deploy agents
    echo "Step 3/4: Agent deployment..."
    run_agents
    echo ""
    
    # Step 4: Initial status
    echo "Step 4/4: Status report..."
    run_status
    echo ""
    
    echo -e "${GREEN}🎉 FULL AUTOMATION COMPLETE${NC}"
    echo ""
    echo "Next steps:"
    echo "  → Monitor Telegram for updates"
    echo "  → Watch Stripe dashboard for payments"
    echo "  → Check agent progress logs"
}

# ============================================================
# SCHEDULED MODE (30-MIN INTERVALS)
# ============================================================
run_scheduled() {
    echo ""
    echo -e "${BLUE}=== SCHEDULED MONITORING MODE ===${NC}"
    echo ""
    echo "Running status updates every 30 minutes..."
    echo "Press Ctrl+C to stop"
    echo ""
    
    ITERATION=1
    
    while true; do
        echo ""
        echo -e "${YELLOW}--- Iteration $ITERATION - $(date) ---${NC}"
        run_status
        
        echo ""
        echo "Next update in 30 minutes..."
        sleep 1800  # 30 minutes
        
        ITERATION=$((ITERATION + 1))
    done
}

# ============================================================
# MAIN LOOP
# ============================================================
while true; do
    show_menu
    read -r choice
    
    case $choice in
        1)
            run_deploy
            ;;
        2)
            run_health
            ;;
        3)
            run_payment
            ;;
        4)
            run_agents
            ;;
        5)
            run_status
            ;;
        6)
            run_all
            ;;
        7)
            run_scheduled
            ;;
        0)
            echo ""
            echo "Exiting. Good luck with launch! 🚀"
            echo ""
            exit 0
            ;;
        *)
            echo ""
            echo -e "${RED}Invalid choice. Try again.${NC}"
            ;;
    esac
    
    echo ""
    echo -e "${GREEN}Press Enter to continue...${NC}"
    read -r
done
