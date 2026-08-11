import { describe, expect, it } from 'vitest';

const { redact } = require('../../middleware/sensitive');

describe('sensitive redaction (F5)', () => {
  it('nulls out every sensitive key, nested included', () => {
    const input = {
      username: 'nik123',
      password: 'plain-secret',
      oldPassword: 'old-secret',
      newPassword: 'new-secret',
      token: 'jwt-abc',
      nested: { refresh_token: 'x', safe: 'keep' },
      meta: { extra: '1' },
    };
    const out = redact(input);
    expect(out.password).toBe('***');
    expect(out.oldPassword).toBe('***');
    expect(out.newPassword).toBe('***');
    expect(out.token).toBe('***');
    expect(out.nested.refresh_token).toBe('***');
    expect(out.nested.safe).toBe('keep');
    expect(out.username).toBe('nik123');
    expect(out.meta.extra).toBe('1');
    // Original object untouched (no accidental mutations)
    expect(input.password).toBe('plain-secret');
  });

  it('leaves non-object values alone', () => {
    expect(redact('x')).toBe('x');
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('redacts password-like keys inside arrays', () => {
    const out = redact([{ password: 'a' }, { x: 1 }]);
    expect(out[0].password).toBe('***');
  });
});
