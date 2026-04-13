import { Autosend } from 'autosendjs';
import {
  welcomeEmail,
  paymentFailedEmail,
  subscriptionCanceledEmail,
  planChangedEmail,
  verificationEmail,
  passwordResetEmail,
} from './email-templates';
import { CONTACT_EMAIL } from "@/constants/contact";

// Initialize AutoSend client
const autosend = new Autosend(process.env.AUTOSEND_API_KEY || 'AS_placeholder');

const FROM_EMAIL = process.env.AUTOSEND_FROM_EMAIL || 'noreply@buildflow.app';
const FROM_NAME = process.env.AUTOSEND_FROM_NAME || 'BuildFlow';

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
  if (!process.env.AUTOSEND_API_KEY) {
    console.warn('[email] AUTOSEND_API_KEY not configured, skipping email to:', to);
    return false;
  }

  try {
    await autosend.emails.send({
      from: { email: FROM_EMAIL, name: FROM_NAME },
      to: { email: to },
      subject,
      html,
    });

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
    subject: `Welcome to BuildFlow ${plan}!`,
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

const TEAM_NOTIFICATION_EMAIL = process.env.TEAM_NOTIFICATION_EMAIL || CONTACT_EMAIL;

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

// ── Support Chat Emails ──────────────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://buildflow.app';

function supportEmailWrapper(title: string, body: string): string {
  return `<!DOCTYPE html><html><body style="margin:0;padding:20px;background:#0A0A14;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:0 auto;background:#111120;border-radius:12px;border:1px solid rgba(255,255,255,0.06);overflow:hidden;">
      <div style="padding:20px 24px;background:linear-gradient(135deg,rgba(79,138,255,0.1),rgba(99,102,241,0.05));border-bottom:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:16px;font-weight:700;color:#F0F0F5;">${escapeHtml(title)}</div>
      </div>
      <div style="padding:24px;">${body}</div>
      <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.06);text-align:center;">
        <span style="font-size:11px;color:#6B7280;">BuildFlow — AEC Workflow Automation</span>
      </div>
    </div>
  </body></html>`;
}

export async function sendSupportEscalationEmail(data: {
  userName: string;
  userEmail: string;
  userPlan: string;
  subject: string;
  summary: string;
  conversationId: string;
  firstMessages: Array<{ role: string; content: string }>;
}): Promise<void> {
  const messagesHtml = data.firstMessages
    .map((m) => `<div style="margin-bottom:8px;"><span style="color:${m.role === 'USER' ? '#4F8AFF' : '#34D399'};font-weight:600;font-size:12px;">${escapeHtml(m.role)}:</span> <span style="color:#D1D5DB;font-size:13px;">${escapeHtml(m.content)}</span></div>`)
    .join('');

  const body = `
    <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 16px;">A user has escalated a support conversation.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px;">
      <tr><td style="padding:6px 0;color:#9898B0;font-size:12px;font-weight:600;">User</td><td style="padding:6px 0;color:#F0F0F5;font-size:13px;">${escapeHtml(data.userName)} (${escapeHtml(data.userEmail)})</td></tr>
      <tr><td style="padding:6px 0;color:#9898B0;font-size:12px;font-weight:600;">Plan</td><td style="padding:6px 0;color:#F0F0F5;font-size:13px;">${escapeHtml(data.userPlan)}</td></tr>
      <tr><td style="padding:6px 0;color:#9898B0;font-size:12px;font-weight:600;">Subject</td><td style="padding:6px 0;color:#F0F0F5;font-size:13px;">${escapeHtml(data.subject)}</td></tr>
    </table>
    <div style="background:#0A0A14;border-radius:8px;padding:12px;margin-bottom:16px;">
      <div style="color:#9898B0;font-size:11px;font-weight:600;margin-bottom:8px;">SUMMARY</div>
      <p style="color:#D1D5DB;font-size:13px;line-height:1.5;margin:0;">${escapeHtml(data.summary)}</p>
    </div>
    <div style="background:#0A0A14;border-radius:8px;padding:12px;margin-bottom:16px;">
      <div style="color:#9898B0;font-size:11px;font-weight:600;margin-bottom:8px;">CONVERSATION PREVIEW</div>
      ${messagesHtml}
    </div>
    <a href="${APP_URL}/admin/support?conversation=${data.conversationId}" style="display:inline-block;background:#4F8AFF;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">View in Dashboard</a>`;

  await sendEmail({
    to: TEAM_NOTIFICATION_EMAIL,
    subject: `[BuildFlow Support] Escalation from ${data.userName}: ${data.subject}`,
    html: supportEmailWrapper('Support Escalation', body),
  });
}

export async function sendSupportAdminReplyEmail(data: {
  userName: string;
  userEmail: string;
  replyContent: string;
  conversationId: string;
  subject: string;
}): Promise<void> {
  const body = `
    <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(data.userName)},</p>
    <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 16px;">Our team has replied to your support question: <strong style="color:#F0F0F5;">"${escapeHtml(data.subject)}"</strong></p>
    <div style="background:#0A0A14;border-radius:8px;padding:16px;margin-bottom:16px;border-left:3px solid #4F8AFF;">
      <p style="color:#F0F0F5;font-size:13px;line-height:1.6;margin:0;white-space:pre-wrap;">${escapeHtml(data.replyContent)}</p>
    </div>
    <a href="${APP_URL}/dashboard?support_conversation=${data.conversationId}" style="display:inline-block;background:#4F8AFF;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Continue Conversation</a>
    <p style="color:#6B7280;font-size:12px;line-height:1.5;margin:16px 0 0;">If you have more questions, just reply in the chat.</p>`;

  await sendEmail({
    to: data.userEmail,
    subject: `BuildFlow Support: Reply to "${data.subject}"`,
    html: supportEmailWrapper('Support Reply', body),
  });
}

export async function sendSupportResolvedEmail(data: {
  userName: string;
  userEmail: string;
  subject: string;
  conversationId: string;
}): Promise<void> {
  const body = `
    <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 16px;">Hi ${escapeHtml(data.userName)},</p>
    <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 16px;">Your support question <strong style="color:#F0F0F5;">"${escapeHtml(data.subject)}"</strong> has been resolved.</p>
    <p style="color:#D1D5DB;font-size:14px;line-height:1.6;margin:0 0 16px;">We'd love to hear how we did! Please rate your experience.</p>
    <a href="${APP_URL}/dashboard?support_conversation=${data.conversationId}&rate=true" style="display:inline-block;background:#4F8AFF;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Rate Your Experience</a>
    <p style="color:#6B7280;font-size:12px;line-height:1.5;margin:16px 0 0;">If you need more help, start a new conversation anytime.</p>`;

  await sendEmail({
    to: data.userEmail,
    subject: `Resolved: ${data.subject} — BuildFlow Support`,
    html: supportEmailWrapper('Question Resolved', body),
  });
}
