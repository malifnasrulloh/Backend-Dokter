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

describe('3. Clinical Mutations & Transactions', () => {
  // ── SOAP RANAP ──────────────────────────────────────────────────────
  describe('SOAP Ranap Lifecycle', () => {
    const soapRanapPayload = {
      no_rawat: RANAP_NO_RAWAT,
      tgl_perawatan: TODAY,
      jam_rawat: '11:11:11',
      keluhan: 'Keluhan nyeri perut berkurang',
      pemeriksaan: 'Abdomen supel, bising usus normal',
      penilaian: 'Post op appendectomy H+2 baik',
      rtl: 'Terapi oral lanjut, mobilisasi bertahap',
      instruksi: 'Observasi TTV tiap 4 jam',
      evaluasi: 'Pasien merasa lebih nyaman',
      suhu_tubuh: '36.6',
      tensi: '120/75',
      nadi: '76',
      respirasi: '18',
      tinggi: '165',
      berat: '60',
      spo2: '99',
      gcs: '15',
      kesadaran: 'Compos Mentis',
      nip: DOCTOR_USER.username,
    };

    it('POST /api/soap/ranap creates SOAP record', async () => {
      const { res, data } = await api('POST', '/api/soap/ranap', doctorToken, soapRanapPayload);
      expect([200, 201]).toContain(res.status);
      expect(data.success).toBe(true);
    });

    it('PUT /api/soap/ranap updates the SOAP record', async () => {
      const updated = {
        ...soapRanapPayload,
        keluhan: 'Keluhan nyeri minimal, skala 1/10',
        evaluasi: 'Kondisi stabil, siap rawat jalan',
      };
      const { res, data } = await api('PUT', '/api/soap/ranap', doctorToken, updated);
      expect([200, 201]).toContain(res.status);
      expect(data.success).toBe(true);
    });

    it('DELETE /api/soap/ranap removes the SOAP record', async () => {
      const { res, data } = await api('DELETE', '/api/soap/ranap', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        tgl_perawatan: TODAY,
        jam_rawat: '11:11:11',
      });
      expect([200, 204]).toContain(res.status);
    });

    it('POST /api/soap/ranap missing required fields returns 400', async () => {
      const { res } = await api('POST', '/api/soap/ranap', doctorToken, {
        keluhan: 'without no_rawat and keys',
      });
      expect(res.status).toBe(400);
    });
  });

  // ── SOAP RALAN ──────────────────────────────────────────────────────
  describe('SOAP Ralan Lifecycle', () => {
    const soapRalanPayload = {
      no_rawat: RALAN_NO_RAWAT,
      tgl_perawatan: TODAY,
      jam_rawat: '12:12:12',
      keluhan: 'Kontrol rutin post rawat',
      pemeriksaan: 'Luka operasi kering, tidak ada tanda infeksi',
      penilaian: 'Pemulihan pasca bedah baik',
      rtl: 'Aff jahitan selang 3 hari',
      instruksi: 'Jaga kebersihan luka, hindari basah',
      evaluasi: 'Kondisi memuaskan',
      suhu_tubuh: '36.4',
      tensi: '118/78',
      nadi: '72',
      respirasi: '16',
      tinggi: '165',
      berat: '60',
      spo2: '99',
      gcs: '15',
      kesadaran: 'Compos Mentis',
      lingkar_perut: '78',
      nip: DOCTOR_USER.username,
    };

    it('POST /api/soap/ralan creates outpatient SOAP record', async () => {
      const { res, data } = await api('POST', '/api/soap/ralan', doctorToken, soapRalanPayload);
      expect([200, 201]).toContain(res.status);
      expect(data.success).toBe(true);
    });

    it('PUT /api/soap/ralan updates outpatient SOAP record', async () => {
      const updated = {
        ...soapRalanPayload,
        keluhan: 'Kontrol rutin - tidak ada keluhan sama sekali',
      };
      const { res, data } = await api('PUT', '/api/soap/ralan', doctorToken, updated);
      expect([200, 201]).toContain(res.status);
      expect(data.success).toBe(true);
    });

    it('DELETE /api/soap/ralan deletes outpatient SOAP record', async () => {
      const { res } = await api('DELETE', '/api/soap/ralan', doctorToken, {
        no_rawat: RALAN_NO_RAWAT,
        tgl_perawatan: TODAY,
        jam_rawat: '12:12:12',
      });
      expect([200, 204]).toContain(res.status);
    });
  });

  // ── SBAR PEMERIKSAAN ────────────────────────────────────────────────
  describe('SBAR Pemeriksaan Lifecycle', () => {
    const sbarPayload = {
      no_rawat: RANAP_NO_RAWAT,
      tgl_perawatan: TODAY,
      jam_rawat: '13:13:13',
      situation: 'Pasien mengeluh sesak napas mendadak',
      background: 'Riwayat PPOK, terpasang nasal kanul 3 lpm',
      assesment: 'Eksaserbasi akut PPOK',
      recommendation: 'Inhalasi combivent 1 ampul, naikkan O2 ke 4 lpm',
      nip: DOCTOR_USER.username,
    };

    it('POST /api/pemeriksaan creates SBAR note', async () => {
      const { res, data } = await api('POST', '/api/pemeriksaan', doctorToken, sbarPayload);
      expect([200, 201]).toContain(res.status);
      expect(data.success).toBe(true);
    });

    it('PUT /api/pemeriksaan updates SBAR note', async () => {
      const updated = {
        ...sbarPayload,
        recommendation: 'Inhalasi combivent + pulmicort, cek BGA',
      };
      const { res, data } = await api('PUT', '/api/pemeriksaan', doctorToken, updated);
      expect([200, 201]).toContain(res.status);
    });

    it('DELETE /api/pemeriksaan deletes SBAR note', async () => {
      const { res } = await api('DELETE', '/api/pemeriksaan', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        tgl_perawatan: TODAY,
        jam_rawat: '13:13:13',
      });
      expect([200, 204]).toContain(res.status);
    });

    it('GET /api/pemeriksaan returns SBAR list for patient', async () => {
      const { res, data } = await api(
        'GET',
        `/api/pemeriksaan?no_rawat=${encodeURIComponent(RANAP_NO_RAWAT)}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
    });

    it('GET /api/pemeriksaan/dokter returns doctor inbox', async () => {
      const { res, data } = await api(
        'GET',
        `/api/pemeriksaan/dokter?kd_dokter=${DOCTOR_USER.username}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
    });

    it('POST /api/pemeriksaan/validasi fails with 400 when no_permintaan is missing', async () => {
      const { res } = await api('POST', '/api/pemeriksaan/validasi', doctorToken, {
        respon: 'Sudah divalidasi oleh DPJP',
        instruksi: 'Lanjutkan terapi',
      });
      expect(res.status).toBe(400);
    });
  });

  // ── DIAGNOSIS & PROCEDURE MUTATIONS ─────────────────────────────────
  describe('Diagnosa & Prosedur Management', () => {
    it('GET /api/diagnosa-prosedur/penyakit searches diseases by keyword', async () => {
      const { res, data } = await api(
        'GET',
        '/api/diagnosa-prosedur/penyakit?keyword=asma',
        doctorToken
      );
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.list.length).toBeGreaterThan(0);
      expect(data.data.list[0]).toHaveProperty('kd_penyakit');
    });

    it('GET /api/diagnosa-prosedur/icd9 searches procedures by keyword', async () => {
      const { res, data } = await api(
        'GET',
        '/api/diagnosa-prosedur/icd9?keyword=ultrasound',
        doctorToken
      );
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.list.length).toBeGreaterThan(0);
      expect(data.data.list[0]).toHaveProperty('kode');
    });

    it('POST + DELETE diagnosis lifecycle', async () => {
      const diagBody = {
        no_rawat: RANAP_NO_RAWAT,
        kd_penyakit: 'J45',
        status: 'Ralan',
        prioritas: '1',
      };
      const { res: createRes } = await api(
        'POST',
        '/api/diagnosa-prosedur/diagnosa',
        doctorToken,
        diagBody
      );
      expect([200, 201, 409]).toContain(createRes.status);

      const { res: deleteRes } = await api(
        'DELETE',
        '/api/diagnosa-prosedur/diagnosa',
        doctorToken,
        diagBody
      );
      expect([200, 204, 404]).toContain(deleteRes.status);
    });

    it('POST + DELETE procedure lifecycle', async () => {
      const procBody = {
        no_rawat: RANAP_NO_RAWAT,
        kode: '01.01',
        status: 'Ralan',
        prioritas: '1',
      };
      const { res: createRes } = await api(
        'POST',
        '/api/diagnosa-prosedur/prosedur',
        doctorToken,
        procBody
      );
      expect([200, 201, 409]).toContain(createRes.status);

      const { res: deleteRes } = await api(
        'DELETE',
        '/api/diagnosa-prosedur/prosedur',
        doctorToken,
        procBody
      );
      expect([200, 204, 404]).toContain(deleteRes.status);
    });
  });

  // ── RESEP (PRESCRIPTIONS) ───────────────────────────────────────────
  describe('Prescription Management', () => {
    let createdNoResep;

    it('GET /api/resep/obat-list searches active medicines', async () => {
      const { res, data } = await api(
        'GET',
        '/api/resep/obat-list?keyword=paracetamol',
        doctorToken
      );
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.list)).toBe(true);
    });

    it('POST /api/resep creates a prescription with medicine items in transaction', async () => {
      // Find a real medicine from DB to use
      const { data: obatList } = await api('GET', '/api/resep/obat-list?keyword=a', doctorToken);

      const firstObat = obatList?.data?.list?.[0] || {
        kode_brng: 'OBT001',
        jml: 10,
        aturan_pakai: '3x1 sesudah makan',
      };

      const resepBody = {
        no_rawat: RANAP_NO_RAWAT,
        status: 'ranap',
        items: [
          {
            kode_brng: firstObat.kode_brng,
            jml: 10,
            aturan_pakai: '3x1 sesudah makan',
          },
        ],
      };

      const { res, data } = await api('POST', '/api/resep', doctorToken, resepBody);
      expect([200, 201]).toContain(res.status);
      if (res.status === 200 || res.status === 201) {
        expect(data.success).toBe(true);
        expect(data.data.no_resep).toBeDefined();
        createdNoResep = data.data.no_resep;
      }
    });

    it('POST /api/resep with empty items array returns error', async () => {
      const { res } = await api('POST', '/api/resep', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        status: 'ranap',
        items: [],
      });
      expect([400, 500]).toContain(res.status);
    });

    it('DELETE /api/resep/:no_resep deletes the created prescription', async () => {
      if (createdNoResep) {
        const { res, data } = await api(
          'DELETE',
          `/api/resep/${encodeURIComponent(createdNoResep)}`,
          doctorToken
        );
        expect([200, 204]).toContain(res.status);
      }
    });
  });

  // ── KONSULTASI (MEDICAL CONSULTATION) ────────────────────────────────
  describe('Medical Consultation Flow', () => {
    it('GET /api/konsultasi/dokter-list returns available doctors for consultation', async () => {
      const { res, data } = await api('GET', '/api/konsultasi/dokter-list', doctorToken);
      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      if (data.data.length > 0) {
        expect(data.data[0]).toHaveProperty('kd_dokter');
        expect(data.data[0]).toHaveProperty('nm_dokter');
      }
    });

    it('POST /api/konsultasi creates a medical consultation request', async () => {
      const { res, data } = await api('POST', '/api/konsultasi', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        jenis_permintaan: 'Konsultasi',
        kd_dokter_dikonsuli: '2021101713',
        diagnosa_kerja: 'Post op appendicitis dengan nyeri luka',
        uraian_konsultasi: 'Mohon evaluasi nyeri dan toleransi diet oral',
      });
      expect([200, 201]).toContain(res.status);
    });

    it('POST /api/konsultasi with invalid jenis_permintaan returns 400 Bad Request', async () => {
      const { res, data } = await api('POST', '/api/konsultasi', doctorToken, {
        no_rawat: RANAP_NO_RAWAT,
        jenis_permintaan: 'InvalidJenis',
        kd_dokter_dikonsuli: '2021101713',
        uraian_konsultasi: 'Test invalid enum',
      });
      expect(res.status).toBe(400);
      expect(data.message).toContain('jenis_permintaan');
    });

    it('GET /api/konsultasi/masuk returns incoming consultations for doctor', async () => {
      const { res } = await api(
        'GET',
        `/api/konsultasi/masuk?kd_dokter=${DOCTOR_USER.username}&tglawal=2022-01-01&tglakhir=${TODAY}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
    });

    it('GET /api/konsultasi/keluar returns outgoing consultations requested by doctor', async () => {
      const { res } = await api(
        'GET',
        `/api/konsultasi/keluar?kd_dokter=${DOCTOR_USER.username}&tglawal=2022-01-01&tglakhir=${TODAY}`,
        doctorToken
      );
      expect([200, 204]).toContain(res.status);
    });
  });
});
