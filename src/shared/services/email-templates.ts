/**
 * Transactional email HTML templates for BuildFlow.
 * Minimal, dark-themed, AEC-branded.
 */
import { CONTACT_EMAIL } from "@/constants/contact";

const BASE_URL = process.env.NEXTAUTH_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
  || 'https://trybuildflow.in';

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeName(name: string | null): string {
  return escapeHtml(name || 'there');
}

function layout(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0A0A14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A14;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#111120;border-radius:16px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
        <!-- Header -->
        <tr><td style="padding:32px 40px 0;text-align:center;">
          <div style="font-size:22px;font-weight:800;color:#F0F0F5;letter-spacing:-0.3px;">Build<span style="color:#4F8AFF;">Flow</span></div>
          <div style="font-size:10px;color:#55556A;letter-spacing:2px;margin-top:4px;text-transform:uppercase;">Architecture · Engineering · Construction</div>
        </td></tr>
        <!-- Content -->
        <tr><td style="padding:32px 40px 40px;">
          ${content}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:24px 40px;border-top:1px solid rgba(255,255,255,0.04);text-align:center;">
          <div style="font-size:11px;color:#55556A;line-height:1.5;">
            BuildFlow — No-code AEC Workflow Builder<br>
            <a href="${BASE_URL}/dashboard/billing" style="color:#4F8AFF;text-decoration:none;">Manage subscription</a>
            &nbsp;·&nbsp;
            <a href="${BASE_URL}/dashboard/settings" style="color:#4F8AFF;text-decoration:none;">Settings</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function button(text: string, url: string, color = '#4F8AFF'): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px auto 0;">
    <tr><td style="background:${color};border-radius:10px;padding:14px 32px;">
      <a href="${url}" style="color:#fff;font-size:14px;font-weight:700;text-decoration:none;display:inline-block;">${text}</a>
    </td></tr>
  </table>`;
}

// ── Welcome Email ──────────────────────────────────────────────────────────────

export function welcomeEmail(name: string | null, plan: string): string {
  const displayName = safeName(name);
  return layout(`
    <!-- Hero greeting -->
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#4F8AFF 0%,#6366F1 100%);line-height:64px;text-align:center;font-size:28px;margin-bottom:16px;">
        &#9889;
      </div>
      <h1 style="font-size:26px;font-weight:800;color:#F0F0F5;margin:0 0 6px;letter-spacing:-0.5px;">
        Welcome aboard, ${displayName}!
      </h1>
      <p style="font-size:14px;color:#9898B0;margin:0;">
        You're now on the <strong style="color:#4F8AFF;">${plan}</strong> plan — let's build something extraordinary.
      </p>
    </div>

    <!-- Divider -->
    <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(79,138,255,0.2),transparent);margin:24px 0;"></div>

    <!-- 3-step quickstart -->
    <div style="font-size:11px;font-weight:700;color:#4F8AFF;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:16px;">Get started in 3 steps</div>

    <!-- Step 1 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        <td width="40" valign="top">
          <div style="width:32px;height:32px;border-radius:10px;background:rgba(79,138,255,0.1);border:1px solid rgba(79,138,255,0.2);text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#4F8AFF;">1</div>
        </td>
        <td valign="top" style="padding-left:8px;">
          <div style="font-size:14px;font-weight:700;color:#F0F0F5;margin-bottom:2px;">Create a Workflow</div>
          <div style="font-size:12px;color:#7C7C96;line-height:1.5;">Pick a template or start from scratch — drag &amp; drop nodes onto the canvas.</div>
        </td>
      </tr>
    </table>

    <!-- Step 2 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;">
      <tr>
        <td width="40" valign="top">
          <div style="width:32px;height:32px;border-radius:10px;background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#6366F1;">2</div>
        </td>
        <td valign="top" style="padding-left:8px;">
          <div style="font-size:14px;font-weight:700;color:#F0F0F5;margin-bottom:2px;">Upload &amp; Analyze</div>
          <div style="font-size:12px;color:#7C7C96;line-height:1.5;">Feed in IFC files, floor plans, or images — AI does the heavy lifting.</div>
        </td>
      </tr>
    </table>

    <!-- Step 3 -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td width="40" valign="top">
          <div style="width:32px;height:32px;border-radius:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);text-align:center;line-height:32px;font-size:14px;font-weight:800;color:#10B981;">3</div>
        </td>
        <td valign="top" style="padding-left:8px;">
          <div style="font-size:14px;font-weight:700;color:#F0F0F5;margin-bottom:2px;">Export Deliverables</div>
          <div style="font-size:12px;color:#7C7C96;line-height:1.5;">Generate 3D models, renders, PDF reports, CSV data — all production-ready.</div>
        </td>
      </tr>
    </table>

    <!-- CTA Button -->
    ${button('Open Your Dashboard', `${BASE_URL}/dashboard`)}

    <!-- Plan info badge -->
    <div style="margin-top:28px;text-align:center;">
      <div style="display:inline-block;background:rgba(79,138,255,0.06);border:1px solid rgba(79,138,255,0.15);border-radius:20px;padding:8px 20px;">
        <span style="font-size:11px;color:#7C7C96;">YOUR PLAN</span>
        <span style="font-size:12px;font-weight:700;color:#4F8AFF;margin-left:8px;">${plan}</span>
      </div>
    </div>

    <!-- Support note -->
    <p style="font-size:12px;color:#55556A;text-align:center;line-height:1.5;margin-top:24px;">
      Questions? Just reply to this email — we're here to help.<br>
      Or reach us at <a href="mailto:${CONTACT_EMAIL}" style="color:#4F8AFF;text-decoration:none;">${CONTACT_EMAIL}</a>
    </p>
  `);
}

// ── Payment Failed Email ───────────────────────────────────────────────────────

export function paymentFailedEmail(name: string | null): string {
  const displayName = safeName(name);
  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">Payment Failed</h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, we were unable to process your latest payment.
      Please update your payment method to keep your subscription active.
    </p>
    <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:12px;padding:20px;margin:20px 0;">
      <div style="font-size:13px;color:#EF4444;line-height:1.6;">
        ⚠️ If the payment issue is not resolved within 7 days, your account will be downgraded to the Free plan.
      </div>
    </div>
    ${button('Update Payment Method', `${BASE_URL}/dashboard/billing`, '#EF4444')}
  `);
}

