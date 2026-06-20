const db = require('../../../config/db');
const dayjs = require('dayjs');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');

exports.getRiwayatSbar = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const sql = `
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
      pegawai.nama,
      dokter.kd_dokter AS doc_creator_nik,
      dokter.nm_dokter AS doc_creator_name,
      dpjp.kd_dokter AS dpjp_nik,
      dokter_dpjp.nama AS dpjp_name
    FROM
      pemeriksaan_ranap pr
      INNER JOIN pegawai ON pr.nip = pegawai.nik
      LEFT JOIN dokter ON pr.nip = dokter.kd_dokter
      LEFT JOIN (
          SELECT no_rawat, MIN(kd_dokter) AS kd_dokter 
          FROM dpjp_ranap 
          GROUP BY no_rawat
      ) dpjp ON pr.no_rawat = dpjp.no_rawat
      LEFT JOIN pegawai AS dokter_dpjp ON dpjp.kd_dokter = dokter_dpjp.nik
    WHERE
      pr.no_rawat = ?
    ORDER BY
      pr.tgl_perawatan ASC,
      pr.jam_rawat ASC
  `;

  const [rows] = await db.query(sql, [no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const mapped = rows.map((row) => {
    const docNik = row.doc_creator_nik || row.dpjp_nik;
    const docName = row.doc_creator_name || row.dpjp_name;

    let status_validasi = row.doc_creator_nik ? 'Validasi' : null;
    let tgl_validasi = row.doc_creator_nik ? dayjs(row.tgl_perawatan).format('YYYY-MM-DD') : null;
    let jam_validasi = row.doc_creator_nik ? row.jam_rawat : null;
    let nik_validator = row.doc_creator_nik ? row.doc_creator_nik : null;
    let namavalidator = row.doc_creator_nik ? row.doc_creator_name : row.dpjp_name;

    if (row.evaluasi) {
      const match = row.evaluasi.match(/\[Validasi:\s*([^|]+)\|\s*([^|]+)\|\s*([^\]]+)\]/);
      if (match) {
        status_validasi = 'Validasi';
        nik_validator = match[1].trim();
        tgl_validasi = dayjs(match[2].trim()).format('YYYY-MM-DD');
        jam_validasi = match[3].trim();
      }
    }

    return {
      tgl_perawatan: row.tgl_perawatan ? dayjs(row.tgl_perawatan).format('YYYY-MM-DD') : null,
      jam_rawat: row.jam_rawat,
      situation: row.situation,
      background: row.background,
      assesment: row.assesment,
      recommendation: row.recommendation,
      nip: row.nip,
      kd_dokter: docNik,
      nama: row.nama,
      namavalidator: namavalidator,
      nik_validator: nik_validator,
      tgl_validasi: tgl_validasi,
      jam_validasi: jam_validasi,
      status_validasi: status_validasi,
    };
  });

  return response.ok(res, mapped);
};

