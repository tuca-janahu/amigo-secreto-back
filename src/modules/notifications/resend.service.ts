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
  <p>Olá, ${escapeHtml(participantName)}! 🎁</p>
  <p>O sorteio do grupo <strong>${escapeHtml(groupName)}</strong> já foi realizado.</p>
  <p><a href="${invitationUrl}">Ver meu amigo secreto</a></p>
  <p>Este link é individual. Não compartilhe.</p>
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
