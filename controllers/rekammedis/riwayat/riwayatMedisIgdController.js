const db = require('../../../config/db');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');

exports.getRiwayatMedisIgd = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const query = `SELECT
          penilaian_medis_igd.tanggal,
          penilaian_medis_igd.kd_dokter,
          penilaian_medis_igd.anamnesis,
          penilaian_medis_igd.hubungan,
          penilaian_medis_igd.keluhan_utama,
          penilaian_medis_igd.rps,
          penilaian_medis_igd.rpk,
          penilaian_medis_igd.rpd,
          penilaian_medis_igd.rpo,
          penilaian_medis_igd.alergi,
          penilaian_medis_igd.keadaan,
          penilaian_medis_igd.gcs,
          penilaian_medis_igd.kesadaran,
          penilaian_medis_igd.td,
          penilaian_medis_igd.nadi,
          penilaian_medis_igd.rr,
          penilaian_medis_igd.suhu,
          penilaian_medis_igd.spo,
          penilaian_medis_igd.bb,
          penilaian_medis_igd.tb,
          penilaian_medis_igd.kepala,
          penilaian_medis_igd.mata,
          penilaian_medis_igd.gigi,
          penilaian_medis_igd.leher,
          penilaian_medis_igd.thoraks,
          penilaian_medis_igd.abdomen,
          penilaian_medis_igd.ekstremitas,
          penilaian_medis_igd.genital,
          penilaian_medis_igd.kepala AS ket_kepala,
          penilaian_medis_igd.mata AS ket_mata,
          penilaian_medis_igd.gigi AS ket_gigi,
          penilaian_medis_igd.leher AS ket_leher,
          penilaian_medis_igd.thoraks AS ket_thorax,
          penilaian_medis_igd.abdomen AS ket_abdomen,
          penilaian_medis_igd.genital AS ket_genital,
          penilaian_medis_igd.ekstremitas AS ket_ekstremitas,
          penilaian_medis_igd.ket_lokalis,
          penilaian_medis_igd.ekg,
          penilaian_medis_igd.rad,
          penilaian_medis_igd.lab,
          penilaian_medis_igd.diagnosis,
          penilaian_medis_igd.tata,
          dokter.nm_dokter
      FROM
          penilaian_medis_igd
          INNER JOIN dokter ON penilaian_medis_igd.kd_dokter = dokter.kd_dokter
      WHERE
          penilaian_medis_igd.no_rawat = ?`;

  const [rows] = await db.query(query, [no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }
  return response.ok(res, rows);
};

