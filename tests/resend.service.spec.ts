import { describe, expect, it, vi } from 'vitest';

const emailsSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: emailsSend },
  })),
}));

import { sendInvitationEmail } from '../src/modules/notifications/resend.service.js';

describe('Resend invitation email', () => {
  it('sends the invitation with the configured sender, recipient, and individual link', async () => {
    emailsSend.mockResolvedValue({ data: { id: 'provider-message-1' }, error: null });

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
        subject: '🎁 Seu amigo secreto já foi sorteado',
        html: expect.stringContaining('http://localhost:5173/s/individual-token'),
      }),
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
    ).rejects.toThrow('Recipient is invalid');
  });
});
