import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const {
  DOCTOR_USER,
  RANAP_NO_RAWAT,
  RALAN_NO_RAWAT,
  TODAY,
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

describe('2. Patient Lists, Detail, Schedules & DPJP Management', () => {
  // ── INPATIENT LIST ──────────────────────────────────────────────────
  it('GET /api/list-pasien-ranap with tglmasuk filter returns list', async () => {
    const { res, data } = await api(
      'GET',
      `/api/list-pasien-ranap?tglmasuk=true&tglawal=2022-01-01&tglakhir=${TODAY}&statusbayar=Semua`,
      doctorToken
    );
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    if (data.data.length > 0) {
      const patient = data.data[0];
      expect(patient).toHaveProperty('no_rawat');
      expect(patient).toHaveProperty('nm_pasien');
      expect(patient).toHaveProperty('kamar');
    }
  });

  it('GET /api/list-pasien-ranap with belumpulang=true returns active inpatients', async () => {
    const { res, data } = await api(
      'GET',
      `/api/list-pasien-ranap?belumpulang=true&statusbayar=Semua`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });

  it('GET /api/list-pasien-ranap with missing filter flag returns 400 Bad Request', async () => {
    const { res, data } = await api('GET', '/api/list-pasien-ranap?statusbayar=Semua', doctorToken);
    expect(res.status).toBe(400);
    expect(data.message).toContain('filter');
  });

  it('GET /api/list-pasien-ranap with invalid date format returns 400', async () => {
    const { res, data } = await api(
      'GET',
      '/api/list-pasien-ranap?tglmasuk=true&tglawal=invalid-date&tglakhir=bad-date&statusbayar=Semua',
      doctorToken
    );
    expect(res.status).toBe(400);
    expect(data.message).toContain('YYYY-MM-DD');
  });

  // ── OUTPATIENT LIST ─────────────────────────────────────────────────
  it('GET /api/list-pasien-ralan with date range returns outpatients', async () => {
    const { res, data } = await api(
      'GET',
      `/api/list-pasien-ralan?tglawal=2026-08-01&tglakhir=${TODAY}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    }
  });

  it('GET /api/list-pasien-ralan missing dates returns 400', async () => {
    const { res } = await api('GET', '/api/list-pasien-ralan', doctorToken);
    expect(res.status).toBe(400);
  });

  it('GET /api/list-pasien-ralan invalid date returns 400', async () => {
    const { res } = await api(
      'GET',
      '/api/list-pasien-ralan?tglawal=not-a-date&tglakhir=also-not-a-date',
      doctorToken
    );
    expect(res.status).toBe(400);
  });

  // ── IGD LIST ────────────────────────────────────────────────────────
  it('GET /api/list-pasien-igd with date range returns IGD patients', async () => {
    const { res } = await api(
      'GET',
      `/api/list-pasien-igd?tglawal=2022-01-01&tglakhir=${TODAY}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  it('GET /api/list-pasien-igd missing dates returns 400', async () => {
    const { res } = await api('GET', '/api/list-pasien-igd', doctorToken);
    expect(res.status).toBe(400);
  });

  // ── PATIENT DETAIL (cari-by-rawat) ──────────────────────────────────
  it('GET /api/pasien/cari-by-rawat returns lightweight patient detail', async () => {
    const { res, data } = await api(
      'GET',
      `/api/pasien/cari-by-rawat?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
      doctorToken
    );
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.no_rawat).toBe(RANAP_NO_RAWAT);
    expect(data.data.nm_pasien).toBeDefined();
    expect(data.data._type).toBe('Ranap');
  });

  it('GET /api/pasien/cari-by-rawat for nonexistent patient returns 200/204 empty', async () => {
    const { res, data } = await api(
      'GET',
      '/api/pasien/cari-by-rawat?no_rawat=9999/99/99/999999',
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(Array.isArray(data.data) ? data.data.length === 0 : !data.data).toBe(true);
    }
  });

  it('GET /api/pasien/cari-by-rawat missing query param returns 400', async () => {
    const { res } = await api('GET', '/api/pasien/cari-by-rawat', doctorToken);
    expect(res.status).toBe(400);
  });

  // ── SCHEDULES & BED ─────────────────────────────────────────────────
  it('GET /api/jadwal/operasi returns operation schedule', async () => {
    const { res } = await api(
      'GET',
      `/api/jadwal/operasi?tglawal=2022-01-01&tglakhir=${TODAY}`,
      doctorToken
    );
    expect([200, 204]).toContain(res.status);
  });

  it('GET /api/jadwal/bed returns room/bed availability list', async () => {
    const { res, data } = await api('GET', '/api/jadwal/bed', doctorToken);
    expect([200, 204]).toContain(res.status);
    if (res.status === 200) {
      expect(data.success).toBe(true);
      expect(typeof data.data).toBe('object');
    }
  });

  // ── DOCTOR PROFILE ──────────────────────────────────────────────────
  it('GET /api/profile returns doctor details', async () => {
    const { res, data } = await api('GET', '/api/profile', doctorToken);
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveProperty('nik');
    expect(data.data).toHaveProperty('nama');
  });

  // ── DPJP RANAP CRUD ─────────────────────────────────────────────────
  describe('DPJP Ranap Management', () => {
    it('GET /api/dpjp-ranap returns assigned DPJP doctors', async () => {
      const { res, data } = await api(
        'GET',
        `/api/dpjp-ranap?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
    });

    it('POST /api/dpjp-ranap assigns doctor as DPJP', async () => {
      const { res, data } = await api('POST', '/api/dpjp-ranap', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        kd_dokter: [DOCTOR_USER.username],
      });
      expect([200, 201]).toContain(res.status);
    });

    it('PUT /api/dpjp-ranap updates DPJP assignment list', async () => {
      const { res } = await api('PUT', '/api/dpjp-ranap', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        kd_dokter: [DOCTOR_USER.username],
      });
      expect([200, 201]).toContain(res.status);
    });

    it('POST /api/dpjp-ranap validation error with non-array kd_dokter', async () => {
      const { res } = await api('POST', '/api/dpjp-ranap', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        kd_dokter: 'not-an-array',
      });
      expect(res.status).toBe(400);
    });

    it('DELETE /api/dpjp-ranap removes doctor from DPJP assignment', async () => {
      const { res } = await api('DELETE', '/api/dpjp-ranap', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        kd_dokter: DOCTOR_USER.username,
      });
      expect([200, 204]).toContain(res.status);
    });
  });
});
