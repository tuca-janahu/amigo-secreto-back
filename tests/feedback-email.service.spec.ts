import { beforeEach, describe, expect, it, vi } from 'vitest';

const emailsSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: emailsSend },
  })),
}));

import { sendFeedbackEmail } from '../src/modules/feedback/feedback-email.service.js';

describe('feedback email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends anonymous feedback with safe labels and escaped HTML', async () => {
    emailsSend.mockResolvedValue({
      data: { id: 'feedback-message-1' },
      error: null,
    });

    await expect(
      sendFeedbackEmail({
        type: 'BUG',
        message: '<script>alert("token")</script>',
        source: 'PARTICIPANT',
      }),
    ).resolves.toBeUndefined();

    expect(emailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Amigo Secreto <noreply@example.com>',
        to: 'feedback@example.com',
        subject: '[Amigo Secreto] Bug',
        text: expect.stringContaining('Tela: Participante'),
      }),
    );
    const email = emailsSend.mock.calls[0][0];
    expect(email.html).toContain('&lt;script&gt;alert(&quot;token&quot;)&lt;/script&gt;');
    expect(email.html).not.toContain('<script>alert');
  });

  it('fails when the provider does not return a message id', async () => {
    emailsSend.mockResolvedValue({
      data: null,
      error: { message: 'Provider unavailable' },
    });

    await expect(
      sendFeedbackEmail({
        type: 'SUGGESTION',
        message: 'Adicionar lembretes.',
        source: 'DASHBOARD',
      }),
    ).rejects.toThrow('Não foi possível enviar o feedback.');
  });
});
