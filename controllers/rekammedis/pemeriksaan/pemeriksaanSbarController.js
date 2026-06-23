const db = require('../../../config/db');
const dayjs = require('dayjs');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');

exports.getPemeriksaanById = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const query = `
          SELECT
              kp.no_permintaan,
              kp.no_rawat,
              kp.tanggal,
              kp.nip,
              perawat.nama AS nip_nama,
              kp.kd_dokter_dikonsuli AS doc_creator_nik,
              dokter.nm_dokter AS doc_creator_name,
              kp.situation,
              kp.background,
              kp.assessment,
              kp.recomendation AS recommendation,
              jkp.tanggal AS tgl_jawab,
              jkp.respon,
              jkp.instruksi,
              jkp.rencana
          FROM konsultasi_perawat kp
          LEFT JOIN pegawai perawat ON kp.nip = perawat.nik
          LEFT JOIN dokter ON kp.kd_dokter_dikonsuli = dokter.kd_dokter
          LEFT JOIN jawaban_konsultasi_perawat jkp ON kp.no_permintaan = jkp.no_permintaan
          WHERE kp.no_rawat = ?
          ORDER BY kp.tanggal DESC
      `;

  const [rows] = await db.query(query, [req.query.no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const result = rows.map((row) => {
    const isAnswered = row.tgl_jawab !== null;

    let status_validasi = isAnswered ? 'Validasi' : null;
    let tgl_validasi = isAnswered ? dayjs(row.tgl_jawab).format('YYYY-MM-DD') : null;
    let jam_validasi = isAnswered ? dayjs(row.tgl_jawab).format('HH:mm:ss') : null;

    return {
      no_permintaan: row.no_permintaan,
      no_rawat: row.no_rawat,
      tgl_perawatan: row.tanggal ? dayjs(row.tanggal).format('YYYY-MM-DD') : null,
      jam_rawat: row.tanggal ? dayjs(row.tanggal).format('HH:mm:ss') : null,
      situation: row.situation,
      background: row.background,
      assesment: row.assessment,
      recommendation: row.recommendation,
      petugas: {
        nik: row.nip,
        nama: row.nip_nama,
      },
      dokter: {
        nik: row.doc_creator_nik,
        nama: row.doc_creator_name,
      },
      validasi: {
        status_validasi: status_validasi,
        tgl_validasi: tgl_validasi,
        jam_validasi: jam_validasi,
        respon: row.respon || '',
        instruksi: row.instruksi || '',
        rencana: row.rencana || '',
      },
    };
  });

  return response.ok(res, result);
};

exports.createPemeriksaan = async (req, res) => {
  let {
    no_rawat,
    situation,
    background,
    assesment,
    recommendation,
    nip,
    tgl_perawatan,
    jam_rawat,
  } = req.body;

  if (!tgl_perawatan || tgl_perawatan.trim() === '') {
    tgl_perawatan = dayjs().format('YYYY-MM-DD');
  }

  if (!jam_rawat || jam_rawat.trim() === '') {
    jam_rawat = dayjs().format('HH:mm:ss');
  }

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat, nip };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const data = req.body;

  const [result] = await db.query(
    `INSERT INTO pemeriksaan_ranap (
      no_rawat, tgl_perawatan, jam_rawat, 
      suhu_tubuh, tensi, nadi, respirasi, tinggi, berat, spo2, gcs, kesadaran,
      keluhan, pemeriksaan, penilaian, rtl, alergi, instruksi, evaluasi, nip
    ) VALUES (
      ?, ?, ?, 
      '-', '-', '-', '-', '-', '-', '-', '-', 'Compos Mentis',
      ?, ?, ?, ?, '-', '-', '', ?
    )`,
    [
      no_rawat,
      tgl_perawatan,
      jam_rawat,
      situation,
      background,
      assesment,
      recommendation,
      nip,
    ]
  );

  if (result.affectedRows === 0) {
    return response.failedSave(res);
  }

  return response.created(res, data);
};

exports.updatePemeriksaan = async (req, res) => {
  const {
    no_rawat,
    situation,
    background,
    assesment,
    recommendation,
    nip,
    tgl_perawatan,
    jam_rawat,
  } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat, nip };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const data = req.body;

  const [result] = await db.query(
    'UPDATE pemeriksaan_ranap SET keluhan = ?, pemeriksaan = ?, penilaian = ?, rtl = ?, nip = ? WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?',
    [
      situation,
      background,
      assesment,
      recommendation,
      nip,
      no_rawat,
      tgl_perawatan,
      jam_rawat,
    ]
  );

  if (result.affectedRows === 0) {
    return response.failedUpdate(res);
  }

  return response.ok(res, data);
};

exports.deletePemeriksaan = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const data = req.body;

  const [result] = await db.query(
    'DELETE FROM pemeriksaan_ranap WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?',
    [no_rawat, tgl_perawatan, jam_rawat]
  );

  if (result.affectedRows === 0) {
    return response.failedDelete(res);
  }

  return response.ok(res, data);
};

