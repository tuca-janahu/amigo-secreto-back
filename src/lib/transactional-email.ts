import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

import { config } from '../config/env.js';
import { resend } from './resend.js';

const singleLine = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) =>
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
    ),
  );
export const emailNameSchema = singleLine;
const payloadSchema = z.object({
  from: singleLine.refine((value) => {
    const address = /^Amigo Secreto <([^<>]+)>$/.exec(value)?.[1];
    return (
      z.string().email().safeParse(address).success &&
      (!config.isProduction || value === 'Amigo Secreto <amigosecreto@mail.janahu.dev.br>')
    );
  }),
  to: z.string().email(),
  subject: singleLine,
  html: z.string().min(1),
  text: z.string().min(1),
});

export const emailAccessUrl = (path: 's' | 'reset-password', token: string): string => {
  const base = new URL(config.appUrl);
  if (
    !/^[a-zA-Z0-9_-]{1,256}$/.test(token) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    base.pathname !== '/' ||
    (config.isProduction
      ? base.origin !== 'https://amigosecreto.janahu.dev.br'
      : !['http:', 'https:'].includes(base.protocol))
  ) {
    throw new Error('URL de e-mail inválida.');
  }
  return new URL(`/${path}/${token}`, base).toString();
};

// One immutable payload/key for every retry; neither is written to logs.
// Resend retains idempotency keys for 24 hours.
export const sendTransactionalEmail = async (
  input: z.input<typeof payloadSchema>,
  errorMessage: string,
): Promise<string> => {
  const parsed = payloadSchema.safeParse(input);
  if (!parsed.success) {
    console.error('email_send_failed', { category: 'validation' });
    throw new Error(errorMessage);
  }
  const payload = parsed.data;
  const idempotencyKey = `transactional/${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let retryable = true;
    let retryAfter = 0;
    let status: number | null = null;
    try {
      const result = await resend.emails.send(payload, { idempotencyKey });
      if (!result.error && result.data?.id) return result.data.id;
      status = result.error?.statusCode ?? null;
      retryable =
        status === 429 ||
        (status !== null && status >= 500) ||
        result.error?.name === 'concurrent_idempotent_requests' ||
        result.error?.name === 'application_error';
      const header = result.headers?.['retry-after'];
      if (header) {
        retryAfter = /^\d+(\.\d+)?$/.test(header)
          ? Number(header) * 1000
          : Math.max(0, Date.parse(header) - Date.now());
      }
    } catch {
      // Transport failures may occur after acceptance: retry with the same key.
    }
    // Do not hold HTTP requests indefinitely or retry before Retry-After.
    if (!retryable || attempt === 2 || retryAfter > 30_000) {
      console.error('email_send_failed', { status, attempts: attempt + 1 });
      throw new Error(errorMessage);
    }
    console.warn('email_send_retry', { status, attempt: attempt + 1 });
    await delay(Math.max(retryAfter || 0, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250));
  }
  throw new Error(errorMessage);
};
