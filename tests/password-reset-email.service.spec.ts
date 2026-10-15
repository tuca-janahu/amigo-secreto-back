import { beforeEach, describe, expect, it, vi } from 'vitest';

const emailsSend = vi.hoisted(() => vi.fn());

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: emailsSend },
  })),
}));

import { sendPasswordResetEmail } from '../src/modules/auth/password-reset-email.service.js';

describe('password reset email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends text and HTML with the reset link', async () => {
    emailsSend.mockResolvedValue({
      data: { id: 'password-reset-message-1' },
      error: null,
    });

    await sendPasswordResetEmail({
      recipient: 'user@example.com',
      token: 'single-use-token',
    });

    expect(emailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Amigo Secreto <noreply@example.com>',
        to: 'user@example.com',
        subject: 'Redefina sua senha no Amigo Secreto',
        text: expect.stringContaining(
          'http://localhost:5173/reset-password/single-use-token',
        ),
        html: expect.stringContaining(
          'http://localhost:5173/reset-password/single-use-token',
        ),
      }),
    );
  });

  it('fails when the provider does not return a message id', async () => {
    emailsSend.mockResolvedValue({
      data: null,
      error: { message: 'Provider unavailable' },
    });

    await expect(
      sendPasswordResetEmail({
        recipient: 'user@example.com',
        token: 'single-use-token',
      }),
    ).rejects.toThrow('Não foi possível enviar o e-mail de redefinição de senha.');
  });
});
