# 🚀 LAUNCH DAY AUTOMATION - QUICK REFERENCE

## ONE-LINER LAUNCH

```bash
./automation/launch.sh
```
Then select: **6) ALL AT ONCE**

---

## WHAT IT DOES

1. **Deploy** - Tests → Build → Vercel → Health check (10 min)
2. **Agents** - Spawn 5 task agents from queue (instant)
3. **Monitor** - Status updates every 30 min (continuous)
4. **Notify** - Telegram alerts for all events (automatic)

---

## INDIVIDUAL COMMANDS

```bash
# Morning deployment
./automation/deploy-morning.sh

# Quick health check
./automation/health-check.sh

# Check payments
./automation/verify-payment.sh

# Deploy agents
./automation/deploy-agents.sh

# Status report
./automation/generate-status.sh
```

---

## REQUIRED ENV VARS

```bash
# Deployment
DATABASE_URL
NEXTAUTH_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY

# Notifications
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

---

## 8 AM CHECKLIST

- [ ] Run `./automation/launch.sh` → Option 6
- [ ] Verify Telegram success message
- [ ] Start scheduled monitoring (Option 7)
- [ ] Open Stripe dashboard
- [ ] Monitor for first payment

---

## TROUBLESHOOTING

**Deployment fails?**
→ Check env vars, run `npm run test`, review logs

**Health check fails?**
→ Check Vercel deployment, test endpoints manually

**No Telegram?**
→ Verify `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`

**Agents not working?**
→ Ensure `DAY2_TASK_QUEUE.md` exists with `##` headers

---

## SUCCESS = ZERO MANUAL WORK

One command at 8 AM. Everything else is automated.

**Full docs:** `LAUNCH_DAY_AUTOMATION.md`
