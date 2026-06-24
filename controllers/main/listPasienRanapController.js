const db = require('../../config/db');
const dayjs = require('dayjs');
const response = require('../../middleware/responseHandler');
const validateParams = require('../../middleware/validateParams');
const { isValidDate, calculateAge } = require('../../utils/dateHelper');
const { buildOrderClause } = require('../../utils/paginationHelper');
const cache = require('../../utils/cache');
const regPeriksaRepo = require('../../repositories/regPeriksaRepository');

const parseGroupConcatMap = (str, itemSeparator = '||', keyValueSeparator = ':') => {
  if (!str) return [];
  const items = str.split(itemSeparator);
  const result = [];
  for (const item of items) {
    if (!item) continue;
    const idx = item.indexOf(keyValueSeparator);
    if (idx === -1) continue;
    const key = item.substring(0, idx);
    const value = item.substring(idx + 1);
    result.push({ key, value });
  }
  return result;
};

const ALIAS_MAP = {
  bangsal: 'bangsal.nm_bangsal',
  pasien: 'pasien.nm_pasien',
  tgl_masuk: 'kamar_inap.tgl_masuk',
  jam_masuk: 'kamar_inap.jam_masuk',
  nm_pasien: 'pasien.nm_pasien',
  nm_dokter: 'dokter.nm_dokter',
  status_bayar: 'reg_periksa.status_bayar',
};

const BASE_QUERY = `
  SELECT
    kamar_inap.no_rawat, reg_periksa.no_rkm_medis, pasien.nm_pasien,
    CONCAT(pasien.alamat, ', ', kelurahan.nm_kel, ', ', kecamatan.nm_kec, ', ', kabupaten.nm_kab) AS alamat,
    reg_periksa.p_jawab, reg_periksa.hubunganpj, penjab.png_jawab,
    bangsal.nm_bangsal AS kamar, kamar_inap.trf_kamar,
    kamar_inap.diagnosa_awal, kamar_inap.diagnosa_akhir,
    DATE_FORMAT(kamar_inap.tgl_masuk, '%Y-%m-%d') AS tgl_masuk,
    kamar_inap.jam_masuk,
    IF(kamar_inap.tgl_keluar = '0000-00-00', '', kamar_inap.tgl_keluar) AS tgl_keluar,
    IF(kamar_inap.jam_keluar = '00:00:00', '', kamar_inap.jam_keluar) AS jam_keluar,
    kamar_inap.ttl_biaya, kamar_inap.stts_pulang, kamar_inap.lama,
    dokter.nm_dokter, kamar_inap.kd_kamar,
    reg_periksa.kd_pj, reg_periksa.status_bayar, reg_periksa.tgl_registrasi,
    pasien.agama, DATE_FORMAT(pasien.tgl_lahir, '%d-%m-%Y') AS tgl_lahir,
    pasien.no_tlp, pasien.jk, pasien.no_peserta, pasien.no_ktp,
    IF(bridging_sep.no_sep IS NULL, '-', bridging_sep.no_sep) AS no_sep,
    GROUP_CONCAT(DISTINCT CONCAT(dpjp_ranap.kd_dokter, ':', d_dpjp.nm_dokter) SEPARATOR '||') AS dpjp_list,
    GROUP_CONCAT(DISTINCT CONCAT(diagnosa_pasien.kd_penyakit, ':', penyakit.nm_penyakit) SEPARATOR '||') AS diagnosa_list
  FROM kamar_inap
    INNER JOIN reg_periksa ON kamar_inap.no_rawat = reg_periksa.no_rawat
    INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
    INNER JOIN kamar ON kamar_inap.kd_kamar = kamar.kd_kamar
    INNER JOIN bangsal ON kamar.kd_bangsal = bangsal.kd_bangsal
    INNER JOIN kelurahan ON pasien.kd_kel = kelurahan.kd_kel
    INNER JOIN kecamatan ON pasien.kd_kec = kecamatan.kd_kec
    INNER JOIN kabupaten ON pasien.kd_kab = kabupaten.kd_kab
    INNER JOIN dokter ON reg_periksa.kd_dokter = dokter.kd_dokter
    INNER JOIN penjab ON reg_periksa.kd_pj = penjab.kd_pj
    LEFT JOIN bridging_sep ON reg_periksa.no_rawat = bridging_sep.no_rawat AND bridging_sep.jnspelayanan = '1'
    LEFT JOIN dpjp_ranap ON kamar_inap.no_rawat = dpjp_ranap.no_rawat
    LEFT JOIN dokter d_dpjp ON dpjp_ranap.kd_dokter = d_dpjp.kd_dokter
    LEFT JOIN diagnosa_pasien ON reg_periksa.no_rawat = diagnosa_pasien.no_rawat
    LEFT JOIN penyakit ON diagnosa_pasien.kd_penyakit = penyakit.kd_penyakit`;

