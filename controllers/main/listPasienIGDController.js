const db = require('../../config/db');
const response = require('../../middleware/responseHandler');
const validateParams = require('../../middleware/validateParams');
const { isValidDate, calculateAge } = require('../../utils/dateHelper');
const { buildOrderClause } = require('../../utils/paginationHelper');
const regPeriksaRepo = require('../../repositories/regPeriksaRepository');

const ALIAS_MAP = {
  status_bayar: 'reg_periksa.status_bayar',
  status_periksa: 'reg_periksa.status_periksa',
  status_lanjut: 'reg_periksa.status_lanjut',
  nm_pasien: 'pasien.nm_pasien',
  nm_dokter: 'dokter.nm_dokter',
  nm_poli: 'poliklinik.nm_poli',
  no_tlp: 'pasien.no_tlp',
  tgl_lahir: 'pasien.tgl_lahir',
  no_peserta: 'pasien.no_peserta',
  no_ktp: 'pasien.no_ktp',
  no_rawat: 'reg_periksa.no_rawat',
  no_reg: 'reg_periksa.no_reg',
  tgl_registrasi: 'reg_periksa.tgl_registrasi',
  jam_reg: 'reg_periksa.jam_reg',
  kd_dokter: 'reg_periksa.kd_dokter',
  no_rkm_medis: 'reg_periksa.no_rkm_medis',
  almt_pj: 'reg_periksa.almt_pj',
  hubunganpj: 'reg_periksa.hubunganpj',
  biaya_reg: 'reg_periksa.biaya_reg',
  stts: 'reg_periksa.stts',
  umur: 'reg_periksa.umurdaftar',
  status_poli: 'reg_periksa.status_poli',
  kd_pj: 'reg_periksa.kd_pj',
  kd_poli: 'reg_periksa.kd_poli',
};

const BASE_QUERY = `
  SELECT
    reg_periksa.no_reg, reg_periksa.no_rawat, reg_periksa.tgl_registrasi,
    reg_periksa.jam_reg, reg_periksa.kd_dokter, dokter.nm_dokter,
    reg_periksa.no_rkm_medis, pasien.nm_pasien, poliklinik.nm_poli,
    reg_periksa.p_jawab, reg_periksa.almt_pj, reg_periksa.hubunganpj,
    reg_periksa.biaya_reg, reg_periksa.stts, penjab.png_jawab,
    CONCAT(reg_periksa.umurdaftar, ' ', reg_periksa.sttsumur) AS umur,
    reg_periksa.status_bayar, reg_periksa.status_poli, reg_periksa.status_lanjut,
    reg_periksa.kd_pj, reg_periksa.kd_poli,
    pasien.no_tlp, DATE_FORMAT(pasien.tgl_lahir, '%d-%m-%Y') AS tgl_lahir,
    pasien.no_peserta, pasien.no_ktp
  FROM reg_periksa
    INNER JOIN dokter ON reg_periksa.kd_dokter = dokter.kd_dokter
    INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
    INNER JOIN poliklinik ON reg_periksa.kd_poli = poliklinik.kd_poli
    INNER JOIN penjab ON reg_periksa.kd_pj = penjab.kd_pj`;

exports.getListPasienIGD = async (req, res) => {
  const { statuslanjut, tglawal, tglakhir, search, orderby, sort, kd_dokter } = req.query;

  if (validateParams(req, res, { tglawal, tglakhir })) return;

  if (!isValidDate(tglawal) || !isValidDate(tglakhir)) {
    return response.badRequest(req, res, 'Tanggal harus berformat YYYY-MM-DD');
  }

  const conditions = ['reg_periksa.tgl_registrasi BETWEEN ? AND ?', 'reg_periksa.kd_poli = ?'];
  const params = [tglawal, tglakhir, 'IGDK'];

  if (kd_dokter) {
    conditions.push('reg_periksa.kd_dokter = ?');
    params.push(kd_dokter);
  }

  if (statuslanjut !== 'semua') {
    conditions.push('reg_periksa.status_lanjut = ?');
    params.push(statuslanjut);
  }

  if (search) {
    conditions.push(`(
      reg_periksa.no_reg LIKE ? OR reg_periksa.no_rawat LIKE ?
      OR reg_periksa.tgl_registrasi LIKE ? OR reg_periksa.kd_dokter LIKE ?
      OR dokter.nm_dokter LIKE ? OR reg_periksa.no_rkm_medis LIKE ?
      OR pasien.nm_pasien LIKE ? OR poliklinik.nm_poli LIKE ?
      OR reg_periksa.p_jawab LIKE ? OR penjab.png_jawab LIKE ?
      OR reg_periksa.almt_pj LIKE ? OR reg_periksa.status_bayar LIKE ?
      OR reg_periksa.hubunganpj LIKE ?)`);
    params.push(...Array(13).fill(`%${search}%`));
  }

  const orderClause = buildOrderClause(
    orderby,
    sort,
    ALIAS_MAP,
    'reg_periksa.tgl_registrasi, reg_periksa.jam_reg'
  );

  const query = `${BASE_QUERY} WHERE ${conditions.join(' AND ')}${orderClause}`;

  const [rows] = await db.query(query, params);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const noRawatList = rows.map((row) => row.no_rawat);

  const [sepRecords, diagnosaRecords] = await Promise.all([
    regPeriksaRepo.findSepByNoRawatList(noRawatList),
    regPeriksaRepo.findDiagnosaByNoRawatList(noRawatList),
  ]);

  const sepMap = regPeriksaRepo.buildGroupMap(sepRecords, 'no_rawat', (r) => r.no_sep);
  const diagnosaMap = regPeriksaRepo.buildGroupMap(diagnosaRecords, 'no_rawat', (r) => ({
    kd_penyakit: r.kd_penyakit,
    nm_penyakit: r.nm_penyakit,
  }));

  const enrichedRows = rows.map((row) => ({
    ...row,
    usia: calculateAge(row.tgl_lahir),
    sep: sepMap[row.no_rawat] || [],
    diagnosa: diagnosaMap[row.no_rawat] || [],
  }));

  return response.ok(res, enrichedRows);
};
