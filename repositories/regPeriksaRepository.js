const db = require('../config/db');
const { doctorInCondition } = require('../utils/doctorIdentity');

const REG_PERIKSA_DETAIL = `
  SELECT
    reg_periksa.no_reg, reg_periksa.no_rawat, reg_periksa.tgl_registrasi,
    reg_periksa.jam_reg, reg_periksa.kd_dokter, reg_periksa.no_rkm_medis,
    reg_periksa.kd_poli, reg_periksa.p_jawab, reg_periksa.almt_pj,
    reg_periksa.hubunganpj, reg_periksa.biaya_reg, reg_periksa.stts,
    reg_periksa.stts_daftar, reg_periksa.status_lanjut, reg_periksa.kd_pj,
    reg_periksa.umurdaftar, reg_periksa.sttsumur, reg_periksa.status_bayar,
    reg_periksa.status_poli,
    pasien.no_rkm_medis, pasien.nm_pasien, pasien.no_ktp, pasien.jk,
    pasien.tmp_lahir, pasien.tgl_lahir, pasien.nm_ibu, pasien.alamat,
    pasien.gol_darah, pasien.pekerjaan, pasien.stts_nikah, pasien.agama,
    pasien.tgl_daftar, pasien.no_tlp, pasien.umur, pasien.pnd,
    pasien.keluarga, pasien.namakeluarga, pasien.kd_pj AS kdpj_pasien,
    pasien.no_peserta, pasien.kd_kel, pasien.kd_kec, pasien.kd_kab,
    pasien.pekerjaanpj, pasien.alamatpj, pasien.kelurahanpj, pasien.kecamatanpj,
    pasien.kabupatenpj, pasien.perusahaan_pasien, pasien.suku_bangsa,
    pasien.bahasa_pasien, pasien.cacat_fisik, pasien.email, pasien.nip,
    pasien.kd_prop, pasien.propinsipj
  FROM reg_periksa
  INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
  WHERE reg_periksa.no_rawat = ?`;

exports.findDetailByNoRawat = async (noRawat) => {
  const [rows] = await db.query(REG_PERIKSA_DETAIL, [noRawat]);
  return rows;
};

exports.findDpjpRanap = async (noRawat) => {
  const [rows] = await db.query(
    `SELECT dokter.nm_dokter, dpjp_ranap.kd_dokter
     FROM dokter
     INNER JOIN dpjp_ranap ON dokter.kd_dokter = dpjp_ranap.kd_dokter
     WHERE dpjp_ranap.no_rawat = ?
     ORDER BY dpjp_ranap.pjranap_ke ASC`,
    [noRawat]
  );
  return rows;
};

exports.findSepByNoRawat = async (noRawat) => {
  const [rows] = await db.query('SELECT no_sep FROM bridging_sep WHERE no_rawat = ?', [noRawat]);
  return rows;
};

exports.findSepByNoRawatList = async (noRawatList) => {
  const [rows] = await db.query('SELECT no_rawat, no_sep FROM bridging_sep WHERE no_rawat IN (?)', [
    noRawatList,
  ]);
  return rows;
};

exports.findDiagnosaByNoRawatList = async (noRawatList) => {
  const [rows] = await db.query(
    `SELECT diagnosa_pasien.no_rawat, diagnosa_pasien.kd_penyakit, penyakit.nm_penyakit
     FROM diagnosa_pasien
     INNER JOIN penyakit ON diagnosa_pasien.kd_penyakit = penyakit.kd_penyakit
     WHERE diagnosa_pasien.no_rawat IN (?)`,
    [noRawatList]
  );
  return rows;
};

exports.findDpjpByNoRawatList = async (noRawatList) => {
  const [rows] = await db.query(
    `SELECT dpjp_ranap.no_rawat, dpjp_ranap.kd_dokter, dokter.nm_dokter
     FROM dpjp_ranap
     INNER JOIN dokter ON dpjp_ranap.kd_dokter = dokter.kd_dokter
     WHERE dpjp_ranap.no_rawat IN (?)
     ORDER BY dpjp_ranap.pjranap_ke ASC`,
    [noRawatList]
  );
  return rows;
};

exports.findLastKelasKamar = async (noRawat) => {
  const [rows] = await db.query(
    `SELECT kamar.kelas FROM kamar
     INNER JOIN kamar_inap ON kamar.kd_kamar = kamar_inap.kd_kamar
     WHERE kamar_inap.no_rawat = ?
     ORDER BY STR_TO_DATE(CONCAT(kamar_inap.tgl_masuk,' ',kamar_inap.jam_masuk),'%Y-%m-%d %H:%i:%s') DESC
     LIMIT 1`,
    [noRawat]
  );
  return rows;
};

