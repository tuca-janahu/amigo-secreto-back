import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendFeedbackEmail = vi.hoisted(() => vi.fn());

vi.mock('../src/modules/feedback/feedback-email.service.js', () => ({
  sendFeedbackEmail,
}));

import { app } from '../src/app.js';
import { feedbackRateLimiter } from '../src/middlewares/security.js';

const validFeedback = {
  type: 'BUG',
  message: 'O botão não responde.',
  source: 'DASHBOARD',
};

describe('POST /feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feedbackRateLimiter.resetKey('127.0.0.1');
    sendFeedbackEmail.mockResolvedValue(undefined);
  });

  it('trims and sends valid anonymous feedback', async () => {
    const response = await request(app)
      .post('/feedback')
      .set('Origin', 'http://localhost:5173')
      .send({ ...validFeedback, message: '  O botão não responde.  ' });

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
    expect(sendFeedbackEmail).toHaveBeenCalledWith(validFeedback);
  });

  it.each([
    { ...validFeedback, type: 'OTHER' },
    { ...validFeedback, source: '/s/secret-token' },
    { ...validFeedback, message: '    ' },
    { ...validFeedback, message: 'a'.repeat(2_001) },
    { ...validFeedback, accountEmail: 'person@example.com' },
  ])('rejects an invalid payload', async (body) => {
    const response = await request(app).post('/feedback').send(body);

    expect(response.status).toBe(400);
    expect(sendFeedbackEmail).not.toHaveBeenCalled();
  });

  it('rejects an untrusted browser origin', async () => {
    const response = await request(app)
      .post('/feedback')
      .set('Origin', 'https://malicious.example')
      .send(validFeedback);

    expect(response.status).toBe(403);
    expect(sendFeedbackEmail).not.toHaveBeenCalled();
  });

  it('returns 502 without exposing provider details when delivery fails', async () => {
    sendFeedbackEmail.mockRejectedValue(new Error('Provider secret detail'));

    const response = await request(app).post('/feedback').send(validFeedback);

    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      message: 'Não foi possível enviar o feedback.',
    });
    expect(JSON.stringify(response.body)).not.toContain('Provider secret detail');
  });

  it('limits feedback to five submissions per IP in fifteen minutes', async () => {
    const responses = [];

    for (let index = 0; index < 6; index += 1) {
      responses.push(
        await request(app)
          .post('/feedback')
          .send({ ...validFeedback, message: `Mensagem número ${index}` }),
      );
    }

    expect(responses.slice(0, 5).every(({ status }) => status === 204)).toBe(true);
    expect(responses[5].status).toBe(429);
    expect(sendFeedbackEmail).toHaveBeenCalledTimes(5);
  });
});
