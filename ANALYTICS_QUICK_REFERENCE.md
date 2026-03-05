# 📊 ANALYTICS QUICK REFERENCE

## 🚀 Daily Commands

### Generate Report
```bash
cd "/Users/rutikerole/Projects/NeoBIM Workflow Builder/workflow_builder"
node scripts/daily-report.mjs
```

### Send Report to Telegram
```bash
node scripts/daily-report.mjs --send-telegram
```

### View Dashboard
Open browser → `/dashboard/analytics` (admin only)

---

## 📈 What's Tracked

| Event | When | Properties |
|-------|------|------------|
| `user_signup` | Registration | source (PH/Reddit/etc) |
| `user_login` | Login | - |
| `workflow_created` | New workflow | workflowId |
| `workflow_first_created` | 1st workflow (milestone) | workflowId |
| `execution_started` | Run workflow | executionId |
| `execution_first_run` | 1st run (milestone) | executionId |
| `rate_limit_free_tier` | Hit 3-run limit | endpoint, userRole |
| `upgrade_clicked` | Click upgrade button | location |
| `payment_completed` | Successful payment | amount, plan |

---

## 💻 Code Examples

### Track Custom Event
```typescript
import { trackEvent } from "@/lib/analytics";

await trackEvent({
  userId: user.id,
  eventName: "template_viewed",
  properties: { templateId: "abc123" },
  source: "producthunt", // optional
});
```

### Track Signup with Source
```typescript
import { trackSignup } from "@/lib/analytics";

// Get source from query param or referer
const source = req.query.ref || "organic";
await trackSignup(user.id, source);
```

### Track Payment
```typescript
import { trackPaymentCompleted } from "@/lib/analytics";

await trackPaymentCompleted(user.id, 79, "PRO");
```

---

## 📊 Metrics Explained

### Signups Today
New user registrations since midnight (your timezone)

### Active Users (7-day)
Users who have logged in or updated profile in last 7 days

### Total Workflows
All workflows created (including deleted)

### Total Executions
All workflow runs (including failed)

### Revenue (MRR)
Monthly Recurring Revenue = `paid_users * avg_price`  
Currently: `PRO_count * $79 + TEAM_count * $149`

### Conversion Rate
`(paid_users / total_users) * 100`

### Top Sources
Traffic sources ranked by signup count (from event logs)

---

## 🔧 Troubleshooting

### No data in dashboard?
- Check: `analytics-logs/events-YYYY-MM-DD.jsonl` exists
- Verify: Events are being written (check file size)
- Test: Signup a new user and check logs

### Report script fails?
- Ensure: `.env.local` has `DATABASE_URL`
- Run: `npx prisma generate`
- Check: Node version >= 18

### Dashboard shows 401?
- Login as admin user
- Or remove auth check in `/api/analytics/route.ts`

### Events not logging?
- Check: `src/lib/analytics.ts` is imported
- Verify: `trackEvent()` is called (check console in dev mode)
- Look for: "📊 Analytics Event:" in console logs

---

## 🎯 Key Files

| File | Purpose |
|------|---------|
| `src/lib/analytics.ts` | Core tracking library |
| `src/app/api/analytics/route.ts` | Metrics API endpoint |
| `src/app/dashboard/analytics/page.tsx` | Dashboard UI |
| `scripts/daily-report.mjs` | Report automation |
| `analytics-logs/*.jsonl` | Event storage |
| `reports/*.txt` | Generated reports |

---

## 📅 Automation Setup

### Cron Job (10 PM IST Daily)
```bash
# Edit crontab
crontab -e

# Add this line (adjust path):
0 22 * * * cd /Users/rutikerole/Projects/NeoBIM\ Workflow\ Builder/workflow_builder && node scripts/daily-report.mjs --send-telegram >> /tmp/analytics-cron.log 2>&1
```

### Vercel Cron (Alternative)
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/daily-report",
    "schedule": "0 22 * * *"
  }]
}
```

Then create: `src/app/api/cron/daily-report/route.ts`

---

## 🔥 War Mode Checklist

- [x] Event tracking implemented
- [x] Vercel Analytics enabled
- [x] Dashboard live
- [x] Daily reports working
- [x] First baseline captured
- [ ] Cron job scheduled
- [ ] Telegram bot configured
- [ ] First 10 signups tracked
- [ ] First paid conversion tracked

---

**MEASURE EVERYTHING. WIN THE HACKATHON.** 🏆
