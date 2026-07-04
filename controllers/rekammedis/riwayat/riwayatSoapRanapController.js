const db = require('../../../config/db');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');

exports.getRiwayatSoapRanap = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const query = `SELECT
          pemeriksaan_ranap.suhu_tubuh,
          pemeriksaan_ranap.tensi,
          pemeriksaan_ranap.nadi,
          pemeriksaan_ranap.respirasi,
          pemeriksaan_ranap.tinggi,
          pemeriksaan_ranap.berat,
          pemeriksaan_ranap.spo2,
          pemeriksaan_ranap.gcs,
          pemeriksaan_ranap.kesadaran,
          pemeriksaan_ranap.keluhan,
          pemeriksaan_ranap.penilaian,
          pemeriksaan_ranap.rtl,
          pemeriksaan_ranap.pemeriksaan,
          pemeriksaan_ranap.alergi,
          pemeriksaan_ranap.tgl_perawatan,
          pemeriksaan_ranap.jam_rawat,
          pemeriksaan_ranap.nip,
          pegawai.nama,
          pegawai.jbtn,
          pemeriksaan_ranap.instruksi,
          pemeriksaan_ranap.evaluasi
      FROM
          pemeriksaan_ranap
          INNER JOIN pegawai ON pemeriksaan_ranap.nip = pegawai.nik
          INNER JOIN reg_periksa ON pemeriksaan_ranap.no_rawat = reg_periksa.no_rawat
      WHERE
          reg_periksa.no_rkm_medis = (SELECT no_rkm_medis FROM reg_periksa WHERE no_rawat = ?)
      ORDER BY
          pemeriksaan_ranap.tgl_perawatan,
          pemeriksaan_ranap.jam_rawat`;

  const [rows] = await db.query(query, [no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }
  return response.ok(res, rows);
};
