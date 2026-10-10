import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const {
  startServer,
  stopServer,
  login,
  api,
  DOCTOR_USER,
  ADMIN_USER,
  RANAP_NO_RAWAT,
} = require('./helpers');
const db = require('../../config/db');

describe('SOAP Verification Endpoints (E2E)', () => {
  let doctorToken;
  let adminToken;
  const testTgl = '2026-08-24';
  const testJam = '09:00:00';

  beforeAll(async () => {
    await startServer();
    const docLogin = await login(DOCTOR_USER);
    doctorToken = docLogin.token;

    const admLogin = await login(ADMIN_USER);
    adminToken = admLogin.token;

    // Pastikan ada baris pemeriksaan_ranap untuk test di sik_temps
    await db.query(
      `
      INSERT IGNORE INTO pemeriksaan_ranap (no_rawat, tgl_perawatan, jam_rawat, suhu_tubuh, tensi, nadi, respirasi, tinggi, berat, spo2, gcs, kesadaran, keluhan, pemeriksaan, alergi, rtl, penilaian, instruksi, evaluasi, nip)
      VALUES (?, ?, ?, '36.5', '120/80', '80', '20', '165', '60', '98', '15', 'Compos Mentis', 'Keluhan test', 'Pemeriksaan test', '-', 'RTL test', 'Penilaian test', 'Instruksi test', 'Evaluasi test', '19800101')
    `,
      [RANAP_NO_RAWAT, testTgl, testJam]
    );

    // Bersihkan verifikasi sebelumnya jika ada
    await db.query(
      `
      DELETE FROM verifikasi_pemeriksaan_ranap WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?
    `,
      [RANAP_NO_RAWAT, testTgl, testJam]
    );
  });

  afterAll(async () => {
    await db.query(
      `
      DELETE FROM verifikasi_pemeriksaan_ranap WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?
    `,
      [RANAP_NO_RAWAT, testTgl, testJam]
    );
    await stopServer();
  });

  it('POST /api/soap/verifikasi fails 400 when missing parameters', async () => {
    const { res, data } = await api('POST', '/api/soap/verifikasi', adminToken, {
      no_rawat: RANAP_NO_RAWAT,
    });
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('POST /api/soap/verifikasi succeeds when called by Admin (SuperAdmin privilege)', async () => {
    const { res, data } = await api('POST', '/api/soap/verifikasi', adminToken, {
      no_rawat: RANAP_NO_RAWAT,
      tgl_perawatan: testTgl,
      jam_rawat: testJam,
      jenis: 'ranap',
      catatan: 'Terapi lanjutkan',
    });
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.catatan).toBe('Terapi lanjutkan');
  });

  it('POST /api/soap/verifikasi rejects duplicate verification with 400', async () => {
    const { res, data } = await api('POST', '/api/soap/verifikasi', adminToken, {
      no_rawat: RANAP_NO_RAWAT,
      tgl_perawatan: testTgl,
      jam_rawat: testJam,
      jenis: 'ranap',
    });
    expect(res.status).toBe(400);
    expect(data.success).toBe(false);
  });

  it('DELETE /api/soap/verifikasi rejects non-admin doctor with 403', async () => {
    const { res, data } = await api('DELETE', '/api/soap/verifikasi', doctorToken, {
      no_rawat: RANAP_NO_RAWAT,
      tgl_perawatan: testTgl,
      jam_rawat: testJam,
      jenis: 'ranap',
    });
    expect(res.status).toBe(403);
    expect(data.success).toBe(false);
  });

  it('DELETE /api/soap/verifikasi succeeds when called by Admin', async () => {
    const { res, data } = await api('DELETE', '/api/soap/verifikasi', adminToken, {
      no_rawat: RANAP_NO_RAWAT,
      tgl_perawatan: testTgl,
      jam_rawat: testJam,
      jenis: 'ranap',
    });
    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
  });

  it('POST /api/soap/verifikasi works even when ALLOW_MOBILE_WRITE is false (write exemption)', async () => {
    const prev = process.env.ALLOW_MOBILE_WRITE;
    process.env.ALLOW_MOBILE_WRITE = 'false';

    try {
      const { res, data } = await api('POST', '/api/soap/verifikasi', adminToken, {
        no_rawat: RANAP_NO_RAWAT,
        tgl_perawatan: testTgl,
        jam_rawat: testJam,
        jenis: 'ranap',
        catatan: 'Verifikasi write-exempt test',
      });
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
    } finally {
      process.env.ALLOW_MOBILE_WRITE = prev;
    }
  });
});
