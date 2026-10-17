import { config } from '../../config/env.js';
import { resend } from '../../lib/resend.js';

const passwordResetHtml = (resetUrl: string): string => `
  <!doctype html>
  <html lang="pt-BR">
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light">
      <title>Redefina sua senha</title>
    </head>
    <body style="margin:0; padding:0; background:#f7f1df; color:#171717; font-family:'Courier New', Courier, monospace;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background:#f7f1df;">
        <tr>
          <td align="center" style="padding:48px 16px;">
            <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%; max-width:620px; background:#ffffff; border:2px solid #171717; box-shadow:5px 5px 0 #171717;">
              <tr>
                <td style="padding:36px 30px 32px;">
                  <p style="margin:0 0 12px; color:#174b32; font-size:12px; font-weight:700; text-transform:uppercase;">Amigo Secreto</p>
                  <h1 style="margin:0 0 18px; font-size:30px; line-height:1.15;">Redefina sua senha</h1>
                  <p style="margin:0 0 24px; font-size:16px; line-height:1.6;">Recebemos uma solicitação para trocar a senha da sua conta. Este link é válido por 1 hora.</p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; margin:0 0 26px;">
                    <tr>
                      <td align="center" style="background:#d94a3a; border:2px solid #171717; box-shadow:4px 4px 0 #171717;">
                        <a href="${resetUrl}" style="display:block; padding:15px 18px; color:#ffffff; font-size:14px; font-weight:700; text-decoration:none; text-transform:uppercase;">Criar nova senha</a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0; color:#555555; font-size:12px; line-height:1.55;">Se você não fez esta solicitação, ignore este e-mail.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

export const sendPasswordResetEmail = async ({
  recipient,
  token,
}: {
  recipient: string;
  token: string;
}): Promise<void> => {
  const resetUrl = new URL(`/reset-password/${token}`, config.appUrl).toString();
  const result = await resend.emails.send({
    from: config.emailFrom,
    to: recipient,
    subject: 'Redefina sua senha no Amigo Secreto',
    text: `Use o link abaixo para redefinir sua senha. Ele é válido por 1 hora.\n\n${resetUrl}\n\nSe você não fez esta solicitação, ignore este e-mail.`,
    html: passwordResetHtml(resetUrl),
  });

  if (result.error || !result.data?.id) {
    throw new Error('Não foi possível enviar o e-mail de redefinição de senha.');
  }
};
