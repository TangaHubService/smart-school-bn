import nodemailer, { Transporter } from 'nodemailer';

import { env } from '../../config/env';

interface StaffInviteEmailInput {
  toEmail: string;
  tenantName: string;
  roleName: string;
  inviteLink: string;
  expiresAt: Date;
}

export interface PasswordResetEmailInput {
  toEmail: string;
  otp: string;
  expiresAt: Date;
}

export class EmailService {
  private readonly transporter: Transporter;
  private readonly mode: 'smtp' | 'log';

  constructor() {
    if (env.SMTP_HOST && env.SMTP_PORT) {
      this.mode = 'smtp';
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth:
          env.SMTP_USER && env.SMTP_PASS
            ? {
                user: env.SMTP_USER,
                pass: env.SMTP_PASS,
              }
            : undefined,
      });
      return;
    }

    this.mode = 'log';
    this.transporter = nodemailer.createTransport({
      jsonTransport: true,
    });
  }

  async sendPasswordResetOtp(input: PasswordResetEmailInput): Promise<void> {
    const subject = `Your Smart School Rwanda Password Reset Code`;
    const expirationTime = input.expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const escapedOtp = escapeHtml(input.otp);
    const escapedExpirationTime = escapeHtml(expirationTime);

    const text = [
      `Hello,`,
      ``,
      `You recently requested to reset your password for your Smart School Rwanda account.`,
      `Here is your One-Time Password (OTP):`,
      ``,
      `${input.otp}`,
      ``,
      `This code will expire at ${expirationTime}.`,
      `If you did not request a password reset, please ignore this email or contact support.`,
      ``,
      `Smart School Rwanda`,
    ].join('\n');

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Smart School Rwanda Password Reset</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f6f7;font-family:Arial,Helvetica,sans-serif;color:#12342f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #d9e6e3;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:#1f7a63;color:#ffffff;">
                <p style="margin:0;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">Smart School Rwanda</p>
                <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.3;">Password Reset Code</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;">Hello,</p>
                <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;">
                  You recently requested to reset the password for your account. Please use the following code to proceed:
                </p>
                
                <div style="margin:24px 0;padding:20px;background:#f3f6f7;border-radius:8px;text-align:center;">
                  <span style="font-size:32px;font-weight:700;letter-spacing:0.3em;color:#12342f;">${escapedOtp}</span>
                </div>

                <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#2c4e48;">
                  <strong>Code expires at:</strong> ${escapedExpirationTime}
                </p>

                <p style="margin:0;font-size:13px;line-height:1.6;color:#5a6f6b;">
                  If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const result = await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: input.toEmail,
      subject,
      text,
      html,
    });

    if (this.mode === 'log') {
      console.info('[MAILER_LOG_MODE] Password reset OTP generated with nodemailer', {
        to: input.toEmail,
        subject,
        messageId: result.messageId,
      });
    }
  }

  async sendStaffInvite(input: StaffInviteEmailInput): Promise<void> {
    const subject = `Invitation to join ${input.tenantName} on Smart School Rwanda`;
    const expirationDate = input.expiresAt.toISOString().slice(0, 10);
    const escapedTenantName = escapeHtml(input.tenantName);
    const escapedRoleName = escapeHtml(input.roleName);
    const escapedInviteLink = escapeHtml(input.inviteLink);
    const escapedExpirationDate = escapeHtml(expirationDate);

    const text = [
      `Hello,`,
      ``,
      `You have been invited to join ${input.tenantName} as ${input.roleName}.`,
      `To accept this invitation:`,
      `1. Open this link: ${input.inviteLink}`,
      `2. Complete your account details`,
      `3. Sign in to Smart School Rwanda`,
      ``,
      `This invitation expires on ${expirationDate}.`,
      `If you were not expecting this email, you can ignore it.`,
      ``,
      `Smart School Rwanda`,
    ].join('\n');

    const html = `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Smart School Rwanda Invitation</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f6f7;font-family:Arial,Helvetica,sans-serif;color:#12342f;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #d9e6e3;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:#1f7a63;color:#ffffff;">
                <p style="margin:0;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.9;">Smart School Rwanda</p>
                <h1 style="margin:8px 0 0 0;font-size:24px;line-height:1.3;">Staff Invitation</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;">Hello,</p>
                <p style="margin:0 0 12px 0;font-size:16px;line-height:1.6;">
                  You have been invited to join <strong>${escapedTenantName}</strong> as
                  <strong>${escapedRoleName}</strong>.
                </p>
                <p style="margin:0 0 18px 0;font-size:16px;line-height:1.6;">
                  Click the button below to accept your invitation and complete account setup.
                </p>

                <p style="margin:0 0 20px 0;">
                  <a
                    href="${escapedInviteLink}"
                    style="display:inline-block;padding:12px 20px;background:#1f7a63;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;"
                  >
                    Accept Invitation
                  </a>
                </p>

                <p style="margin:0 0 8px 0;font-size:14px;line-height:1.6;color:#2c4e48;">
                  <strong>Invitation expires:</strong> ${escapedExpirationDate}
                </p>
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#2c4e48;">
                  If the button does not work, copy and paste this link into your browser:
                </p>
                <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;word-break:break-word;">
                  <a href="${escapedInviteLink}" style="color:#1f7a63;">${escapedInviteLink}</a>
                </p>

                <p style="margin:0;font-size:13px;line-height:1.6;color:#5a6f6b;">
                  If you were not expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

    const result = await this.transporter.sendMail({
      from: env.EMAIL_FROM,
      to: input.toEmail,
      subject,
      text,
      html,
    });

    if (this.mode === 'log') {
      console.info('[MAILER_LOG_MODE] Invite email payload generated with nodemailer', {
        to: input.toEmail,
        subject,
        messageId: result.messageId,
      });
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
