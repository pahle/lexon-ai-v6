import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { identityApiHarness } from '../setup/identity-api-harness.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';
test('real successful rejected malformed and unavailable identity traffic keeps credential sentinels out of logs errors and audits', async ({
  services,
}) => {
  const fault = await FaultProxy.start(services.valkey.limiterUrl);
  const api = await identityApiHarness(services, fault.url);
  const audit = createAuditInspector(services);
  try {
    const actor = await api.user('Privacy identity');
    const sentinels = [
      actor.password,
      actor.profile.email,
      api.env.AUTH_SECRET!,
      api.env.AUTH_AUDIT_HMAC_SECRET!,
    ];
    const cookieValue = actor.headers.cookie.split('=')[1]!;
    sentinels.push(cookieValue, decodeURIComponent(cookieValue));
    const issued = await api.call(
      '/identity/bearer-sessions',
      actor.headers,
      'POST',
      {},
    );
    expect(issued.status).toBe(201);
    const bearer = (await issued.json()) as { token: string };
    sentinels.push(bearer.token);
    expect(
      (await api.call('/identity', { authorization: 'Bearer ' + bearer.token }))
        .status,
    ).toBe(200);
    const sessionsText = await (
      await api.call('/identity/sessions', actor.headers)
    ).text();
    expect(sentinels.some((value) => sessionsText.includes(value))).toBe(false);
    const setup = await api.enroll(actor);
    sentinels.push(setup.totpURI, ...setup.backupCodes);
    const code = '654321';
    sentinels.push(code);
    await api.call('/auth/two-factor/verify-totp', actor.headers, 'POST', {
      code,
    });
    await api.call(
      '/auth/two-factor/verify-backup-code',
      actor.headers,
      'POST',
      { code: 'Recovery-private-sentinel' },
    );
    sentinels.push('Recovery-private-sentinel');
    const unknown = 'unknown-' + randomUUID() + '@example.test';
    sentinels.push(unknown, '198.51.100.77');
    for (let n = 0; n < 2; n++)
      expect(
        (
          await api.call(
            '/auth/sign-in/email',
            { 'x-forwarded-for': '198.51.100.77' },
            'POST',
            { email: unknown, password: actor.password },
          )
        ).status,
      ).toBe(401);
    const link = api.mail.find(
      (message) => message.kind === 'verification',
    )!.actionUrl;
    sentinels.push(link, new URL(link).searchParams.get('token')!);
    await fetch(api.origin + '/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        origin: api.config.auth.origin,
        'content-type': 'application/json',
      },
      body: '{"password":"Malformed-private-sentinel",',
    });
    sentinels.push('Malformed-private-sentinel');
    fault.disconnect();
    // LEX-ARC-001 §5.4: workspace routes stay available during a limiter
    // outage; authentication endpoints still fail closed.
    expect((await api.call('/identity', actor.headers)).status).toBe(200);
    const unavailable = await fetch(api.origin + '/api/auth/sign-in/email', {
      method: 'POST',
      headers: {
        origin: api.config.auth.origin,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'outage-private-sentinel@example.test',
        password: 'Outage-private-sentinel',
      }),
    });
    expect(unavailable.status).toBe(503);
    sentinels.push(
      'outage-private-sentinel@example.test',
      'Outage-private-sentinel',
    );
    const events = await audit.serializedEvents();
    const failed = JSON.parse(events) as {
      type: string;
      metadata: { subjectHmac?: string };
      subject_user_id?: string | null;
    }[];
    const unknownFailures = failed.filter(
      (event) =>
        event.type === 'identity.sign_in_failed.v1' &&
        !!event.metadata.subjectHmac,
    );
    expect(unknownFailures.length).toBe(2);
    expect(
      unknownFailures[0]!.metadata.subjectHmac ===
        unknownFailures[1]!.metadata.subjectHmac,
    ).toBe(true);
    expect(api.logs.length > 5 && api.failures.length > 3).toBe(true);
    const captured = api.logs.join('') + api.failures.join('') + events;
    expect(sentinels.some((value) => !!value && captured.includes(value))).toBe(
      false,
    );
  } finally {
    await api.close();
    await audit.close();
    await fault.close();
  }
});
