'use strict';

const { Resend } = require('resend');

const expiryMinutes = 10;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function passwordResetEmail(resetUrl, code) {
  const safeUrl = escapeHtml(resetUrl);
  const text = [
    'ISUKA | Isuka Data Platform',
    '',
    'Reset your password',
    'We received a request to reset the password for your Isuka account.',
    `Your verification code is ${code}.`,
    `Reset your password within ${expiryMinutes} minutes: ${resetUrl}`,
    '',
    'If you did not request this change, you can ignore this email. Your password will remain unchanged.',
    '',
    'Isuka Data Platform'
  ].join('\n');
  const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Reset your password</title></head>
<body style="margin:0;padding:0;background:#f4f6f1;color:#1f2e17;font-family:'Work Sans',Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f6f1;padding:36px 14px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe7d8;border-radius:8px;">
        <tr><td style="padding:34px 38px 12px;">
          <p style="margin:0;color:#3d6b1f;font-family:'Baloo 2','Trebuchet MS',Arial,sans-serif;font-size:24px;font-weight:800;line-height:1.2;letter-spacing:0;">ISUKA</p>
          <p style="margin:30px 0 10px;color:#6fa83c;font-size:12px;font-weight:700;line-height:1.4;text-transform:uppercase;">Account security</p>
          <h1 style="margin:0;color:#1f2e17;font-family:'Baloo 2','Trebuchet MS',Arial,sans-serif;font-size:30px;font-weight:800;line-height:1.2;letter-spacing:0;">Reset your password</h1>
          <p style="margin:18px 0 0;color:#52604c;font-size:16px;line-height:1.65;">We received a request to reset the password for your Isuka Data Platform account. Use the secure link below to choose a new password.</p>
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 22px;"><tr><td align="center" bgcolor="#2f641f" style="border-radius:5px;">
            <a href="${safeUrl}" style="display:inline-block;padding:15px 25px;border:1px solid #2f641f;border-radius:5px;color:#ffffff;font-size:15px;font-weight:700;line-height:1.2;text-decoration:none;">Reset Password</a>
          </td></tr></table>
          <p style="margin:0 0 18px;color:#52604c;font-size:14px;line-height:1.6;">Or enter this verification code on the account recovery screen:<br><strong style="display:inline-block;margin-top:6px;color:#1f2e17;font-family:Arial,Helvetica,sans-serif;font-size:24px;letter-spacing:3px;">${escapeHtml(code)}</strong></p>
          <p style="margin:0;color:#52604c;font-size:14px;line-height:1.6;">This link expires in <strong style="color:#1f2e17;">${expiryMinutes} minutes</strong> and can be used once.</p>
          <p style="margin:18px 0 0;color:#687363;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:<br><a href="${safeUrl}" style="color:#3d6b1f;word-break:break-all;">${safeUrl}</a></p>
          <p style="margin:24px 0 0;color:#52604c;font-size:14px;line-height:1.6;">If you did not request this change, you can safely ignore this email. Your password will remain unchanged.</p>
        </td></tr>
        <tr><td style="padding:22px 38px 30px;border-top:1px solid #e7ece3;">
          <p style="margin:0;color:#71806b;font-size:12px;line-height:1.6;">Isuka Data Platform<br>Rwanda agricultural intelligence</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
  <style>@media only screen and (max-width:600px){table[role="presentation"] td{padding-left:22px!important;padding-right:22px!important}h1{font-size:27px!important}}</style>
</body>
</html>`;
  return { html, text };
}

async function sendPasswordResetEmail(email, resetUrl, code, resendClient = null) {
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
    const error = new Error('Password recovery email is not configured.');
    error.code = 'EMAIL_NOT_CONFIGURED';
    throw error;
  }
  const resend = resendClient || new Resend(process.env.RESEND_API_KEY);
  const { html, text } = passwordResetEmail(resetUrl, code);
  const { error } = await resend.emails.send({
    from: `Isuka Data Platform <${process.env.RESEND_FROM_EMAIL}>`,
    to: [email],
    subject: 'Reset your Isuka password',
    html,
    text
  }, { signal: AbortSignal.timeout(12_000) });
  if (error) {
    const failure = new Error('Resend rejected the password reset email.');
    failure.code = 'EMAIL_DELIVERY_FAILED';
    failure.statusCode = error.statusCode;
    throw failure;
  }
}

module.exports = { sendPasswordResetEmail, passwordResetEmail, expiryMinutes };
