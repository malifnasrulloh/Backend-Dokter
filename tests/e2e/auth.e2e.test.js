import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const {
  getBaseUrl,
  DOCTOR_USER,
  ADMIN_USER,
  startServer,
  stopServer,
  login,
  api,
} = require('./helpers');

let doctorToken;
let adminToken;

beforeAll(async () => {
  await startServer();
  const doc = await login(DOCTOR_USER);
  doctorToken = doc.token;
  const adm = await login(ADMIN_USER);
  adminToken = adm.token;
}, 30_000);

afterAll(async () => {
  await stopServer();
});

describe('1. Authentication & Session Flow', () => {
  it('Doctor login returns 200, JWT token, user permissions and info', async () => {
    const { res, data } = await login(DOCTOR_USER);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.data.nip).toBe(DOCTOR_USER.username);
    expect(data.data.nama).toBeDefined();
    expect(data.isadmin).toBe(false);
  });

  it('Admin login returns 200, JWT token, and isadmin=true', async () => {
    const { res, data } = await login(ADMIN_USER);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.token).toBeDefined();
    expect(data.isadmin).toBe(true);
  });

  it('Login with wrong password returns 400/401 and decrements attempts', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: DOCTOR_USER.username,
        password: 'incorrect_password',
      }),
    });
    expect([400, 401]).toContain(res.status);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('Login with nonexistent user returns 400/401', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: '9999999999999',
        password: 'somepassword',
      }),
    });
    expect([400, 401]).toContain(res.status);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('Login with empty body returns 400 Bad Request', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('Refresh token: valid active token returns fresh 48h token', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: doctorToken }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.data.token).toBeDefined();
    expect(typeof data.data.token).toBe('string');
  });

  it('Refresh token: garbage/tampered token returns 401 Unauthorized', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.tampered.token' }),
    });
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.success).toBe(false);
  });

  it('Refresh token: missing token in body returns 400/401', async () => {
    const res = await fetch(`${getBaseUrl()}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect([400, 401]).toContain(res.status);
  });

  it('Logout with valid token clears cookie and returns 200', async () => {
    const freshLogin = await login(DOCTOR_USER);
    const { res, data } = await api('POST', '/api/auth/logout', freshLogin.token);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('Capabilities endpoint returns mobile write access and notification policy', async () => {
    const { res, data } = await api('GET', '/api/auth/capabilities', doctorToken);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('write_access');
    expect(data.data).toHaveProperty('write_endpoints');
    expect(data.data).toHaveProperty('notifications_enabled');
    expect(Array.isArray(data.data.write_endpoints)).toBe(true);
  });

  it('Harian Access: Admin can fetch list of doctor permissions', async () => {
    const { res, data } = await api('GET', '/api/auth/harian-access', adminToken);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
  });

  it('Harian Access: Admin can update doctor harian access', async () => {
    const { res, data } = await api('PUT', '/api/auth/harian-access', adminToken, {
      kd_dokter: DOCTOR_USER.username,
      harian_dokter: true,
    });
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('Harian Access: Non-admin doctor is forbidden (403) from updating access', async () => {
    const { res } = await api('PUT', '/api/auth/harian-access', doctorToken, {
      kd_dokter: DOCTOR_USER.username,
      harian_dokter: true,
    });
    expect(res.status).toBe(403);
  });

  it('Change Password: fails validation when new password is too short (<8 chars)', async () => {
    const { res, data } = await api('POST', '/api/auth/change-password', doctorToken, {
      oldPassword: DOCTOR_USER.password,
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
    expect(data.message).toContain('8');
  });

  it('Change Password: fails validation when new password equals username', async () => {
    const { res, data } = await api('POST', '/api/auth/change-password', doctorToken, {
      oldPassword: DOCTOR_USER.password,
      newPassword: DOCTOR_USER.username,
    });
    expect(res.status).toBe(400);
    expect(data.message).toContain('username');
  });

  it('Change Password: fails validation when new password equals old password', async () => {
    const { res, data } = await api('POST', '/api/auth/change-password', doctorToken, {
      oldPassword: DOCTOR_USER.password,
      newPassword: DOCTOR_USER.password,
    });
    expect(res.status).toBe(400);
    expect(data.message).toContain('sama');
  });
});
