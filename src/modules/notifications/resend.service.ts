import { config } from '../../config/env.js';
import { resend } from '../../lib/resend.js';

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
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta name="color-scheme" content="light">
      <title>Seu amigo secreto foi sorteado</title>
    </head>
    <body style="margin:0; padding:0; background:#f7f1df; color:#171717; font-family:'Courier New', Courier, monospace;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background:#f7f1df;">
        <tr>
          <td align="center" style="padding:48px 16px;">
            <table role="presentation" width="620" cellpadding="0" cellspacing="0" style="width:100%; max-width:620px;">
              <tr>
                <td style="padding:0 5px 5px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background:#174b32; border:2px solid #171717; box-shadow:5px 5px 0 #171717;">
                    <tr>
                      <td style="padding:22px 24px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td width="54" valign="middle" style="width:54px;">
                              <table role="presentation" width="46" cellpadding="0" cellspacing="0" style="width:46px; background:#f2b233; border:2px solid #171717;">
                                <tr>
                                  <td align="center" valign="middle" height="42" style="height:42px; color:#171717; font-family:Arial, sans-serif; font-size:26px; line-height:42px;">&#127873;</td>
                                </tr>
                              </table>
                            </td>
                            <td valign="middle" style="padding-left:12px;">
                              <p style="margin:0; color:#ffffff; font-size:17px; line-height:1.2; font-weight:700; letter-spacing:1px; text-transform:uppercase;">Amigo Secreto</p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 5px 5px 0;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background:#ffffff; border:2px solid #171717; box-shadow:5px 5px 0 #171717;">
                    <tr>
                      <td style="padding:36px 30px 32px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 26px;">
                          <tr>
                            <td style="background:#f2b233; border:2px solid #171717; padding:7px 10px; color:#171717; font-size:11px; line-height:1; font-weight:700; letter-spacing:0.8px; text-transform:uppercase;">Sorteio realizado</td>
                          </tr>
                        </table>

                        <h1 style="margin:0 0 18px; color:#171717; font-size:30px; line-height:1.15; font-weight:700; letter-spacing:-1.2px;">
                          Olá, ${escapeHtml(participantName)}!
                        </h1>
                        <p style="margin:0 0 16px; color:#292929; font-size:16px; line-height:1.6;">
                          O sorteio do grupo <strong>${escapeHtml(groupName)}</strong> já foi realizado.
                        </p>
                        <p style="margin:0 0 28px; color:#292929; font-size:16px; line-height:1.6;">
                          Clique no botão abaixo para descobrir quem você tirou.
                        </p>

                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; margin:0 0 30px;">
                          <tr>
                            <td align="center" style="background:#d94a3a; border:2px solid #171717; box-shadow:4px 4px 0 #171717;">
                              <a href="${invitationUrl}" style="display:block; padding:15px 18px; color:#ffffff; font-size:14px; line-height:1.2; font-weight:700; letter-spacing:0.6px; text-decoration:none; text-transform:uppercase;">
                                Ver meu amigo secreto
                              </a>
                            </td>
                          </tr>
                        </table>

                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background:#eef6f1; border:2px solid #174b32;">
                          <tr>
                            <td width="42" align="center" valign="middle" style="width:42px; padding:14px 0 14px 14px; color:#174b32; font-family:Arial, sans-serif; font-size:20px;">&#128274;</td>
                            <td style="padding:14px; color:#315c46; font-size:12px; line-height:1.55;">
                              Este link é individual. Não compartilhe com ninguém.
                            </td>
                          </tr>
                        </table>
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
    subject: `🎁 ${participantName}, seu amigo secreto já foi sorteado`,
    html: invitationHtml({ participantName, groupName, invitationUrl }),
  });

  if (result.error || !result.data?.id) {
    throw new Error('Não foi possível enviar o e-mail de convite.');
  }

  return result.data.id;
};