// ── Subscription Canceled Email ────────────────────────────────────────────────

export function subscriptionCanceledEmail(name: string | null, plan: string): string {
  const displayName = safeName(name);
  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">Subscription Canceled</h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, your <strong style="color:#4F8AFF;">${plan}</strong> subscription has been canceled.
      Your account has been moved to the Free plan.
    </p>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;margin:20px 0;">
      <div style="font-size:12px;font-weight:700;color:#9898B0;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">What You Still Get</div>
      <ul style="margin:0;padding:0 0 0 18px;color:#7C7C96;font-size:13px;line-height:2;">
        <li>3 free executions</li>
        <li>3 workflows</li>
        <li>Community templates</li>
        <li>1 concept render</li>
      </ul>
    </div>
    <p style="font-size:13px;color:#7C7C96;line-height:1.6;">
      Your existing workflows and data are safe. You can re-subscribe anytime to regain full access.
    </p>
    ${button('Resubscribe', `${BASE_URL}/dashboard/billing`)}
  `);
}

// ── Email Verification Email ──────────────────────────────────────────────────

export function verificationEmail(name: string | null, verifyUrl: string): string {
  const displayName = safeName(name);
  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">Verify Your Email</h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, thanks for signing up for BuildFlow!
      Please verify your email address to secure your account.
    </p>
    <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.12);border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
      <div style="font-size:12px;color:#10B981;font-weight:600;margin-bottom:4px;">This link expires in 24 hours</div>
    </div>
    ${button('Verify Email Address', verifyUrl, '#10B981')}
    <p style="font-size:12px;color:#55556A;line-height:1.5;margin-top:24px;">
      If you didn't create an account, you can safely ignore this email.
    </p>
  `);
}

// ── Password Reset Email ─────────────────────────────────────────────────────

export function passwordResetEmail(name: string | null, resetUrl: string): string {
  const displayName = safeName(name);
  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">Reset Your Password</h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, we received a request to reset your password.
      Click the button below to choose a new password.
    </p>
    <div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.12);border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
      <div style="font-size:12px;color:#F59E0B;font-weight:600;margin-bottom:4px;">This link expires in 1 hour</div>
    </div>
    ${button('Reset Password', resetUrl, '#4F8AFF')}
    <p style="font-size:12px;color:#55556A;line-height:1.5;margin-top:24px;">
      If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.
    </p>
  `);
}

// ── Plan Changed Email ─────────────────────────────────────────────────────────

export function planChangedEmail(
  name: string | null,
  oldPlan: string,
  newPlan: string,
  type: 'upgrade' | 'downgrade',
): string {
  const displayName = safeName(name);
  const isUpgrade = type === 'upgrade';

  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">
      Plan ${isUpgrade ? 'Upgraded' : 'Changed'}
    </h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, your plan has been ${isUpgrade ? 'upgraded' : 'changed'} from
      <strong style="color:#7C7C96;">${oldPlan}</strong> to
      <strong style="color:#4F8AFF;">${newPlan}</strong>.
      ${isUpgrade
        ? 'Your new features are available immediately.'
        : 'The change will take effect at the end of your current billing period.'}
    </p>
    <div style="background:rgba(79,138,255,0.06);border:1px solid rgba(79,138,255,0.12);border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
      <div style="display:inline-block;padding:8px 20px;border-radius:8px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);">
        <span style="font-size:14px;color:#7C7C96;">${oldPlan}</span>
        <span style="font-size:18px;color:#4F8AFF;margin:0 12px;">→</span>
        <span style="font-size:14px;font-weight:700;color:#4F8AFF;">${newPlan}</span>
      </div>
    </div>
    ${button('View Your Plan', `${BASE_URL}/dashboard/billing`)}
  `);
}

// ── Demo Request Confirmation (user-facing) ────────────────────────────────
//
// Fires from /api/book-demo right after the team notification. Confirms the
// submission landed, sets expectation on response time, and gives the user a
// direct reply-to so they can add context or reschedule without re-submitting.