exports.findLastKamar = async (noRawat) => {
  const [rows] = await db.query(
    `SELECT bangsal.nm_bangsal FROM kamar
     INNER JOIN kamar_inap ON kamar.kd_kamar = kamar_inap.kd_kamar
     INNER JOIN bangsal ON kamar.kd_bangsal = bangsal.kd_bangsal
     WHERE kamar_inap.no_rawat = ?
     ORDER BY STR_TO_DATE(CONCAT(kamar_inap.tgl_masuk,' ',kamar_inap.jam_masuk),'%Y-%m-%d %H:%i:%s') DESC
     LIMIT 1`,
    [noRawat]
  );
  return rows;
};

exports.buildGroupMap = (rows, keyField, valueFn) => {
  return rows.reduce((acc, row) => {
    const key = row[keyField];
    if (!acc[key]) acc[key] = [];
    acc[key].push(valueFn(row));
    return acc;
  }, {});
};

exports.getListPasienRalan = async (
  tglawal,
  tglakhir,
  statusbayar,
  statusperiksa,
  poli,
  dokter,
  search,
  orderClause
) => {
  const BASE_QUERY = `
    SELECT
      reg_periksa.no_reg, reg_periksa.no_rawat, reg_periksa.tgl_registrasi,
      reg_periksa.jam_reg, reg_periksa.kd_dokter, dokter.nm_dokter,
      reg_periksa.no_rkm_medis, pasien.nm_pasien, poliklinik.nm_poli,
      reg_periksa.p_jawab, reg_periksa.almt_pj, reg_periksa.hubunganpj,
      reg_periksa.biaya_reg, reg_periksa.stts, penjab.png_jawab,
      CONCAT(reg_periksa.umurdaftar, ' ', reg_periksa.sttsumur) AS umur,
      reg_periksa.status_bayar, reg_periksa.status_poli,
      reg_periksa.kd_pj, reg_periksa.kd_poli,
      pasien.no_tlp, DATE_FORMAT(pasien.tgl_lahir, '%d-%m-%Y') AS tgl_lahir,
      pasien.no_peserta, pasien.no_ktp,
      GROUP_CONCAT(DISTINCT bridging_sep.no_sep SEPARATOR '||') AS sep_list,
      GROUP_CONCAT(DISTINCT CONCAT(diagnosa_pasien.kd_penyakit, ':', penyakit.nm_penyakit) SEPARATOR '||') AS diagnosa_list
    FROM reg_periksa
      INNER JOIN dokter ON reg_periksa.kd_dokter = dokter.kd_dokter
      INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
      INNER JOIN poliklinik ON reg_periksa.kd_poli = poliklinik.kd_poli
      INNER JOIN penjab ON reg_periksa.kd_pj = penjab.kd_pj
      LEFT JOIN bridging_sep ON reg_periksa.no_rawat = bridging_sep.no_rawat
      LEFT JOIN diagnosa_pasien ON reg_periksa.no_rawat = diagnosa_pasien.no_rawat
      LEFT JOIN penyakit ON diagnosa_pasien.kd_penyakit = penyakit.kd_penyakit`;

  const conditions = [
    'reg_periksa.tgl_registrasi BETWEEN ? AND ?',
    'reg_periksa.status_lanjut = ?',
  ];
  const params = [tglawal, tglakhir, 'Ralan'];

  if (statusbayar && statusbayar !== 'semua') {
    conditions.push('reg_periksa.status_bayar = ?');
    params.push(statusbayar);
  }

  if (statusperiksa && statusperiksa !== 'semua') {
    conditions.push('reg_periksa.stts = ?');
    params.push(statusperiksa);
  }

  if (poli && poli !== 'semua') {
    conditions.push('reg_periksa.kd_poli = ?');
    params.push(poli);
  }

  if (dokter && dokter !== 'semua') {
    const cond = await doctorInCondition('reg_periksa.kd_dokter', dokter);
    conditions.push(cond.sql);
    params.push(...cond.params);
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

  const query = `${BASE_QUERY} WHERE ${conditions.join(' AND ')} GROUP BY reg_periksa.no_rawat ${orderClause}`;
  const [rows] = await db.query(query, params);
  return rows;
};
