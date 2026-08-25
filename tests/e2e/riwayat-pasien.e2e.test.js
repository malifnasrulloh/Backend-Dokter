import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const {
  DOCTOR_USER,
  RANAP_NO_RAWAT,
  RALAN_NO_RAWAT,
  startServer,
  stopServer,
  login,
  api,
} = require('./helpers');

let doctorToken;

beforeAll(async () => {
  await startServer();
  const doc = await login(DOCTOR_USER);
  doctorToken = doc.token;
}, 30_000);

afterAll(async () => {
  await stopServer();
});

describe('4. Comprehensive Riwayat Pasien Endpoints (All 13 Categories)', () => {
  // 1. SOAP Ranap
  it('GET /api/riwayat/pasien/soap-ranap returns history', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/soap-ranap?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });

  // 2. SOAP Ralan
  it('GET /api/riwayat/pasien/soap-ralan returns history', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/soap-ralan?no_rawat=${encodeURIComponent(RALAN_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });

  // 3. Diagnosa
  it('GET /api/riwayat/pasien/diagnosa returns patient diagnosis history', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/diagnosa?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });

  // 4. Prosedur
  it('GET /api/riwayat/pasien/prosedur returns patient procedures history', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/prosedur?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });

  // 5. Pemberian Obat (Envelope with { list, total_biaya } or empty array)
  it('GET /api/riwayat/pasien/pemberian-obat returns medicine history with billing', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/pemberian-obat?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      if (Array.isArray(data.data)) {
        expect(data.data.length).toBe(0);
      } else {
        expect(data.data).toHaveProperty('list');
        expect(data.data).toHaveProperty('total_biaya');
      }
    }
  });

  // 6. Laboratorium (Envelope with { list, total_biaya })
  it('GET /api/riwayat/pasien/laboratorium returns lab results with panels', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/laboratorium?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('list');
      expect(Array.isArray(data.data.list)).toBe(true);
    }
  });

  // 7. Radiologi (Envelope with { list, total_biaya } or empty array)
  it('GET /api/riwayat/pasien/radiologi returns radiology results and images', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/radiologi?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      if (Array.isArray(data.data)) {
        expect(data.data.length).toBe(0);
      } else {
        expect(data.data).toHaveProperty('list');
      }
    }
  });

  // 8. Total Tagihan (Billing summary)
  it('GET /api/riwayat/pasien/total-tagihan returns patient billing items', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/total-tagihan?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
    }
  });

  // 9. Medis Ranap (General Inpatient Initial Assessment)
  it('GET /api/riwayat/pasien/medis-ranap returns initial inpatient assessment', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/medis-ranap?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  // 10. Medis Ranap Neonatus
  it('GET /api/riwayat/pasien/medis-ranap-neonatus returns neonatal assessment', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/medis-ranap-neonatus?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  // 11. Medis Ranap Kebidanan
  it('GET /api/riwayat/pasien/medis-ranap-kebidanan returns obstetric assessment', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/medis-ranap-kebidanan?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  // 12. Medis IGD
  it('GET /api/riwayat/pasien/medis-igd returns emergency assessment', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/medis-igd?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  // 13. IGD Kebidanan (Midwife Triage)
  it('GET /api/riwayat/pasien/igd-kebidanan returns obstetric triage', async () => {
    const { res, data } = await api(
      'GET',
      `/api/riwayat/pasien/igd-kebidanan?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  // ── EDGE CASES ──────────────────────────────────────────────────────
  it('Missing no_rawat query parameter returns 400 on all riwayat endpoints', async () => {
    const endpoints = [
      '/api/riwayat/pasien/soap-ranap',
      '/api/riwayat/pasien/soap-ralan',
      '/api/riwayat/pasien/diagnosa',
      '/api/riwayat/pasien/prosedur',
      '/api/riwayat/pasien/pemberian-obat',
      '/api/riwayat/pasien/laboratorium',
      '/api/riwayat/pasien/radiologi',
      '/api/riwayat/pasien/total-tagihan',
    ];

    for (const ep of endpoints) {
      const { res } = await api('GET', ep, doctorToken);
      expect(res.status).toBe(400);
    }
  });

  it('Nonexistent patient registration returns 200/204 empty without crashing', async () => {
    const { res } = await api(
      'GET',
      '/api/riwayat/pasien/soap-ranap?no_rawat=9999/99/99/999999',
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });
});
