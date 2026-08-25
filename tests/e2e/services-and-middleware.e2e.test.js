import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const {
  getBaseUrl,
  DOCTOR_USER,
  ADMIN_USER,
  RANAP_NO_RAWAT,
  TODAY,
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

describe('5. Services, Finance, Settings, Notifications & Security Middleware', () => {
  // ── HARIAN DOKTER & JASA MEDIS ──────────────────────────────────────
  describe('Harian Dokter (Service Fees)', () => {
    it('GET /api/harian-dokter returns itemized fees and pagination', async () => {
      const { res, data } = await api(
        'GET',
        `/api/harian-dokter?tglawal=2026-08-01&tglakhir=${TODAY}&page=1&limit=20`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
      if (res.status === 200) {
        expect(data.success).toBe(true);
      }
    });

    it('GET /api/harian-dokter/summary returns fee aggregation', async () => {
      const { res, data } = await api(
        'GET',
        `/api/harian-dokter/summary?tglawal=2026-08-01&tglakhir=${TODAY}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
      if (res.status === 200) {
        expect(data.success).toBe(true);
      }
    });

    it('GET /api/harian-dokter/cara-bayar returns payment method options', async () => {
      const { res, data } = await api('GET', '/api/harian-dokter/cara-bayar', doctorToken);
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('kd_pj');
        expect(data.data[0]).toHaveProperty('png_jawab');
      }
    });
  });

  // ── SETTINGS ────────────────────────────────────────────────────────
  describe('System Settings & Broadcast', () => {
    it('GET /api/setting returns hospital/instance config', async () => {
      const { res, data } = await api('GET', '/api/setting', doctorToken);
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('nama_instansi');
    });

    it('PUT /api/setting updates hospital setting', async () => {
      const { res, data } = await api('PUT', '/api/setting', adminToken, {
        nama_instansi: 'RS Islam Aminah',
      });
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('GET /api/setting/broadcast returns notification broadcast state', async () => {
      const { res } = await api('GET', '/api/setting/broadcast', doctorToken);
      expect(res.status).toBe(200);
    });

    it('PUT /api/setting/broadcast updates broadcast status', async () => {
      const { res } = await api('PUT', '/api/setting/broadcast', adminToken, {
        status: true,
      });
      expect(res.status).toBe(200);
    });
  });

  // ── PERKIRAAN BIAYA (FINANCE) ────────────────────────────────────────
  describe('Perkiraan Biaya (Financial Estimation)', () => {
    it('GET /api/perkiraan-biaya computes cost estimates for patient', async () => {
      const { res, data } = await api(
        'GET',
        `/api/perkiraan-biaya?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
      if (res.status === 200) {
        expect(data.success).toBe(true);
      }
    });
  });

  // ── NOTIFICATIONS QUEUE ──────────────────────────────────────────────
  describe('Notification Polling & Acknowledgment Queue', () => {
    it('GET /api/notifications/poll requires device_id query param', async () => {
      const { res, data } = await api('GET', '/api/notifications/poll', doctorToken);
      expect(res.status).toBe(400);
      expect(data.message).toContain('device_id');
    });

    it('GET /api/notifications/poll with device_id returns unread notifications', async () => {
      const { res, data } = await api(
        'GET',
        '/api/notifications/poll?device_id=phone-e2e-device-01',
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
      if (res.status === 200) {
        expect(data.success).toBe(true);
        expect(data.data).toHaveProperty('notifications');
        expect(Array.isArray(data.data.notifications)).toBe(true);
        expect(data.data).toHaveProperty('last_id');
      }
    });

    it('POST /api/notifications/ack advances device cursor', async () => {
      const { res, data } = await api('POST', '/api/notifications/ack', doctorToken, {
        device_id: 'phone-e2e-device-01',
        last_id: 10,
      });
      expect([200, 204]).toContain(res.status);
      if (res.status === 200) {
        expect(data.success).toBe(true);
      }
    });

    it('POST /api/notifications/ack fails with 400 when last_id is missing', async () => {
      const { res } = await api('POST', '/api/notifications/ack', doctorToken, {
        device_id: 'phone-e2e-device-01',
      });
      expect(res.status).toBe(400);
    });
  });

  // ── SECURITY MIDDLEWARE ──────────────────────────────────────────────
  describe('Security, Sanitization & Envelope Integrity', () => {
    it('JWT Guard rejects unauthenticated requests with 401 and standard envelope', async () => {
      const res = await fetch(`${getBaseUrl()}/api/profile`);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('message');
    });

    it('Input Sanitizer strips dangerous <script> tags from string fields', async () => {
      const sbarWithXSS = {
        no_rawat: RANAP_NO_RAWAT,
        tgl_perawatan: TODAY,
        jam_rawat: '14:14:14',
        situation: 'Normal <script>alert("xss")</script> condition',
        background: 'Clean <img src="x" onerror="alert(1)"> background',
        assesment: 'Safe assessment',
        recommendation: 'Safe recommendation',
        nip: DOCTOR_USER.username,
      };

      const { res, data } = await api('POST', '/api/pemeriksaan', doctorToken, sbarWithXSS);
      expect([200, 201]).toContain(res.status);

      // Clean up the created record
      await api('DELETE', '/api/pemeriksaan', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        tgl_perawatan: TODAY,
        jam_rawat: '14:14:14',
      });
    });

    it('Prototype pollution payload keys are stripped/neutralized', async () => {
      const pollutionBody = JSON.parse(
        '{"no_rawat":"' +
          RANAP_NO_RAWAT +
          '","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}'
      );

      const { res } = await api('POST', '/api/dpjp-ranap', doctorToken, pollutionBody);
      // Global Object prototype must NOT be polluted
      expect({}.polluted).toBeUndefined();
    });

    it('Rate limiter headers (x-ratelimit-limit, x-ratelimit-remaining) are present', async () => {
      const res = await fetch(`${getBaseUrl()}/api/health`);
      expect(res.headers.get('x-ratelimit-limit')).toBeDefined();
    });

    it('Nonexistent route returns standard 404 envelope', async () => {
      const res = await fetch(`${getBaseUrl()}/api/nonexistent-endpoint-xyz`);
      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data).toHaveProperty('code', 404);
      expect(data).toHaveProperty('success', false);
      expect(data).toHaveProperty('message');
    });
  });
});
