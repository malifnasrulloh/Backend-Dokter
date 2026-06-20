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
              pr.no_rawat,
              pr.tgl_perawatan,
              pr.jam_rawat,
              pr.keluhan AS situation,
              pr.pemeriksaan AS background,
              pr.penilaian AS assesment,
              pr.rtl AS recommendation,
              pr.evaluasi,
              pr.nip,
              perawat.nama AS nip_nama,
              dokter.kd_dokter AS doc_creator_nik,
              dokter.nm_dokter AS doc_creator_name,
              dpjp.kd_dokter AS dpjp_nik,
              dokter_dpjp.nama AS dpjp_name
          FROM pemeriksaan_ranap pr
          LEFT JOIN pegawai perawat ON pr.nip = perawat.nik
          LEFT JOIN dokter ON pr.nip = dokter.kd_dokter
          LEFT JOIN (
              SELECT no_rawat, MIN(kd_dokter) AS kd_dokter 
              FROM dpjp_ranap 
              GROUP BY no_rawat
          ) dpjp ON pr.no_rawat = dpjp.no_rawat
          LEFT JOIN pegawai dokter_dpjp ON dpjp.kd_dokter = dokter_dpjp.nik
          WHERE pr.no_rawat = ?
          ORDER BY pr.tgl_perawatan DESC, pr.jam_rawat DESC
      `;

  const [rows] = await db.query(query, [req.query.no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const result = rows.map((row) => {
    const docNik = row.doc_creator_nik || row.dpjp_nik;
    const docName = row.doc_creator_name || row.dpjp_name;

    let status_validasi = row.doc_creator_nik ? 'Validasi' : null;
    let tgl_validasi = row.doc_creator_nik ? dayjs(row.tgl_perawatan).format('YYYY-MM-DD') : null;
    let jam_validasi = row.doc_creator_nik ? row.jam_rawat : null;

    if (row.evaluasi) {
      const match = row.evaluasi.match(/\[Validasi:\s*([^|]+)\|\s*([^|]+)\|\s*([^\]]+)\]/);
      if (match) {
        status_validasi = 'Validasi';
        tgl_validasi = dayjs(match[2].trim()).format('YYYY-MM-DD');
        jam_validasi = match[3].trim();
      }
    }

    return {
      no_rawat: row.no_rawat,
      tgl_perawatan: row.tgl_perawatan ? dayjs(row.tgl_perawatan).format('YYYY-MM-DD') : null,
      jam_rawat: row.jam_rawat,
      situation: row.situation,
      background: row.background,
      assesment: row.assesment,
      recommendation: row.recommendation,
      petugas: {
        nik: row.nip,
        nama: row.nip_nama,
      },
      dokter: {
        nik: docNik,
        nama: docName,
      },
      validasi: {
        status_validasi: status_validasi,
        tgl_validasi: tgl_validasi,
        jam_validasi: jam_validasi,
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
  const { no_rawat, tgl_perawatan, jam_rawat, nik } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat, nik };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const data = req.body;

  const [checkResult] = await db.query(
    'SELECT evaluasi FROM pemeriksaan_ranap WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?',
    [no_rawat, tgl_perawatan, jam_rawat]
  );

  if (checkResult.length === 0) {
    return response.noContent(res);
  }

  const currentEvaluasi = checkResult[0].evaluasi || '';
  let newEvaluasi = currentEvaluasi.replace(/\[Validasi:\s*[^\]]+\]/g, '').trim();
  const today = dayjs().format('YYYY-MM-DD');
  const now = dayjs().format('HH:mm:ss');
  newEvaluasi = (newEvaluasi ? newEvaluasi + '\n' : '') + `[Validasi: ${nik} | ${today} | ${now}]`;

  const [result] = await db.query(
    'UPDATE pemeriksaan_ranap SET evaluasi = ? WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?',
    [newEvaluasi, no_rawat, tgl_perawatan, jam_rawat]
  );

  if (result.affectedRows === 0) {
    return response.failedSave(res);
  }

  return response.created(res, data);
};

exports.getPemeriksaanByDokter = async (req, res) => {
  const { kd_dokter } = req.query;

  const queryParams = { kd_dokter };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const query = `
          SELECT
            pr.no_rawat,
            pr.tgl_perawatan,
            pr.jam_rawat,
            pr.keluhan AS situation,
            pr.pemeriksaan AS background,
            pr.penilaian AS assesment,
            pr.rtl AS recommendation,
            pr.evaluasi,
            pr.nip,
            perawat.nama AS nip_nama,
            dokter.kd_dokter AS doc_creator_nik,
            dokter.nm_dokter AS doc_creator_name,
            ? AS kd_dokter,
            dokter_dpjp.nama AS kd_dokter_nama
          FROM
            pemeriksaan_ranap AS pr
            LEFT JOIN
            pegawai AS perawat
            ON
              pr.nip = perawat.nik
            LEFT JOIN
            dokter
            ON
              pr.nip = dokter.kd_dokter
            INNER JOIN
            dpjp_ranap AS dpjp
            ON
              pr.no_rawat = dpjp.no_rawat
            LEFT JOIN
            pegawai AS dokter_dpjp
            ON
              dpjp.kd_dokter = dokter_dpjp.nik
            INNER JOIN
            kamar_inap
            ON
              pr.no_rawat = kamar_inap.no_rawat
          WHERE
            dpjp.kd_dokter = ? AND
            kamar_inap.stts_pulang = '-'
          ORDER BY
            pr.no_rawat DESC,
            pr.tgl_perawatan DESC,
            pr.jam_rawat DESC
      `;

  const [rows] = await db.query(query, [req.query.kd_dokter, req.query.kd_dokter]);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const result = rows.map((row) => {
    const docNik = row.doc_creator_nik || row.kd_dokter;
    const docName = row.doc_creator_name || row.kd_dokter_nama;

    let status_validasi = row.doc_creator_nik ? 'Validasi' : null;
    let tgl_validasi = row.doc_creator_nik ? dayjs(row.tgl_perawatan).format('YYYY-MM-DD') : null;
    let jam_validasi = row.doc_creator_nik ? row.jam_rawat : null;

    if (row.evaluasi) {
      const match = row.evaluasi.match(/\[Validasi:\s*([^|]+)\|\s*([^|]+)\|\s*([^\]]+)\]/);
      if (match) {
        status_validasi = 'Validasi';
        tgl_validasi = dayjs(match[2].trim()).format('YYYY-MM-DD');
        jam_validasi = match[3].trim();
      }
    }

    return {
      no_rawat: row.no_rawat,
      tgl_perawatan: row.tgl_perawatan ? dayjs(row.tgl_perawatan).format('YYYY-MM-DD') : null,
      jam_rawat: row.jam_rawat,
      situation: row.situation,
      background: row.background,
      assesment: row.assesment,
      recommendation: row.recommendation,
      petugas: {
        nik: row.nip,
        nama: row.nip_nama,
      },
      dokter: {
        nik: docNik,
        nama: docName,
      },
      validasi: {
        status_validasi: status_validasi,
        tgl_validasi: tgl_validasi,
        jam_validasi: jam_validasi,
      },
    };
  });

  return response.ok(res, result);
};

