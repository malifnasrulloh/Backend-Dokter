import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const writeAccess = require('../../middleware/writeAccessMiddleware');

describe('uniform write-access policy (F4 / decision D8)', () => {
  const OLD_ENV = process.env.ALLOW_MOBILE_WRITE;

  beforeEach(() => {
    delete process.env.ALLOW_MOBILE_WRITE;
  });
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.ALLOW_MOBILE_WRITE;
    else process.env.ALLOW_MOBILE_WRITE = OLD_ENV;
  });

  it('defaults to read-only (no env set)', () => {
    expect(writeAccess.writeAccessEnabled()).toBe(false);
  });

  it('ALLOW_MOBILE_WRITE=true enables writes', () => {
    process.env.ALLOW_MOBILE_WRITE = 'true';
    expect(writeAccess.writeAccessEnabled()).toBe(true);
  });

  it('ALLOW_MOBILE_WRITE=false blocks writes', () => {
    process.env.ALLOW_MOBILE_WRITE = 'false';
    expect(writeAccess.writeAccessEnabled()).toBe(false);
  });

  it('every clinical write route is gated (no exemptions)', () => {
    expect(writeAccess.WRITE_GATED_PREFIXES).toContain('/soap');
    expect(writeAccess.WRITE_GATED_PREFIXES).toContain('/resep');
    expect(writeAccess.WRITE_GATED_PREFIXES).toContain('/diagnosa-prosedur');
    // Previously exempted routes must now be covered by the same flag:
    expect(writeAccess.WRITE_GATED_PREFIXES).toContain('/dpjp-ranap');
    expect(writeAccess.WRITE_GATED_PREFIXES).toContain('/pemeriksaan');
  });

  it('middleware rejects writes when disabled, passes them when enabled', async () => {
    const middleware = writeAccess();
    let nextCalled = false;
    const next = async () => {
      nextCalled = true;
    };
    // Minimal Hono-context look-alike: the middleware builds its own
    // `res` shim and calls c.json(body, status) when blocking.
    const makeC = () => {
      const c = {
        req: { method: 'POST', path: '/api/soap/ralan' },
        statusCode: 200,
        json(_obj, status) {
          this.statusCode = status || 200;
        },
      };
      return c;
    };

    process.env.ALLOW_MOBILE_WRITE = 'false';
    const c1 = makeC();
    await middleware(c1, next);
    expect(nextCalled).toBe(false);
    expect(c1.statusCode).toBe(403);

    // Reject must hold for gated clinical mutation routes
    for (const path of ['/api/dpjp-ranap', '/api/soap/ranap']) {
      const c = { ...makeC(), req: { method: 'POST', path } };
      await writeAccess()(c, next);
      expect(c.statusCode).toBe(403);
    }

    // SBAR validation is explicitly exempted from write access gating
    const cExempt = { ...makeC(), req: { method: 'POST', path: '/api/pemeriksaan/validasi' } };
    let exemptNextCalled = false;
    await writeAccess()(cExempt, async () => {
      exemptNextCalled = true;
    });
    expect(exemptNextCalled).toBe(true);
    expect(cExempt.statusCode).toBe(200);

    process.env.ALLOW_MOBILE_WRITE = 'true';
    const c2 = makeC();
    nextCalled = false;
    await middleware(c2, next);
    expect(nextCalled).toBe(true);
  });
});
