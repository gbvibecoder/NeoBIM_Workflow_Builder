import { Resend } from 'resend';
import {
  welcomeEmail,
  paymentFailedEmail,
  subscriptionCanceledEmail,
  planChangedEmail,
  verificationEmail,
  passwordResetEmail,
} from './email-templates';

// Initialize Resend — uses placeholder during build
const resend = new Resend(process.env.RESEND_API_KEY || 're_placeholder');

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'BuildFlow <noreply@buildflow.app>';

/** Map role enum to display name */
function planDisplayName(role: string): string {
  switch (role) {
    case 'MINI': return 'Mini';
    case 'STARTER': return 'Starter';
    case 'PRO': return 'Pro';
    case 'TEAM_ADMIN': return 'Team';
    default: return 'Free';
  }
}

// ── Core send function ─────────────────────────────────────────────────────────

async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not configured, skipping email to:', to);
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('[email] Resend error:', error);
      return false;
    }

    console.info('[email] Sent:', { to, subject });
    return true;
  } catch (err) {
    console.error('[email] Failed to send:', err);
    return false;
  }
}

// ── Event-specific senders ─────────────────────────────────────────────────────

export async function sendVerificationEmail(email: string, name: string | null, verifyUrl: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Verify your email — BuildFlow',
    html: verificationEmail(name, verifyUrl),
  });
}

export async function sendPasswordResetEmail(email: string, name: string | null, resetUrl: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Reset your password — BuildFlow',
    html: passwordResetEmail(name, resetUrl),
  });
}

export async function sendWelcomeEmail(email: string, name: string | null, role: string): Promise<void> {
  const plan = planDisplayName(role);
  await sendEmail({
    to: email,
    subject: `Welcome to BuildFlow ${plan}! 🏗️`,
    html: welcomeEmail(name, plan),
  });
}

export async function sendPaymentFailedEmail(email: string, name: string | null): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'Action Required: Payment Failed — BuildFlow',
    html: paymentFailedEmail(name),
  });
}

export async function sendSubscriptionCanceledEmail(email: string, name: string | null, role: string): Promise<void> {
  const plan = planDisplayName(role);
  await sendEmail({
    to: email,
    subject: `Your BuildFlow ${plan} subscription has been canceled`,
    html: subscriptionCanceledEmail(name, plan),
  });
}

// ── Inbound lead notification (book-demo, contact forms) ──────────────────────

const TEAM_NOTIFICATION_EMAIL = process.env.TEAM_NOTIFICATION_EMAIL || 'hello@buildflow.app';

export async function sendInboundLeadNotification(data: {
  type: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  role?: string;
  subject?: string;
  message?: string;
}): Promise<void> {
  const rows = [
    `<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;">Name</td><td style="padding:6px 12px;color:#F0F0F5;font-size:13px;">${escapeHtml(data.name)}</td></tr>`,
    `<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;">Email</td><td style="padding:6px 12px;color:#F0F0F5;font-size:13px;"><a href="mailto:${escapeHtml(data.email)}" style="color:#4F8AFF;">${escapeHtml(data.email)}</a></td></tr>`,
  ];
  if (data.phone) rows.push(`<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;">Phone</td><td style="padding:6px 12px;color:#F0F0F5;font-size:13px;">${escapeHtml(data.phone)}</td></tr>`);
  if (data.company) rows.push(`<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;">Company</td><td style="padding:6px 12px;color:#F0F0F5;font-size:13px;">${escapeHtml(data.company)}</td></tr>`);
  if (data.role) rows.push(`<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;">Role</td><td style="padding:6px 12px;color:#F0F0F5;font-size:13px;">${escapeHtml(data.role)}</td></tr>`);
  if (data.subject) rows.push(`<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;">Subject</td><td style="padding:6px 12px;color:#F0F0F5;font-size:13px;">${escapeHtml(data.subject)}</td></tr>`);
  if (data.message) rows.push(`<tr><td style="padding:6px 12px;color:#9898B0;font-size:13px;font-weight:600;" colspan="2">Message</td></tr><tr><td colspan="2" style="padding:6px 12px;color:#F0F0F5;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(data.message)}</td></tr>`);

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#0A0A14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#111120;border-radius:12px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
      <div style="padding:20px 24px;background:linear-gradient(135deg,rgba(79,138,255,0.1),rgba(99,102,241,0.05));border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:16px;font-weight:700;color:#F0F0F5;">New ${escapeHtml(data.type)}</div>
        <div style="font-size:12px;color:#9898B0;margin-top:4px;">${new Date().toUTCString()}</div>
      </div>
      <div style="padding:16px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
      </div>
    </div>
  </body></html>`;

  await sendEmail({
    to: TEAM_NOTIFICATION_EMAIL,
    subject: `[BuildFlow] New ${data.type}: ${data.name} (${data.company || data.email})`,
    html,
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function sendPlanChangedEmail(
  email: string,
  name: string | null,
  oldRole: string,
  newRole: string,
  type: 'upgrade' | 'downgrade',
): Promise<void> {
  const oldPlan = planDisplayName(oldRole);
  const newPlan = planDisplayName(newRole);
  await sendEmail({
    to: email,
    subject: type === 'upgrade'
      ? `Plan upgraded to ${newPlan} — BuildFlow`
      : `Plan changed to ${newPlan} — BuildFlow`,
    html: planChangedEmail(name, oldPlan, newPlan, type),
  });
}
