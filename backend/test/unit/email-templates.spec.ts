import { expect, test } from 'vitest';
import { renderEmail } from '../../src/infrastructure/email/index.js';

test('all six flows produce English text/HTML, escaped display input and intended recipient', () => {
  for (const kind of [
    'verification',
    'reset',
    'invitation',
    'email-change',
    'security',
    'admin-setup',
  ] as const) {
    const rendered = renderEmail(
      {
        kind,
        to: 'person@example.test',
        actionUrl: '/verify?token=test',
        displayName: '<script>test</script>',
        organizationName: '<Team>',
        reason: 'password_changed',
      },
      'https://lexon.example',
    );
    expect(rendered.to).toBe('person@example.test');
    expect(rendered.subject.length).toBeGreaterThan(5);
    expect(
      rendered.text.includes('https://lexon.example/verify?token=test'),
    ).toBe(true);
    expect(rendered.html.includes('<script>')).toBe(false);
    expect(rendered.html.includes('&lt;script&gt;')).toBe(true);
    expect(
      rendered.html.includes('https://lexon.example/verify?token=test'),
    ).toBe(true);
  }
});
test('mail rejects external URLs, credential-bearing origins and invalid recipients', () => {
  for (const actionUrl of [
    'https://other.example/reset',
    '//other.example/reset',
    'javascript:alert(1)',
    'https://user:pass@lexon.example/reset',
  ])
    expect(() =>
      renderEmail(
        { kind: 'reset', to: 'person@example.test', actionUrl },
        'https://lexon.example',
      ),
    ).toThrow();
  expect(() =>
    renderEmail(
      {
        kind: 'reset',
        to: 'person@example.test\r\nBcc:other@example.test',
        actionUrl: '/reset',
      },
      'https://lexon.example',
    ),
  ).toThrow();
});
