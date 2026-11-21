import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { send, delay } = vi.hoisted(() => ({ send: vi.fn(), delay: vi.fn() }));
vi.mock('../src/lib/resend.js', () => ({ resend: { emails: { send } } }));
vi.mock('node:timers/promises', () => ({ setTimeout: delay }));
vi.mock('../src/config/env.js', () => ({
  config: {
    isProduction: true,
    appUrl: 'https://amigosecreto.janahu.dev.br',
  },
}));

import { emailAccessUrl, sendTransactionalEmail } from '../src/lib/transactional-email.js';

const payload = {
  from: 'Amigo Secreto <amigosecreto@mail.janahu.dev.br>',
  to: 'participant@example.com',
  subject: 'Seu convite',
  html: '<p>Convite</p>',
  text: 'Convite',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  send.mockResolvedValue({ data: { id: 'email-id' }, error: null });
});
afterEach(() => vi.restoreAllMocks());

describe('transactional email delivery', () => {
  it.each([429, 500, 503])(
    'retries %s using the exact same payload and key',
    async (statusCode) => {
      send.mockResolvedValueOnce({ error: { statusCode }, headers: { 'retry-after': '2' } });
      await expect(sendTransactionalEmail(payload, 'Falha')).resolves.toBe('email-id');
      expect(delay).toHaveBeenCalledWith(expect.any(Number));
      expect(delay.mock.calls[0][0]).toBeGreaterThanOrEqual(2000);
      expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
      expect(send.mock.calls[0][1].idempotencyKey).toMatch(/^transactional\/[a-f0-9]{64}$/);
    },
  );

  it('retries network failures and limits attempts without logging provider content', async () => {
    send.mockRejectedValue(new Error('secret-token participant@example.com'));
    await expect(sendTransactionalEmail(payload, 'Falha')).rejects.toThrow('Falha');
    expect(send).toHaveBeenCalledTimes(3);
    const logs = JSON.stringify([
      vi.mocked(console.error).mock.calls,
      vi.mocked(console.warn).mock.calls,
    ]);
    expect(logs).not.toContain('secret-token');
    expect(logs).not.toContain(payload.to);
  });

  it.each([400, 401, 403, 409, 422])('does not retry permanent %s errors', async (statusCode) => {
    send.mockResolvedValue({ error: { statusCode } });
    await expect(sendTransactionalEmail(payload, 'Falha')).rejects.toThrow('Falha');
    expect(send).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('does not shorten a long Retry-After', async () => {
    send.mockResolvedValue({ error: { statusCode: 429 }, headers: { 'retry-after': '120' } });
    await expect(sendTransactionalEmail(payload, 'Falha')).rejects.toThrow('Falha');
    expect(send).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it.each([
    { to: 'invalid' },
    { from: 'Other <other@example.com>' },
    { subject: 'Subject\r\nBcc: other@example.com' },
    { text: '' },
    { html: '' },
  ])('validates the payload before contacting Resend: %j', async (invalid) => {
    await expect(sendTransactionalEmail({ ...payload, ...invalid }, 'Falha')).rejects.toThrow(
      'Falha',
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves direct production URLs and rejects token injection', () => {
    expect(emailAccessUrl('s', 'individual-token')).toBe(
      'https://amigosecreto.janahu.dev.br/s/individual-token',
    );
    for (const token of ['', '../redirect', 'token?next=external', 'token#fragment', 'token"']) {
      expect(() => emailAccessUrl('s', token)).toThrow();
    }
  });
});
