import { beforeEach, describe, expect, it, vi } from 'vitest';

const emailsSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: emailsSend },
  })),
}));

import { sendInvitationEmail } from '../src/modules/notifications/resend.service.js';

describe('Resend invitation email', () => {
  beforeEach(() => vi.clearAllMocks());

  it('escapes personalized HTML and retains equivalent plain text', async () => {
    emailsSend.mockResolvedValue({ data: { id: 'message' }, error: null });
    await sendInvitationEmail({
      recipient: 'lucas@example.com',
      participantName: '<Lucas>',
      groupName: 'Família & Amigos',
      token: 'test-token',
    });
    const { html, text } = emailsSend.mock.calls[0][0];
    expect(html).toContain('Olá, &lt;Lucas&gt;!');
    expect(html).toContain('Família &amp; Amigos');
    expect(text).toContain('Olá, <Lucas>!');
    expect(text).toContain('Família & Amigos');
    expect(text).toContain('http://localhost:5173/s/test-token');
    expect(html).toContain('http://localhost:5173/s/test-token');
  });

  it.each(['', '  ', 'Lucas\r\nBcc: attacker@example.com'])(
    'rejects invalid participant names',
    async (participantName) => {
      await expect(
        sendInvitationEmail({
          recipient: 'lucas@example.com',
          participantName,
          groupName: 'Grupo',
          token: 'test-token',
        }),
      ).rejects.toThrow();
      expect(emailsSend).not.toHaveBeenCalled();
    },
  );

  it('sends the invitation with the configured sender, recipient, and individual link', async () => {
    emailsSend.mockResolvedValue({
      data: { id: 'provider-message-1' },
      error: null,
    });

    await expect(
      sendInvitationEmail({
        recipient: 'lucas@email.com',
        participantName: 'Lucas',
        groupName: 'Amigo Secreto 2026',
        token: 'individual-token',
      }),
    ).resolves.toBe('provider-message-1');

    expect(emailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Amigo Secreto <noreply@example.com>',
        to: 'lucas@email.com',
        subject: '🎁 Lucas, seu amigo secreto já foi sorteado',
        text: expect.stringContaining('O sorteio do grupo Amigo Secreto 2026 já foi realizado.'),
        html: expect.stringContaining('http://localhost:5173/s/individual-token'),
      }),
      {
        idempotencyKey: expect.stringMatching(/^transactional\/[a-f0-9]{64}$/),
      },
    );
    expect(emailsSend.mock.calls[0][0].html).toContain('Lucas');
    expect(emailsSend.mock.calls[0][0].html).toContain('Amigo Secreto 2026');
  });

  it('treats a provider error as a failed send', async () => {
    emailsSend.mockResolvedValue({
      data: null,
      error: { message: 'Recipient is invalid' },
    });

    await expect(
      sendInvitationEmail({
        recipient: 'invalid@email.com',
        participantName: 'Lucas',
        groupName: 'Amigo Secreto 2026',
        token: 'individual-token',
      }),
    ).rejects.toThrow('Não foi possível enviar o e-mail de convite.');
  });
});
