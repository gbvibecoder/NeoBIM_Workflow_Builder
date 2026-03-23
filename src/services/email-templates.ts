/**
 * Transactional email HTML templates for BuildFlow.
 * Minimal, dark-themed, AEC-branded.
 */

const BASE_URL = process.env.NEXTAUTH_URL || 'https://buildflow.app';

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
  const displayName = name || 'there';
  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">Welcome to BuildFlow! 🏗️</h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, thanks for subscribing to the <strong style="color:#4F8AFF;">${plan}</strong> plan.
      You now have access to all the tools you need to build powerful AEC workflows.
    </p>
    <div style="background:rgba(79,138,255,0.06);border:1px solid rgba(79,138,255,0.12);border-radius:12px;padding:20px;margin:20px 0;">
      <div style="font-size:12px;font-weight:700;color:#4F8AFF;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">Quick Start</div>
      <ul style="margin:0;padding:0 0 0 18px;color:#C0C0D0;font-size:13px;line-height:2;">
        <li>Create your first workflow from a template</li>
        <li>Upload an IFC file and run AI analysis</li>
        <li>Generate concept renders and 3D models</li>
        <li>Export reports as PDF, CSV, or IFC</li>
      </ul>
    </div>
    ${button('Go to Dashboard', `${BASE_URL}/dashboard`)}
  `);
}

// ── Payment Failed Email ───────────────────────────────────────────────────────

export function paymentFailedEmail(name: string | null): string {
  const displayName = name || 'there';
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
  const displayName = name || 'there';
  return layout(`
    <h1 style="font-size:24px;font-weight:800;color:#F0F0F5;margin:0 0 8px;">Subscription Canceled</h1>
    <p style="font-size:14px;color:#9898B0;line-height:1.6;margin:0 0 16px;">
      Hey ${displayName}, your <strong style="color:#4F8AFF;">${plan}</strong> subscription has been canceled.
      Your account has been moved to the Free plan.
    </p>
    <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:20px;margin:20px 0;">
      <div style="font-size:12px;font-weight:700;color:#9898B0;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px;">What You Still Get</div>
      <ul style="margin:0;padding:0 0 0 18px;color:#7C7C96;font-size:13px;line-height:2;">
        <li>5 workflow runs per month</li>
        <li>2 workflows</li>
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
  const displayName = name || 'there';
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
  const displayName = name || 'there';
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
  const displayName = name || 'there';
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