export function demoRequestConfirmationEmail(data: {
  name: string;
  company?: string;
  role?: string;
  message?: string;
}): string {
  const displayName = safeName(data.name);
  const companyLine = data.company
    ? `<tr><td style="padding:6px 0;color:#7C7C96;font-size:12px;width:120px;">Company</td><td style="padding:6px 0;color:#F0F0F5;font-size:13px;">${escapeHtml(data.company)}</td></tr>`
    : '';
  const roleLine = data.role
    ? `<tr><td style="padding:6px 0;color:#7C7C96;font-size:12px;width:120px;">Role</td><td style="padding:6px 0;color:#F0F0F5;font-size:13px;">${escapeHtml(data.role)}</td></tr>`
    : '';
  const messageBlock = data.message
    ? `<div style="background:rgba(79,138,255,0.04);border:1px solid rgba(79,138,255,0.1);border-radius:10px;padding:14px 16px;margin:16px 0;">
         <div style="font-size:10px;font-weight:700;color:#4F8AFF;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">What you're looking to solve</div>
         <div style="font-size:13px;color:#D0D0DC;line-height:1.6;white-space:pre-wrap;">${escapeHtml(data.message)}</div>
       </div>`
    : '';

  return layout(`
    <!-- Hero -->
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,#4F8AFF 0%,#6366F1 100%);line-height:64px;text-align:center;font-size:30px;margin-bottom:16px;">
        &#128197;
      </div>
      <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;letter-spacing:-0.4px;">
        Got it, ${displayName} — your demo is queued
      </h1>
      <p style="font-size:14px;color:#9898B0;margin:0;line-height:1.55;">
        Thanks for reaching out. One of us will personally review your request and
        email you back within <strong style="color:#F0F0F5;">24 hours</strong> with
        a calendar invite for a 20–30 minute walkthrough tailored to your practice.
      </p>
    </div>

    <!-- Divider -->
    <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(79,138,255,0.2),transparent);margin:24px 0;"></div>

    <!-- What we'll cover -->
    <div style="font-size:11px;font-weight:700;color:#4F8AFF;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:14px;">What we'll cover</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
      <tr><td width="28" valign="top" style="padding-bottom:10px;"><div style="width:20px;height:20px;border-radius:6px;background:rgba(0,245,255,0.1);border:1px solid rgba(0,245,255,0.2);text-align:center;line-height:20px;font-size:11px;font-weight:800;color:#00F5FF;">1</div></td>
          <td valign="top" style="padding:0 0 10px 10px;font-size:13px;color:#D0D0DC;line-height:1.55;"><strong style="color:#F0F0F5;">Your workflow today</strong> — where time is lost on briefs, renders, BOQs.</td></tr>
      <tr><td width="28" valign="top" style="padding-bottom:10px;"><div style="width:20px;height:20px;border-radius:6px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.2);text-align:center;line-height:20px;font-size:11px;font-weight:800;color:#8B5CF6;">2</div></td>
          <td valign="top" style="padding:0 0 10px 10px;font-size:13px;color:#D0D0DC;line-height:1.55;"><strong style="color:#F0F0F5;">Live platform walkthrough</strong> — text prompt → 3D model → IFC → BOQ.</td></tr>
      <tr><td width="28" valign="top" style="padding-bottom:10px;"><div style="width:20px;height:20px;border-radius:6px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);text-align:center;line-height:20px;font-size:11px;font-weight:800;color:#10B981;">3</div></td>
          <td valign="top" style="padding:0 0 10px 10px;font-size:13px;color:#D0D0DC;line-height:1.55;"><strong style="color:#F0F0F5;">Fit for your practice</strong> — which workflows to start with, pricing, onboarding.</td></tr>
    </table>

    <!-- Submission summary -->
    <div style="background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.04);border-radius:10px;padding:14px 16px;margin:20px 0;">
      <div style="font-size:10px;font-weight:700;color:#7C7C96;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Your submission</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:6px 0;color:#7C7C96;font-size:12px;width:120px;">Name</td><td style="padding:6px 0;color:#F0F0F5;font-size:13px;">${displayName}</td></tr>
        ${companyLine}
        ${roleLine}
      </table>
    </div>

    ${messageBlock}

    <!-- Secondary CTA: explore while you wait -->
    <div style="text-align:center;margin-top:24px;">
      <p style="font-size:12px;color:#7C7C96;margin:0 0 12px;line-height:1.5;">
        While you wait, poke around the dashboard — no commitment needed.
      </p>
      ${button('Open Dashboard →', `${BASE_URL}/dashboard`)}
    </div>

    <!-- Reply-to line -->
    <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.04);text-align:center;">
      <p style="font-size:12px;color:#7C7C96;line-height:1.55;margin:0;">
        Need to reschedule or add context? Just reply to this email or write to
        <a href="mailto:${CONTACT_EMAIL}" style="color:#4F8AFF;text-decoration:none;">${CONTACT_EMAIL}</a>.
      </p>
    </div>
  `);
}
