'use strict';

const TRIGGER_SOURCES = new Set([
  'CustomMessage_SignUp',
  'CustomMessage_ResendCode',
  'CustomMessage_ForgotPassword',
  'CustomMessage_AdminCreateUser',
]);

function subject(triggerSource) {
  if (triggerSource === 'CustomMessage_ForgotPassword') return 'Reset your fork ai password';
  return 'Your fork ai verification code';
}

function htmlEmail(code) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>fork ai verification</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f5f5f4;padding:48px 16px">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e7e5e4">

          <!-- Header -->
          <tr>
            <td style="padding:24px 36px;border-bottom:1px solid #f0efee">
              <table cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td style="vertical-align:middle;padding-right:11px">
                    <img src="https://forkai.in/mark-72.png" width="34" height="34" alt="fork ai" style="display:block;border-radius:8px">
                  </td>
                  <td style="vertical-align:middle">
                    <span style="font-size:18px;font-weight:700;color:#1c1917;letter-spacing:-0.4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">fork ai</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:36px 36px 28px">
              <p style="margin:0 0 6px;font-size:22px;font-weight:600;color:#1c1917;letter-spacing:-0.3px;line-height:1.3">
                Verify your email
              </p>
              <p style="margin:0 0 32px;font-size:14px;color:#78716c;line-height:1.65">
                Enter the code below to complete your sign-up.<br>It expires in <strong style="color:#57534e">10 minutes</strong>.
              </p>

              <!-- OTP block -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
                <tr>
                  <td align="center" style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:10px;padding:28px 20px">
                    <span style="display:block;font-family:'Courier New',Courier,'Lucida Console',monospace;font-size:40px;font-weight:700;letter-spacing:14px;color:#1c1917;line-height:1;padding-left:14px">
                      ${code}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;font-size:13px;color:#a8a29e;line-height:1.6">
                If you didn't create an account with fork ai, you can safely ignore this email. Someone may have typed your address by mistake.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 36px;background:#fafaf9;border-top:1px solid #f0efee">
              <p style="margin:0;font-size:12px;color:#a8a29e;line-height:1.6">
                fork ai &nbsp;·&nbsp;
                <a href="https://forkai.in" style="color:#78716c;text-decoration:none">forkai.in</a>
                &nbsp;·&nbsp;
                <span>This is an automated message — please do not reply.</span>
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

exports.handler = async (event) => {
  const { triggerSource, request, response } = event;

  if (!TRIGGER_SOURCES.has(triggerSource) || !request.codeParameter) {
    return event;
  }

  // {####} is the placeholder Cognito replaces with the actual OTP
  response.emailSubject = subject(triggerSource);
  response.emailMessage = htmlEmail(request.codeParameter);

  return event;
};
