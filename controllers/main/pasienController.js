const dayjs = require('dayjs');
const { calculateAge } = require('../../utils/dateHelper');
const validateParams = require('../../middleware/validateParams');
const response = require('../../middleware/responseHandler');
const { logger } = require('../../middleware/logger');
const db = require('../../config/db');
const ref = require('../../utils/referenceCache');
const { buildSimpleOrder } = require('../../utils/paginationHelper');
const pasienRepo = require('../../repositories/pasienRepository');
const regPeriksaRepo = require('../../repositories/regPeriksaRepository');

exports.getPatients = async (req, res) => {
  const { search, address, order, limit } = req.query;
  const orderClause = buildSimpleOrder(order, 'pasien.no_rkm_medis', 'pasien.no_rkm_medis DESC');
  const safeLimit = Number.parseInt(limit, 10) || 100;

  const rows = await pasienRepo.findAll({ search, address, orderClause, limit: safeLimit });
  return response.ok(res, rows);
};

exports.getPasienByNoRm = async (req, res) => {
  const { no_rkm_medis } = req.query;

  const validateErrors = validateParams(req, res, { no_rkm_medis });
  if (validateErrors) return;

  const [results, maps] = await Promise.all([
    pasienRepo.findByNoRm(no_rkm_medis),
    ref.getAllMaps(),
  ]);

  if (results.length === 0) return response.notFound(res, 'Pasien tidak ditemukan');

  const { penjabMap, kelMap, kecMap, kabMap, propMap, sukuMap, bahasaMap, cacatMap } = maps;

  const formattedResults = results.map((item) => {
    const umur = item.tgl_lahir ? calculateAge(item.tgl_lahir) : null;
    const safeGet = (map, key) => (map && typeof map.get === 'function' ? map.get(key) : null);

    return {
      ...item,
      tgl_lahir: item.tgl_lahir ? dayjs(item.tgl_lahir).format('YYYY-MM-DD') : null,
      umur,
      png_jawab: safeGet(penjabMap, item.kd_pj),
      nm_kel: safeGet(kelMap, item.kd_kel),
      nm_kec: safeGet(kecMap, item.kd_kec),
      nm_kab: safeGet(kabMap, item.kd_kab),
      nm_prop: safeGet(propMap, item.kd_prop),
      nama_suku_bangsa: safeGet(sukuMap, item.suku_bangsa),
      nama_bahasa: safeGet(bahasaMap, item.bahasa_pasien),
      nama_cacat: safeGet(cacatMap, item.cacat_fisik),
    };
  });

  return response.ok(res, formattedResults);
};

exports.getPasienByNoRawat = async (req, res) => {
  const { no_rawat } = req.query;

  const validateErrors = validateParams(req, res, { no_rawat });
  if (validateErrors) return;

  const [results, dpjpRanapRes, bridgingSepRes, maps] = await Promise.all([
    regPeriksaRepo.findDetailByNoRawat(no_rawat),
    regPeriksaRepo.findDpjpRanap(no_rawat),
    regPeriksaRepo.findSepByNoRawat(no_rawat),
    ref.getExtendedMaps(),
  ]);

  if (results.length === 0) return response.notFound(res, 'Data pendaftaran tidak ditemukan');

  const {
    penjabMap,
    kelMap,
    kecMap,
    kabMap,
    propMap,
    sukuMap,
    bahasaMap,
    cacatMap,
    poliMap,
    dokterMap,
  } = maps;

  const kddokter_dpjp = dpjpRanapRes.map((d) => d.kd_dokter);
  const nmdokter_dpjp = dpjpRanapRes.map((d) => d.nm_dokter);
  const no_sep = bridgingSepRes[0]?.no_sep || '';

  let lastKamar = null;
  if (results[0]?.status_lanjut === 'Ranap') {
    const kelasRows = await regPeriksaRepo.findLastKelasKamar(no_rawat);
    if (kelasRows.length > 0) results[0].kelas = kelasRows[0].kelas;

    const kamarRows = await regPeriksaRepo.findLastKamar(no_rawat);
    if (kamarRows.length > 0) lastKamar = kamarRows[0].nm_bangsal;
  }

  const formattedResults = results.map((item) => {
    const safeGet = (map, key) => (map && typeof map.get === 'function' ? map.get(key) : null);

    return {
      ...item,
      dokter: safeGet(dokterMap, item.kd_dokter),
      nm_dokter: safeGet(dokterMap, item.kd_dokter),
      kamar: lastKamar || '-',
      poli: safeGet(poliMap, item.kd_poli),
      tgl_lahir: item.tgl_lahir ? dayjs(item.tgl_lahir).format('YYYY-MM-DD') : null,
      umur_sekarang: item.tgl_lahir ? calculateAge(item.tgl_lahir) : null,
      png_jawab: safeGet(penjabMap, item.kd_pj),
      nm_kel: safeGet(kelMap, item.kd_kel),
      nm_kec: safeGet(kecMap, item.kd_kec),
      nm_kab: safeGet(kabMap, item.kd_kab),
      nm_prop: safeGet(propMap, item.kd_prop),
      nama_suku_bangsa: safeGet(sukuMap, item.suku_bangsa),
      nama_bahasa: safeGet(bahasaMap, item.bahasa_pasien),
      nama_cacat: safeGet(cacatMap, item.cacat_fisik),
      png_jawab_dipasien: safeGet(penjabMap, item.kdpj_pasien),
      kddokter_dpjp,
      nmdokter_dpjp,
      no_sep,
    };
  });

  return response.ok(res, formattedResults);
};

/**
 * GET /pasien/cari-by-rawat?no_rawat=...
 * Lightweight endpoint for notification routing.
 */
exports.cariByNoRawat = async (req, res) => {
  const { no_rawat } = req.query;
  if (!no_rawat) return response.badRequest(res, 'Parameter no_rawat wajib diisi');

  try {
    const [rows] = await db.query(
      `
      SELECT
        rp.no_rawat, rp.no_rkm_medis, rp.kd_dokter,
        p.nm_pasien, rp.status_lanjut AS _type, pj.png_jawab
      FROM reg_periksa rp
      INNER JOIN pasien p ON rp.no_rkm_medis = p.no_rkm_medis
      LEFT JOIN penjab pj ON rp.kd_pj = pj.kd_pj
      WHERE rp.no_rawat = ?
      LIMIT 1
    `,
      [no_rawat]
    );

    if (rows.length === 0) return response.noContent(res, 'Data pasien tidak ditemukan');
    return response.ok(res, rows[0]);
  } catch (error) {
    logger.error('[Pasien] cariByNoRawat error:', error);
    return response.internalError(req, res, error, 'Gagal mencari data pasien');
  }
};
