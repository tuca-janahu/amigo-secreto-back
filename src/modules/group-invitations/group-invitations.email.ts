import { config } from '../../config/env.js';
import { sendTransactionalEmail } from '../../lib/transactional-email.js';

type GroupJoinEmail = {
  ownerEmail: string;
  participantName: string;
  groupId: string;
  groupName: string;
};

const oneLine = (value: string): string =>
  value.replace(/[\r\n]+/g, ' ').trim();
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );

export const sendGroupJoinEmail = async ({
  ownerEmail,
  participantName,
  groupId,
  groupName,
}: GroupJoinEmail): Promise<void> => {
  const name = oneLine(participantName);
  const group = oneLine(groupName);
  const groupUrl = new URL(
    `/dashboard/groups/${encodeURIComponent(groupId)}`,
    config.appUrl,
  ).toString();

  await sendTransactionalEmail(
    {
      from: config.emailFrom,
      to: ownerEmail,
      subject: 'Alguém entrou no seu grupo de Amigo Secreto',
      text: `${name} entrou no seu grupo “${group}” via convite.\n\nAcompanhe o grupo: ${groupUrl}`,
      html: `<!doctype html>
      <html lang="pt-BR">
        <body style="margin:0; padding:24px; background:#f7f1df; color:#171717; font-family:'Courier New', Courier, monospace;">
          <main style="max-width:620px; margin:0 auto; background:#ffffff; border:2px solid #171717; padding:28px; box-shadow:6px 6px 0 #171717;">
            <p style="margin:0 0 12px; color:#174b32; font-size:12px; font-weight:700; text-transform:uppercase;">Amigo Secreto</p>
            <h1 style="margin:0 0 18px; font-size:26px; line-height:1.2;">Nova pessoa no grupo</h1>
            <p style="font-size:16px; line-height:1.6;">${escapeHtml(name)} entrou no seu grupo <strong>${escapeHtml(group)}</strong> via convite.</p>
            <p style="margin:24px 0 0;"><a href="${escapeHtml(groupUrl)}" style="display:inline-block; padding:12px 18px; background:#174b32; color:#ffffff; font-weight:700; text-decoration:none;">Acompanhar grupo</a></p>
          </main>
        </body>
      </html>`,
    },
    'Não foi possível enviar o aviso de entrada no grupo.',
  );
};