exports.getListPasienRanap = async (req, res) => {
  const {
    belumpulang,
    tglmasuk,
    tglpulang,
    statusbayar,
    ruang,
    tglawal,
    tglakhir,
    search,
    orderby,
    sort,
    kd_dokter,
  } = req.query;

  const isBelumPulang = belumpulang === 'true';
  const isTglMasuk = tglmasuk === 'true';
  const isTglPulang = tglpulang === 'true';

  if (!isBelumPulang && !isTglMasuk && !isTglPulang) {
    return response.badRequest(
      req,
      res,
      'Pilih salah satu filter: Belum Pulang, Tanggal Masuk, atau Tanggal Pulang'
    );
  }

  if (isTglMasuk || isTglPulang) {
    if (!tglawal || !tglakhir) {
      return response.badRequest(req, res, 'Tanggal Awal dan Akhir wajib di isi');
    }
    if (!isValidDate(tglawal) || !isValidDate(tglakhir)) {
      return response.badRequest(req, res, 'Tanggal harus berformat YYYY-MM-DD');
    }
  }

  if (validateParams(req, res, { statusbayar })) return;

  const conditions = [];
  const params = [];

  if (isBelumPulang) {
    conditions.push("kamar_inap.stts_pulang = '-'");
  } else if (isTglMasuk) {
    conditions.push('kamar_inap.tgl_masuk BETWEEN ? AND ?');
    params.push(tglawal, tglakhir);
  } else if (isTglPulang) {
    conditions.push('kamar_inap.tgl_keluar BETWEEN ? AND ?');
    params.push(tglawal, tglakhir);
  }

  if (kd_dokter) {
    conditions.push('dpjp_ranap.kd_dokter = ?');
    params.push(kd_dokter);
  }

  if (statusbayar !== 'semua') {
    conditions.push('reg_periksa.status_bayar LIKE ?');
    params.push(`%${statusbayar}%`);
  }

  if (ruang) {
    conditions.push('bangsal.nm_bangsal LIKE ?');
    params.push(`%${ruang}%`);
  }

  if (search) {
    conditions.push(`(
      kamar_inap.no_rawat LIKE ? OR reg_periksa.no_rkm_medis LIKE ?
      OR pasien.nm_pasien LIKE ? OR dokter.nm_dokter LIKE ?
      OR penjab.png_jawab LIKE ? OR kamar_inap.stts_pulang LIKE ?)`);
    params.push(...Array(6).fill(`%${search}%`));
  }

  const orderClause = buildOrderClause(
    orderby,
    sort,
    ALIAS_MAP,
    'bangsal.nm_bangsal, kamar_inap.tgl_masuk, kamar_inap.jam_masuk'
  );

  let query = BASE_QUERY;
  if (conditions.length > 0) {
    query += ` WHERE ${conditions.join(' AND ')}`;
  }
  query += ' GROUP BY kamar_inap.no_rawat, kamar_inap.tgl_masuk, kamar_inap.jam_masuk ';
  query += orderClause;

  const cacheKey = `list_pasien_ranap_${JSON.stringify(req.query)}`;

  const finalData = await cache.remember(
    cacheKey,
    async () => {
      const [rows] = await db.query(query, params);
      if (rows.length === 0) return [];

      const today = dayjs();
      return rows.map((row) => {
        const tglMasuk = dayjs(row.tgl_registrasi);
        const tglKeluar =
          row.tgl_keluar && row.tgl_keluar !== '0000-00-00' ? dayjs(row.tgl_keluar) : today;
        const diffDays = Math.max(1, tglKeluar.diff(tglMasuk, 'days'));

        const dpjp = parseGroupConcatMap(row.dpjp_list).map((item) => ({
          kd_dokter: item.key,
          nm_dokter: item.value,
        }));
        const diagnosa = parseGroupConcatMap(row.diagnosa_list).map((item) => ({
          kd_penyakit: item.key,
          nm_penyakit: item.value,
        }));

        const newRow = { ...row };
        delete newRow.dpjp_list;
        delete newRow.diagnosa_list;

        return {
          ...newRow,
          dpjp,
          diagnosa,
          usia: calculateAge(row.tgl_lahir),
          lama: diffDays,
          ttl_biaya: (Number.parseFloat(row.trf_kamar) || 0) * diffDays,
        };
      });
    },
    5
  );

  if (finalData.length === 0) {
    return response.noContent(res);
  }

  return response.ok(res, finalData);
};