exports.validasiPemeriksaan = async (req, res) => {
  const { no_permintaan, no_rawat, tgl_perawatan, jam_rawat, nik, respon, instruksi, rencana } = req.body;

  let targetNoPermintaan = no_permintaan;
  if (!targetNoPermintaan && no_rawat && tgl_perawatan && jam_rawat) {
    const formattedDateTime = `${tgl_perawatan} ${jam_rawat}`;
    const [kpRows] = await db.query(
      'SELECT no_permintaan FROM konsultasi_perawat WHERE no_rawat = ? AND tanggal = ?',
      [no_rawat, formattedDateTime]
    );
    if (kpRows.length > 0) {
      targetNoPermintaan = kpRows[0].no_permintaan;
    }
  }

  if (!targetNoPermintaan) {
    return response.badRequest(res, 'no_permintaan tidak ditemukan');
  }

  const [checkResult] = await db.query(
    'SELECT no_permintaan FROM jawaban_konsultasi_perawat WHERE no_permintaan = ?',
    [targetNoPermintaan]
  );

  const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
  const responVal = respon || '';
  const instruksiVal = instruksi || '';
  const rencanaVal = rencana || '';

  let result;
  if (checkResult.length > 0) {
    [result] = await db.query(
      'UPDATE jawaban_konsultasi_perawat SET tanggal = ?, respon = ?, instruksi = ?, rencana = ? WHERE no_permintaan = ?',
      [now, responVal, instruksiVal, rencanaVal, targetNoPermintaan]
    );
  } else {
    [result] = await db.query(
      'INSERT INTO jawaban_konsultasi_perawat (no_permintaan, tanggal, respon, instruksi, rencana) VALUES (?, ?, ?, ?, ?)',
      [targetNoPermintaan, now, responVal, instruksiVal, rencanaVal]
    );
  }

  if (result.affectedRows === 0) {
    return response.failedSave(res);
  }

  return response.created(res, { no_permintaan: targetNoPermintaan, tanggal: now, respon: responVal, instruksi: instruksiVal, rencana: rencanaVal });
};

exports.getPemeriksaanByDokter = async (req, res) => {
  const { kd_dokter } = req.query;

  const queryParams = { kd_dokter };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const query = `
          SELECT
              kp.no_permintaan,
              kp.no_rawat,
              kp.tanggal,
              kp.nip,
              perawat.nama AS nip_nama,
              kp.kd_dokter_dikonsuli AS doc_creator_nik,
              dokter.nm_dokter AS doc_creator_name,
              kp.situation,
              kp.background,
              kp.assessment,
              kp.recomendation AS recommendation,
              jkp.tanggal AS tgl_jawab,
              jkp.respon,
              jkp.instruksi,
              jkp.rencana
          FROM konsultasi_perawat kp
          LEFT JOIN pegawai perawat ON kp.nip = perawat.nik
          LEFT JOIN dokter ON kp.kd_dokter_dikonsuli = dokter.kd_dokter
          LEFT JOIN jawaban_konsultasi_perawat jkp ON kp.no_permintaan = jkp.no_permintaan
          INNER JOIN kamar_inap ki ON kp.no_rawat = ki.no_rawat
          WHERE kp.kd_dokter_dikonsuli = ?
            AND ki.stts_pulang = '-'
          ORDER BY kp.tanggal DESC
      `;

  const [rows] = await db.query(query, [req.query.kd_dokter]);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const result = rows.map((row) => {
    const isAnswered = row.tgl_jawab !== null;

    let status_validasi = isAnswered ? 'Validasi' : null;
    let tgl_validasi = isAnswered ? dayjs(row.tgl_jawab).format('YYYY-MM-DD') : null;
    let jam_validasi = isAnswered ? dayjs(row.tgl_jawab).format('HH:mm:ss') : null;

    return {
      no_permintaan: row.no_permintaan,
      no_rawat: row.no_rawat,
      tgl_perawatan: row.tanggal ? dayjs(row.tanggal).format('YYYY-MM-DD') : null,
      jam_rawat: row.tanggal ? dayjs(row.tanggal).format('HH:mm:ss') : null,
      situation: row.situation,
      background: row.background,
      assesment: row.assessment,
      recommendation: row.recommendation,
      petugas: {
        nik: row.nip,
        nama: row.nip_nama,
      },
      dokter: {
        nik: row.doc_creator_nik,
        nama: row.doc_creator_name,
      },
      validasi: {
        status_validasi: status_validasi,
        tgl_validasi: tgl_validasi,
        jam_validasi: jam_validasi,
        respon: row.respon || '',
        instruksi: row.instruksi || '',
        rencana: row.rencana || '',
      },
    };
  });

  return response.ok(res, result);
};

