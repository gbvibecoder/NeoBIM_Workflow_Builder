# 🚀 LAUNCH DAY AUTOMATION

**Mission:** Zero manual work at 8 AM. One command = full deployment + monitoring.

---

## 📋 QUICK START

### Option 1: Master Launcher (Recommended)
```bash
./automation/launch.sh
```
Interactive menu with all automation options.

### Option 2: One-Command Full Deploy
```bash
./automation/launch.sh
# Then select: 6) ALL AT ONCE
```

### Option 3: Individual Scripts
```bash
# Morning deployment
./automation/deploy-morning.sh

# Health check
./automation/health-check.sh

# Payment monitor
./automation/verify-payment.sh

# Deploy 5 agents
./automation/deploy-agents.sh

# Status update
./automation/generate-status.sh
```

---

## 🛠️ AUTOMATION SCRIPTS

### 1. `deploy-morning.sh` - Morning Deployment
**What it does:**
- ✅ Verifies all environment variables
- ✅ Runs full test suite
- ✅ Builds production bundle
- ✅ Deploys to Vercel
- ✅ Verifies deployment health
- ✅ Sends success notification to Telegram

**Run:**
```bash
./automation/deploy-morning.sh
```

**Duration:** ~5-10 minutes

**Success criteria:**
- All tests pass
- Build successful
- Deployment live
- Production URL responding

---

### 2. `health-check.sh` - Production Health Check
**What it does:**
- ✅ Tests all critical endpoints (homepage, API, auth, dashboard, pricing)
- ✅ Validates API endpoints (workflows, nodes, Stripe webhook)
- ✅ Checks static assets (favicon, OG image)
- ✅ Verifies database connectivity

**Run:**
```bash
./automation/health-check.sh
```

**Duration:** <2 minutes

**Success criteria:**
- All endpoints return expected status codes
- Database responding
- No connection errors

---

### 3. `verify-payment.sh` - First Payment Verifier
**What it does:**
- 💰 Checks Stripe dashboard for payments
- 💰 Verifies webhook deliveries
- 💰 Confirms user subscription upgrades
- 💰 Sends celebration message on first payment

**Run:**
```bash
./automation/verify-payment.sh
```

**Duration:** <1 minute

**Prerequisites:**
- Stripe CLI installed: `brew install stripe/stripe-cli/stripe`
- Stripe CLI authenticated: `stripe login`

**Success criteria:**
- Stripe data accessible
- Webhooks configured
- Payment events logged

---

### 4. `deploy-agents.sh` - Agent Deployment Automator
**What it does:**
- 🤖 Reads Day 2 task queue
- 🤖 Spawns 5 agents simultaneously
- 🤖 Logs all agent activity
- 🤖 (Future) Rotates agents on completion

**Run:**
```bash
./automation/deploy-agents.sh [TASK_QUEUE_FILE]
```

**Default task queue:** `DAY2_TASK_QUEUE.md`

**Duration:** Instant spawn (agents run async)

**Current mode:** Simulation (creates log files)

**To enable OpenClaw integration:**
1. Set `OPENCLAW_ENABLED=true`
2. Uncomment OpenClaw section in script
3. Use `openclaw subagents list` to monitor

---

### 5. `generate-status.sh` - Status Update Generator
**What it does:**
- 📊 Aggregates deployment status
- 📊 Counts agent logs (24h)
- 📊 Tracks recent commits
- 📊 Lists open issues/PRs
- 📊 Reports test coverage
- 📊 Sends formatted update to Telegram

**Run:**
```bash
./automation/generate-status.sh
```

**Duration:** <30 seconds

**Output:**
- Console summary
- JSON report: `automation/logs/last-status.json`
- Telegram message (if configured)

**For scheduled updates:**
Add to crontab (every 30 min, 8 AM - 10 PM):
```bash
*/30 8-22 * * * cd /path/to/workflow_builder && ./automation/generate-status.sh
```

---

## ⚙️ CONFIGURATION

### Required Environment Variables

**Deployment:**
- `DATABASE_URL` - Neon PostgreSQL connection
- `NEXTAUTH_SECRET` - Auth secret
- `STRIPE_SECRET_KEY` - Stripe API key
- `STRIPE_WEBHOOK_SECRET` - Webhook signature key
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` - Public Stripe key

**Telegram Notifications:**
- `TELEGRAM_BOT_TOKEN` - Bot token from @BotFather
- `TELEGRAM_CHAT_ID` - Chat/channel ID to send updates

**Production URL:**
- `NEXT_PUBLIC_APP_URL` - Production URL (defaults to Vercel)

### Optional Tools

**Vercel CLI:**
```bash
npm i -g vercel
vercel login
```

**Stripe CLI:**
```bash
brew install stripe/stripe-cli/stripe
stripe login
```

**GitHub CLI:**
```bash
brew install gh
gh auth login
```

---

## 📊 LAUNCH DAY WORKFLOW

### 8:00 AM - Start
```bash
# Run master launcher
./automation/launch.sh

