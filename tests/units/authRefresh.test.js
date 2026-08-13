import { jwtVerify, SignJWT } from 'jose';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authController = require('../../controllers/main/authController');

const SECRET = new TextEncoder().encode(process.env.SECRETTOKEN);

function fakeRes() {
  const captured = {};
  return {
    captured,
    status(code) {
      captured.status = code;
      return this;
    },
    json(body) {
      captured.body = body;
      return captured;
    },
    clearCookie() {
      return this;
    },
  };
}

async function signToken(overrides = {}) {
  const iat = overrides.iat ?? Math.floor(Date.now() / 1000);
  const payload = {
    iss: 'SIRS RS Islam Aminah',
    aud: 'Client RS Islam Aminah REST API',
    iat,
    exp: overrides.exp ?? iat + 172800,
    data: { username: overrides.username ?? 'dokter01' },
  };
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(SECRET);
}

describe('token refresh (POST /auth/refresh)', () => {
  let query;

  beforeEach(() => {
    query = vi.fn();
  });

  it('issues a fresh token for an existing admin without the password', async () => {
    query.mockResolvedValueOnce([[{ 1: 1 }]]);
    const token = await signToken();
    const res = fakeRes();

    await authController.refreshToken({ body: { token } }, res, { query });

    expect(res.captured.status).toBe(200);
    expect(res.captured.body.success).toBe(true);
    const fresh = res.captured.body.data.token;
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(token);
    const { payload } = await jwtVerify(fresh, SECRET);
    expect(payload.data.username).toBe('dokter01');
  });

  it('refreshes a token expired within the 24h grace window', async () => {
    query.mockResolvedValueOnce([[{ 1: 1 }]]);
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ iat: now - 60 * 60 * 12, exp: now - 60 * 60 }); // expired 1h ago
    const res = fakeRes();

    await authController.refreshToken({ body: { token } }, res, { query });

    expect(res.captured.status).toBe(200);
    expect(res.captured.body.data.token).toBeTruthy();
  });

  it('rejects a token expired beyond the grace window', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({ iat: now - 3 * 24 * 60 * 60, exp: now - 2 * 24 * 60 * 60 });
    const res = fakeRes();

    await authController.refreshToken({ body: { token } }, res, { query });

    expect(res.captured.status).toBe(401);
    expect(res.captured.body.message).toContain('Sesi berakhir');
  });

  it('rejects a garbage token', async () => {
    const res = fakeRes();
    await authController.refreshToken({ body: { token: 'not-a-jwt' } }, res);
    expect(res.captured.status).toBe(401);
  });

  it('rejects a missing token', async () => {
    const res = fakeRes();
    await authController.refreshToken({ body: {} }, res, { query });
    expect(res.captured.status).toBe(400);
  });

  it('rejects a valid token for a deleted user', async () => {
    query.mockResolvedValueOnce([[]]); // not admin
    query.mockResolvedValueOnce([[]]); // not user
    const token = await signToken({ username: 'deleted_user' });
    const res = fakeRes();

    await authController.refreshToken({ body: { token } }, res, { query });

    expect(res.captured.status).toBe(401);
    expect(res.captured.body.message).toContain('Akun tidak ditemukan');
  });
});
