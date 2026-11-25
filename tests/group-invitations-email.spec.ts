import { beforeEach, describe, expect, it, vi } from 'vitest';

const emailsSend = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: emailsSend } })),
}));

import { sendGroupJoinEmail } from '../src/modules/group-invitations/group-invitations.email.js';

describe('group join email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    emailsSend.mockResolvedValue({ data: { id: 'message-1' }, error: null });
  });

  it('addresses the owner and escapes participant and group names', async () => {
    await sendGroupJoinEmail({
      ownerEmail: 'owner@example.com',
      participantName: '<Lucas>\nTeste',
      groupId: 'group-1',
      groupName: 'Amigos & família',
    });

    const [email] = emailsSend.mock.calls[0];
    expect(email).toMatchObject({
      to: 'owner@example.com',
      subject: 'Alguém entrou no seu grupo de Amigo Secreto',
      text: expect.stringContaining('<Lucas> Teste entrou no seu grupo “Amigos & família” via convite.'),
    });
    expect(email.text).toContain('http://localhost:5173/dashboard/groups/group-1');
    expect(email.html).toContain('&lt;Lucas&gt; Teste');
    expect(email.html).toContain('Amigos &amp; família');
    expect(email.html).not.toContain('<Lucas>');
    expect(emailsSend.mock.calls[0][1]).toEqual({
      idempotencyKey: expect.stringMatching(/^transactional\/[a-f0-9]{64}$/),
    });
  });
});