# Select: 6) ALL AT ONCE
```

**What happens:**
1. Full deployment (5-10 min)
2. Health verification (<2 min)
3. Agent deployment (instant)
4. Status report (30 sec)
5. Telegram notification sent

**Total time:** ~10 minutes to full production readiness

---

### Throughout Day - Monitor

**Automated (every 30 min):**
```bash
# Run in background terminal
./automation/launch.sh
# Select: 7) Scheduled Mode
```

**Manual (on-demand):**
```bash
# Quick health check
./automation/health-check.sh

# Payment status
./automation/verify-payment.sh

# Current metrics
./automation/generate-status.sh
```

---

### First Payment - Celebrate 🎉

**Automatic:**
- Payment detected → Telegram celebration message sent

**Manual verification:**
1. Stripe Dashboard: https://dashboard.stripe.com/payments
2. NeoBIM Dashboard: Check user subscriptions
3. Database: `npx prisma studio` → User.subscriptionTier

---

## 📁 DIRECTORY STRUCTURE

```
automation/
├── launch.sh              # Master launcher (interactive menu)
├── deploy-morning.sh      # Full deployment pipeline
├── health-check.sh        # Production health verification
├── verify-payment.sh      # Payment monitoring
├── deploy-agents.sh       # Agent orchestration
├── generate-status.sh     # Status updates
└── logs/
    ├── agents/            # Agent activity logs
    └── last-status.json   # Latest status snapshot
```

---

## 🎯 SUCCESS CRITERIA

### Deployment
- ✅ Tests: 100% pass
- ✅ Build: No errors
- ✅ Deploy: Vercel live
- ✅ Health: All endpoints responding

### Monitoring
- ✅ Status updates: Every 30 min
- ✅ Telegram: Notifications sent
- ✅ Metrics: Tracked & logged

### Agents
- ✅ 5 slots: Always full
- ✅ Tasks: From DAY2_TASK_QUEUE.md
- ✅ Logs: Activity recorded

### Payments
- ✅ Stripe: Dashboard accessible
- ✅ Webhooks: Configured & firing
- ✅ Users: Upgraded in database

---

## 🔧 TROUBLESHOOTING

### Deployment fails
```bash
# Check environment variables
./automation/deploy-morning.sh
# Review error output

# Verify .env.local has all required vars
cat .env.local
```

### Health check fails
```bash
# Check specific endpoint
curl -I https://your-app.vercel.app/api/health

# View Vercel logs
vercel logs --prod
```

### Telegram not sending
```bash
# Test Telegram API
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_CHAT_ID" \
  -d "text=Test"

# Verify credentials
echo "Token: $TELEGRAM_BOT_TOKEN"
echo "Chat: $TELEGRAM_CHAT_ID"
```

### Agents not spawning
```bash
# Check task queue exists
cat DAY2_TASK_QUEUE.md

# Verify format (use ## or ### headers)
grep "^##" DAY2_TASK_QUEUE.md

# Enable debug mode
bash -x ./automation/deploy-agents.sh
```

---

## 🚀 LAUNCH DAY CHECKLIST

### Night Before (10 PM)
- [ ] Run full test suite: `npm run test`
- [ ] Review DAY2_TASK_QUEUE.md (50 tasks ready)
- [ ] Set Telegram credentials
- [ ] Verify Stripe webhooks configured
- [ ] Sleep well 😴

### Morning (8:00 AM)
- [ ] Run: `./automation/launch.sh` → Option 6
- [ ] Verify deployment success (Telegram)
- [ ] Start scheduled monitoring (Option 7)
- [ ] Open Stripe dashboard in browser
- [ ] Open analytics dashboard

### Throughout Day
- [ ] Check Telegram every 30 min
- [ ] Monitor first payment
- [ ] Review agent progress
- [ ] Respond to issues immediately

### First Payment
- [ ] 🎉 Celebrate!
- [ ] Document customer (no PII)
- [ ] Monitor for support needs
- [ ] Update launch metrics

---

## 🎖️ STANDARD

**Zero manual work at 8 AM.**
- ✅ One command = full deployment
- ✅ Automated health checks
- ✅ Continuous monitoring
- ✅ Instant notifications

**Confidence = 100%**
- ✅ Tests pass before deploy
- ✅ Health verified after deploy
- ✅ Metrics tracked continuously
- ✅ Payments monitored automatically

**Maximum speed.**
- ✅ Deployment: <10 min
- ✅ Health check: <2 min
- ✅ Status update: <30 sec
- ✅ Agent spawn: Instant

---

## 📝 NOTES

### Future Enhancements
1. **Agent Rotation**: Implement real-time monitoring + auto-rotation
2. **Error Recovery**: Auto-rollback on deployment failure
3. **Analytics Integration**: Real-time user activity tracking
4. **Performance Monitoring**: Vercel speed insights automation
5. **Customer Alerts**: First user, first workflow, first export

### OpenClaw Integration
When ready to use real subagents:
1. Enable in `deploy-agents.sh` (instructions in comments)
2. Use `openclaw spawn` for each task
3. Monitor with `openclaw subagents list`
4. Implement rotation logic (check active count, spawn next)

---

**Built for:** NeoBIM Workflow Builder  
**Purpose:** Launch Day 2 automation  
**Goal:** Zero stress, maximum efficiency, 100% confidence  
**Status:** READY TO LAUNCH 🚀
