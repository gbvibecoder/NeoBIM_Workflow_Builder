import { Autosend } from "autosendjs";

export interface WeeklyDigestData {
  featuredWorkflow: {
    name: string;
    description: string;
    imageUrl?: string;
    url: string;
  };
  tips: string[];
  featureHighlight?: {
    title: string;
    description: string;
  };
}

const FROM_EMAIL = process.env.AUTOSEND_FROM_EMAIL || "noreply@buildflow.app";
const FROM_NAME = process.env.AUTOSEND_FROM_NAME || "BuildFlow";

export function renderWeeklyDigestEmail(data: WeeklyDigestData): string {
  const { featuredWorkflow, tips, featureHighlight } = data;

  const tipsHtml = tips
    .map(
      (tip, i) => `
      <tr>
        <td style="padding: 8px 0; color: #9898B0; font-size: 15px; line-height: 1.6;">
          <span style="color: #4F8AFF; font-weight: 600; margin-right: 8px;">${i + 1}.</span>
          ${escapeHtml(tip)}
        </td>
      </tr>`
    )
    .join("");

  const featureHighlightHtml = featureHighlight
    ? `
    <!-- Feature Highlight -->
    <tr>
      <td style="padding: 0 24px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="background-color: #111120; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
          <tr>
            <td style="padding: 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-bottom: 8px;">
                    <span style="display: inline-block; background-color: rgba(79,138,255,0.12); color: #4F8AFF; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 4px;">New Feature</span>
                  </td>
                </tr>
                <tr>
                  <td style="color: #F0F0F5; font-size: 18px; font-weight: 700; padding-bottom: 8px;">
                    ${escapeHtml(featureHighlight.title)}
                  </td>
                </tr>
                <tr>
                  <td style="color: #9898B0; font-size: 15px; line-height: 1.6;">
                    ${escapeHtml(featureHighlight.description)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    : "";

  const imageHtml = featuredWorkflow.imageUrl
    ? `
              <tr>
                <td style="padding-bottom: 16px;">
                  <img src="${escapeHtml(featuredWorkflow.imageUrl)}" alt="${escapeHtml(featuredWorkflow.name)}"
                    width="100%" style="display: block; border-radius: 8px; max-height: 200px; object-fit: cover;" />
                </td>
              </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>This Week in BuildFlow</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0A0A14; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
    style="background-color: #0A0A14; min-height: 100%;">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
          style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="padding: 0 24px 32px; text-align: center;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="text-align: center; padding-bottom: 12px;">
                    <span style="font-size: 24px; font-weight: 800; color: #F0F0F5; letter-spacing: -0.5px;">Build<span style="color: #4F8AFF;">Flow</span></span>
                  </td>
                </tr>
                <tr>
                  <td style="text-align: center;">
                    <span style="color: #9898B0; font-size: 14px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">This Week in BuildFlow</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding: 0 24px 24px;">
              <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent);"></div>
            </td>
          </tr>

          <!-- Featured Workflow -->
          <tr>
            <td style="padding: 0 24px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background-color: #111120; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="padding-bottom: 8px;">
                          <span style="display: inline-block; background-color: rgba(79,138,255,0.12); color: #4F8AFF; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 4px;">Workflow of the Week</span>
                        </td>
                      </tr>
                      ${imageHtml}
                      <tr>
                        <td style="color: #F0F0F5; font-size: 20px; font-weight: 700; padding-bottom: 8px;">
                          ${escapeHtml(featuredWorkflow.name)}
                        </td>
                      </tr>
                      <tr>
                        <td style="color: #9898B0; font-size: 15px; line-height: 1.6; padding-bottom: 20px;">
                          ${escapeHtml(featuredWorkflow.description)}
                        </td>
                      </tr>
                      <tr>
                        <td>
                          <a href="${escapeHtml(featuredWorkflow.url)}"
                            style="display: inline-block; background: linear-gradient(135deg, #4F46E5, #4F8AFF); color: #ffffff; font-size: 14px; font-weight: 600; text-decoration: none; padding: 12px 28px; border-radius: 8px;">
                            Open in BuildFlow &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Tips Section -->
          <tr>
            <td style="padding: 0 24px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                style="background-color: #111120; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px;">
                <tr>
                  <td style="padding: 24px;">
                    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                      <tr>
                        <td style="color: #F0F0F5; font-size: 18px; font-weight: 700; padding-bottom: 16px;">
                          Quick Tips
                        </td>
                      </tr>
                      ${tipsHtml}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          ${featureHighlightHtml}

          <!-- Footer -->
          <tr>
            <td style="padding: 24px; text-align: center;">
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="padding-bottom: 16px;">
                    <div style="height: 1px; background: linear-gradient(to right, transparent, rgba(255,255,255,0.08), transparent);"></div>
                  </td>
                </tr>
                <tr>
                  <td style="color: #6B6B80; font-size: 12px; line-height: 1.5; text-align: center;">
                    You received this because you subscribed to BuildFlow updates.<br />
                    <a href="{{unsubscribe_url}}" style="color: #4F8AFF; text-decoration: underline;">Unsubscribe</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function sendWeeklyDigest(
  emails: string[],
  data: WeeklyDigestData
): Promise<{ sent: number; failed: number }> {
  const autosend = new Autosend(process.env.AUTOSEND_API_KEY || "AS_placeholder");
  const html = renderWeeklyDigestEmail(data);

  let sent = 0;
  let failed = 0;

  // AutoSend supports bulk sending up to 100 recipients at a time
  const batchSize = 100;
  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);

    try {
      await autosend.emails.bulk({
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject: "This Week in BuildFlow — Workflow of the Week",
        html,
        recipients: batch.map((email) => ({ email })),
      });
      sent += batch.length;
    } catch {
      // Fall back to individual sends if bulk fails
      for (const email of batch) {
        try {
          await autosend.emails.send({
            from: { email: FROM_EMAIL, name: FROM_NAME },
            to: { email },
            subject: "This Week in BuildFlow — Workflow of the Week",
            html,
          });
          sent++;
        } catch {
          failed++;
        }
      }
    }
  }

  return { sent, failed };
}
