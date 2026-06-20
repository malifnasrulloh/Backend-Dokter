const db = require('../../../config/db');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');

exports.getKebidananIgd = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const [kebidanan] = await db.query(
      `
      SELECT igd.*, pg.nama AS nama_petugas
      FROM penilaian_awal_keperawatan_kebidanan igd
      LEFT JOIN pegawai pg ON igd.nip = pg.nik
      WHERE igd.no_rawat = ?
    `,
      [no_rawat]
    );

    const firstKebidanan = kebidanan[0] || null;

    let masalah_kebidanan = [];
    let rencana_kebidanan = [];

    if (firstKebidanan) {
      if (firstKebidanan.masalah) {
        masalah_kebidanan = firstKebidanan.masalah
          .split(/,|\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
      if (firstKebidanan.tindakan) {
        rencana_kebidanan = firstKebidanan.tindakan
          .split(/,|\n/)
          .map((item) => item.trim())
          .filter(Boolean);
      }
    }

    const result = {
      kebidanan: firstKebidanan,
      masalah_kebidanan,
      rencana_kebidanan,
    };

    return response.ok(res, result);
  } catch (err) {
    return response.internalError(req, res, err);
  }
};

