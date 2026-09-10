import { Resend } from 'resend';

import { config } from '../../config/env.js';

const resend = new Resend(config.resendApiKey);

const escapeHtml = (value: string): string =>
  value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
    };

    return entities[character];
  });

const invitationHtml = ({
  participantName,
  groupName,
  invitationUrl,
}: {
  participantName: string;
  groupName: string;
  invitationUrl: string;
}): string => `
  <!doctype html>
  <html lang="pt-BR">
    <body style="margin:0; padding:0; background:#fffdf5; color:#171717; font-family:'Courier New', Courier, monospace;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fffdf5;">
        <tr>
          <td align="center" style="padding:40px 16px;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%; max-width:600px;">
              <tr>
                <td style="padding-bottom:18px;">
                  <table role="presentation" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="width:18px; height:18px; background:#1f5b3a; border:2px solid #171717;"></td>
                      <td style="width:18px; height:18px; background:#f2b233; border:2px solid #171717; border-left:0;"></td>
                      <td style="width:18px; height:18px; background:#d94a3a; border:2px solid #171717; border-left:0;"></td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="background:#ffffff; border:2px solid #171717; box-shadow:5px 5px 0 #171717; padding:32px 28px;">
                  <p style="display:inline-block; margin:0 0 24px; padding:6px 8px; background:#f2b233; border:2px solid #171717; color:#171717; font-size:12px; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;">
                    Sorteio realizado
                  </p>
                  <h1 style="margin:0 0 18px; font-size:28px; line-height:1.2; font-weight:700; letter-spacing:-1px;">
                    Olá, ${escapeHtml(participantName)}!
                  </h1>
                  <p style="margin:0 0 16px; font-size:16px; line-height:1.55;">
                    O sorteio do grupo <strong>${escapeHtml(groupName)}</strong> já foi realizado.
                  </p>
                  <p style="margin:0 0 28px; font-size:16px; line-height:1.55;">
                    Clique no botão abaixo para descobrir quem você tirou.
                  </p>
                  <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
                    <tr>
                      <td style="background:#1f5b3a; border:2px solid #171717; box-shadow:4px 4px 0 #171717;">
                        <a href="${invitationUrl}" style="display:inline-block; padding:13px 16px; color:#ffffff; font-size:14px; font-weight:700; letter-spacing:0.5px; text-decoration:none; text-transform:uppercase;">
                          Ver meu amigo secreto
                        </a>
                      </td>
                    </tr>
                  </table>
                  <p style="margin:0; padding-top:18px; border-top:2px solid #171717; color:#5c5c5c; font-size:12px; line-height:1.5;">
                    Este link é individual. Não compartilhe com ninguém.
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
`;

export const sendInvitationEmail = async ({
  recipient,
  participantName,
  groupName,
  token,
}: {
  recipient: string;
  participantName: string;
  groupName: string;
  token: string;
}): Promise<string> => {
  const invitationUrl = new URL(`/s/${token}`, config.appUrl).toString();
  const result = await resend.emails.send({
    from: config.emailFrom,
    to: recipient,
    subject: '🎁 Seu amigo secreto já foi sorteado',
    html: invitationHtml({ participantName, groupName, invitationUrl }),
  });

  if (result.error || !result.data?.id) {
    throw new Error(result.error?.message ?? 'Email provider did not return a message id.');
  }

  return result.data.id;
};
