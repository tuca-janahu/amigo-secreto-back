import { config } from '../../config/env.js';
import { resend } from '../../lib/resend.js';
import type { CreateFeedbackInput } from './feedback.schemas.js';

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

const typeLabels: Record<CreateFeedbackInput['type'], string> = {
  BUG: 'Bug',
  SUGGESTION: 'Sugestão',
};

const sourceLabels: Record<CreateFeedbackInput['source'], string> = {
  HOME: 'Início',
  LOGIN: 'Login',
  REGISTER: 'Cadastro',
  DASHBOARD: 'Dashboard',
  GROUP: 'Grupo',
  PARTICIPANT: 'Participante',
  OTHER: 'Outra tela',
};

export const sendFeedbackEmail = async ({
  type,
  message,
  source,
}: CreateFeedbackInput): Promise<void> => {
  const typeLabel = typeLabels[type];
  const sourceLabel = sourceLabels[source];
  const result = await resend.emails.send({
    from: config.emailFrom,
    to: config.feedbackEmailTo,
    subject: `[Amigo Secreto] ${typeLabel}`,
    text: `Tipo: ${typeLabel}\nTela: ${sourceLabel}\n\n${message}`,
    html: `
      <!doctype html>
      <html lang="pt-BR">
        <body style="margin:0; padding:24px; background:#f7f1df; color:#171717; font-family:'Courier New', Courier, monospace;">
          <main style="max-width:620px; margin:0 auto; background:#ffffff; border:2px solid #171717; padding:28px; box-shadow:6px 6px 0 #171717;">
            <p style="margin:0 0 8px; font-size:12px; font-weight:700; text-transform:uppercase;">${typeLabel}</p>
            <p style="margin:0 0 24px; font-size:12px;">Tela: ${sourceLabel}</p>
            <div style="font-size:15px; line-height:1.6; white-space:pre-wrap;">${escapeHtml(message)}</div>
          </main>
        </body>
      </html>
    `,
  });

  if (result.error || !result.data?.id) {
    throw new Error('Não foi possível enviar o feedback.');
  }
};
