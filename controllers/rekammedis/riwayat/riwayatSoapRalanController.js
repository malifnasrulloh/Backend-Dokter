const db = require('../../../config/db');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');

exports.getRiwayatSoapRalan = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const query = `SELECT
          pemeriksaan_ralan.tgl_perawatan,
          pemeriksaan_ralan.jam_rawat,
          pemeriksaan_ralan.suhu_tubuh,
          pemeriksaan_ralan.tensi,
          pemeriksaan_ralan.nadi,
          pemeriksaan_ralan.respirasi,
          pemeriksaan_ralan.tinggi,
          pemeriksaan_ralan.berat,
          pemeriksaan_ralan.spo2,
          pemeriksaan_ralan.gcs,
          pemeriksaan_ralan.kesadaran,
          pemeriksaan_ralan.keluhan,
          pemeriksaan_ralan.pemeriksaan,
          pemeriksaan_ralan.alergi,
          pemeriksaan_ralan.lingkar_perut,
          pemeriksaan_ralan.rtl,
          pemeriksaan_ralan.penilaian,
          pemeriksaan_ralan.instruksi,
          pemeriksaan_ralan.evaluasi,
          pemeriksaan_ralan.nip,
          pegawai.nama,
          pegawai.jbtn
      FROM
          pemeriksaan_ralan
          INNER JOIN pegawai ON pemeriksaan_ralan.nip = pegawai.nik
          INNER JOIN reg_periksa ON pemeriksaan_ralan.no_rawat = reg_periksa.no_rawat
      WHERE
          reg_periksa.no_rkm_medis = (SELECT no_rkm_medis FROM reg_periksa WHERE no_rawat = ?)
      ORDER BY
          pemeriksaan_ralan.tgl_perawatan,
          pemeriksaan_ralan.jam_rawat`;

  const [rows] = await db.query(query, [no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }
  return response.ok(res, rows);
};
