const BRAND_GRADIENT = 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #0ea5e9 100%)';

interface EmailLayoutOptions {
  previewText: string;
  heading: string;
  bodyHtml: string;
}

function renderEmailLayout({ previewText, heading, bodyHtml }: EmailLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>CareGiverNG</title>
</head>
<body style="margin:0;padding:0;background-color:#05060f;font-family:'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#05060f;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#10132a;border-radius:16px;overflow:hidden;border:1px solid #262b52;">
          <tr>
            <td style="height:4px;background:${BRAND_GRADIENT};font-size:0;line-height:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px 32px;text-align:center;">
              <span style="display:inline-block;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#8b5cf6;">CareGiverNG</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0 32px;text-align:center;">
              <h1 style="margin:0;font-size:20px;line-height:28px;color:#f5f6fb;font-weight:600;">${heading}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px 32px;color:#aab0d6;font-size:15px;line-height:22px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #20244a;text-align:center;">
              <p style="margin:0;font-size:12px;line-height:18px;color:#5b6089;">
                Nigeria's trusted healthcare workforce marketplace<br />
                &copy; ${new Date().getFullYear()} CareGiverNG. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function otpEmailTemplate(otp: string): string {
  return renderEmailLayout({
    previewText: `Your CareGiverNG verification code is ${otp}`,
    heading: 'Verify your account',
    bodyHtml: `
      <p style="margin:0 0 20px 0;text-align:center;">Use the code below to verify your CareGiverNG account. This code expires in 10 minutes.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center">
            <div style="display:inline-block;padding:16px 28px;border-radius:12px;background-color:#181c3d;border:1px solid #383e78;font-family:'Courier New',monospace;font-size:32px;letter-spacing:10px;font-weight:700;color:#ffffff;">
              ${otp}
            </div>
          </td>
        </tr>
      </table>
      <p style="margin:24px 0 0 0;text-align:center;color:#5b6089;font-size:13px;">If you didn't request this code, you can safely ignore this email.</p>
    `,
  });
}

export function notificationEmailTemplate(title: string, body: string): string {
  return renderEmailLayout({
    previewText: title,
    heading: title,
    bodyHtml: `<p style="margin:0;text-align:center;">${body}</p>`,
  });
}

export function resetPasswordEmailTemplate(token: string): string {
  return renderEmailLayout({
    previewText: `Your CareGiverNG reset password link`,
    heading: 'Reset your password',
    bodyHtml: `<p style="margin:0;text-align:center;">Use the code below to reset your CareGiverNG account password. This code expires in 10 minutes.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <div style="display:inline-block;padding:16px 28px;border-radius:12px;background-color:#181c3d;border:1px solid #383e78;font-family:'Courier New',monospace;font-size:32px;letter-spacing:10px;font-weight:700;color:#ffffff;">
            ${token}
          </div>
        </td>
      </tr>
    </table>
    <p style="margin:24px 0 0 0;text-align:center;color:#5b6089;font-size:13px;">If you didn't request this code, you can safely ignore this email.</p>`,
  });
}

export function successfulSignUpEmailTemplate(email: string): string {
  return renderEmailLayout({
    previewText: `Successful sign up on CareGiverNG`,
    heading: 'Successful sign up',
    bodyHtml: `<p style="margin:0;text-align:center;">Dear ${email}, we are excited to have you on board. You can now login to your CareGiverNG account.</p>
    <a href="https://caregiverng.com/login" style="display:inline-block;padding:12px 28px;border-radius:8px;background-color:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:600;margin-top:20px;">Login to your account</a>`,
  });
}

export function sendAdminWelcomeEmail(email: string, password: string, adminRole: string): string {
  return renderEmailLayout({
    previewText: `Welcome to CareGiverNG`,
    heading: 'Successful Account Created',
    bodyHtml: `<p style="margin:0;text-align:center;">Dear ${email}, you have been assigned the role of ${adminRole}.</p>
    <p style="margin:0;text-align:center;">Your password is: ${password}</p>
    <p style="margin:0;text-align:center;">Please change your password after login.</p>
    <p style="margin:0;text-align:center;">Please do not share your login credentials with anyone.</p>
    <a href="https://caregiverng.com/login" style="display:inline-block;padding:12px 28px;border-radius:8px;background-color:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:600;margin-top:20px;">Login to your account</a>`,
  });
}

export function sendAdminPasswordUpdateEmail(email: string): string {
  return renderEmailLayout({
    previewText: `Your CareGiverNG password has been updated`,
    heading: 'Password Updated',
    bodyHtml: `<p style="margin:0;text-align:center;">Dear ${email}, your CareGiverNG password has been updated.</p>
    <p style="margin:0;text-align:center;">You can now re login and continue using the application</p>
    <a href="https://caregiverng.com/login" style="display:inline-block;padding:12px 28px;border-radius:8px;background-color:#8b5cf6;color:#ffffff;text-decoration:none;font-weight:600;margin-top:20px;">Login to your account</a>`,
  });
}
