const knex = require('../../config/knex');
const response = require('../../middleware/responseHandler');
const { logger } = require('../../middleware/logger');
const cache = require('../../utils/cache');

const getTodayString = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

function applyStatusFilter(qb, status, regTableAlias = 'reg_periksa') {
  if (status === 'Piutang Belum Lunas') {
    qb.innerJoin('piutang_pasien', `${regTableAlias}.no_rawat`, 'piutang_pasien.no_rawat');
    qb.where(`${regTableAlias}.status_bayar`, 'Sudah Bayar');
    qb.where('piutang_pasien.status', 'Belum Lunas');
  } else if (status === 'Piutang Sudah Lunas') {
    qb.innerJoin('piutang_pasien', `${regTableAlias}.no_rawat`, 'piutang_pasien.no_rawat');
    qb.where(`${regTableAlias}.status_bayar`, 'Sudah Bayar');
    qb.where('piutang_pasien.status', 'Lunas');
  } else if (status === 'Sudah Bayar Non Piutang') {
    qb.where(`${regTableAlias}.status_bayar`, 'Sudah Bayar');
    qb.whereNotIn(`${regTableAlias}.no_rawat`, function () {
      this.select('no_rawat').from('piutang_pasien');
    });
  } else if (status === 'Belum Terclosing Kasir') {
    qb.where(`${regTableAlias}.status_bayar`, 'Belum Bayar');
  }
}

function buildHarianDokterQueries(params, kd_dokter) {
  const { tgl1, tgl2, status, kd_pj, kategori, search } = params;
  const tgl1Dt = `${tgl1} 00:00:00`;
  const tgl2Dt = `${tgl2} 23:59:59`;
  const kats = (kategori || 'RJ,RI,OP,LAB,RAD').split(',');

  const queries = [];

  const applyCommonFilters = (qb, hasSearch = true) => {
    if (kd_pj !== 'Semua') {
      qb.where('reg_periksa.kd_pj', kd_pj);
    }
    if (hasSearch && search) {
      qb.where((builder) => {
        builder.where('pasien.nm_pasien', 'like', `%${search}%`)
               .orWhere('reg_periksa.no_rawat', 'like', `%${search}%`)
               .orWhere('reg_periksa.no_rkm_medis', 'like', `%${search}%`);
      });
    }
    applyStatusFilter(qb, status, 'reg_periksa');
  };

  // 1. Rawat Jalan
  if (kats.includes('RJ')) {
    const qRj1 = knex('pasien')
      .innerJoin('reg_periksa', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('rawat_jl_dr', 'rawat_jl_dr.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('jns_perawatan', 'rawat_jl_dr.kd_jenis_prw', 'jns_perawatan.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'rawat_jl_dr.tarif_tindakandr as tarif',
        'jns_perawatan.nm_perawatan',
        knex.raw("DATE_FORMAT(rawat_jl_dr.tgl_perawatan, '%Y-%m-%d') as tgl"),
        'rawat_jl_dr.jam_rawat as jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'rawat_jl_dr.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Rawat Jalan (Dokter)' AS tipe"),
        knex.raw("'RJ' AS kat_code")
      )
      .whereRaw("concat(reg_periksa.tgl_registrasi, ' ', reg_periksa.jam_reg) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('rawat_jl_dr.kd_dokter', kd_dokter)
      .where('rawat_jl_dr.tarif_tindakandr', '>', 0);
    applyCommonFilters(qRj1);
    queries.push(qRj1);

    const qRj2 = knex('pasien')
      .innerJoin('reg_periksa', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('rawat_jl_drpr', 'rawat_jl_drpr.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('jns_perawatan', 'rawat_jl_drpr.kd_jenis_prw', 'jns_perawatan.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'rawat_jl_drpr.tarif_tindakandr as tarif',
        'jns_perawatan.nm_perawatan',
        knex.raw("DATE_FORMAT(rawat_jl_drpr.tgl_perawatan, '%Y-%m-%d') as tgl"),
        'rawat_jl_drpr.jam_rawat as jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'rawat_jl_drpr.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Rawat Jalan (Dokter & Perawat)' AS tipe"),
        knex.raw("'RJ' AS kat_code")
      )
      .whereRaw("concat(reg_periksa.tgl_registrasi, ' ', reg_periksa.jam_reg) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('rawat_jl_drpr.kd_dokter', kd_dokter)
      .where('rawat_jl_drpr.tarif_tindakandr', '>', 0);
    applyCommonFilters(qRj2);
    queries.push(qRj2);
  }

  // 2. Rawat Inap
  if (kats.includes('RI')) {
    const qRi1 = knex('pasien')
      .innerJoin('reg_periksa', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('rawat_inap_dr', 'rawat_inap_dr.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('jns_perawatan_inap', 'rawat_inap_dr.kd_jenis_prw', 'jns_perawatan_inap.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'rawat_inap_dr.tarif_tindakandr as tarif',
        'jns_perawatan_inap.nm_perawatan',
        knex.raw("DATE_FORMAT(rawat_inap_dr.tgl_perawatan, '%Y-%m-%d') as tgl"),
        'rawat_inap_dr.jam_rawat as jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'rawat_inap_dr.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Rawat Inap (Dokter)' AS tipe"),
        knex.raw("'RI' AS kat_code")
      )
      .whereRaw("concat(rawat_inap_dr.tgl_perawatan, ' ', rawat_inap_dr.jam_rawat) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('rawat_inap_dr.kd_dokter', kd_dokter)
      .where('rawat_inap_dr.tarif_tindakandr', '>', 0);
    applyCommonFilters(qRi1);
    queries.push(qRi1);

    const qRi2 = knex('pasien')
      .innerJoin('reg_periksa', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('rawat_inap_drpr', 'rawat_inap_drpr.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('jns_perawatan_inap', 'rawat_inap_drpr.kd_jenis_prw', 'jns_perawatan_inap.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'rawat_inap_drpr.tarif_tindakandr as tarif',
        'jns_perawatan_inap.nm_perawatan',
        knex.raw("DATE_FORMAT(rawat_inap_drpr.tgl_perawatan, '%Y-%m-%d') as tgl"),
        'rawat_inap_drpr.jam_rawat as jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'rawat_inap_drpr.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Rawat Inap (Dokter & Perawat)' AS tipe"),
        knex.raw("'RI' AS kat_code")
      )
      .whereRaw("concat(rawat_inap_drpr.tgl_perawatan, ' ', rawat_inap_drpr.jam_rawat) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('rawat_inap_drpr.kd_dokter', kd_dokter)
      .where('rawat_inap_drpr.tarif_tindakandr', '>', 0);
    applyCommonFilters(qRi2);
    queries.push(qRi2);
  }

  // 3. Operasi
  if (kats.includes('OP')) {
    const operasiRoles = [
      { docField: 'operator1', feeField: 'biayaoperator1', label: 'Operator 1' },
      { docField: 'operator2', feeField: 'biayaoperator2', label: 'Operator 2' },
      { docField: 'operator3', feeField: 'biayaoperator3', label: 'Operator 3' },
      { docField: 'dokter_anak', feeField: 'biayadokter_anak', label: 'dr Anak' },
      { docField: 'dokter_anestesi', feeField: 'biayadokter_anestesi', label: 'dr Anestesi' },
      { docField: 'dokter_pjanak', feeField: 'biaya_dokter_pjanak', label: 'dr Pj Anak' },
      { docField: 'dokter_umum', feeField: 'biaya_dokter_umum', label: 'dr Umum' }
    ];

    for (const role of operasiRoles) {
      const qOp = knex('operasi')
        .innerJoin('reg_periksa', 'operasi.no_rawat', 'reg_periksa.no_rawat')
        .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
        .innerJoin('paket_operasi', 'operasi.kode_paket', 'paket_operasi.kode_paket')
        .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
        .select(
          'pasien.nm_pasien',
          `operasi.${role.feeField} as tarif`,
          'paket_operasi.nm_perawatan',
          knex.raw("DATE_FORMAT(operasi.tgl_operasi, '%Y-%m-%d') as tgl"),
          knex.raw("'00:00:00' AS jam"),
          'reg_periksa.kd_pj',
          'penjab.png_jawab',
          'operasi.kode_paket as kd_tindakan',
          'reg_periksa.no_rawat',
          'reg_periksa.no_rkm_medis',
          knex.raw(`'Operasi (${role.label})' AS tipe`),
          knex.raw("'OP' AS kat_code")
        )
        .whereBetween('operasi.tgl_operasi', [tgl1, tgl2])
        .where(`operasi.${role.docField}`, kd_dokter)
        .where(`operasi.${role.feeField}`, '>', 0);
      applyCommonFilters(qOp);
      queries.push(qOp);
    }
  }

  // 4. Laboratorium
  if (kats.includes('LAB')) {
    const qLab1 = knex('periksa_lab')
      .innerJoin('reg_periksa', 'periksa_lab.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('jns_perawatan_lab', 'periksa_lab.kd_jenis_prw', 'jns_perawatan_lab.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'jns_perawatan_lab.nm_perawatan',
        'periksa_lab.tarif_tindakan_dokter as tarif',
        knex.raw("DATE_FORMAT(periksa_lab.tgl_periksa, '%Y-%m-%d') as tgl"),
        'periksa_lab.jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'periksa_lab.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Lab (Pemeriksaan Dokter)' AS tipe"),
        knex.raw("'LAB' AS kat_code")
      )
      .whereRaw("concat(periksa_lab.tgl_periksa, ' ', periksa_lab.jam) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('periksa_lab.kd_dokter', kd_dokter)
      .where('periksa_lab.tarif_tindakan_dokter', '>', 0);
    applyCommonFilters(qLab1);
    queries.push(qLab1);

    const qLab2 = knex('detail_periksa_lab')
      .innerJoin('periksa_lab', function () {
        this.on('periksa_lab.no_rawat', '=', 'detail_periksa_lab.no_rawat')
          .andOn('periksa_lab.kd_jenis_prw', '=', 'detail_periksa_lab.kd_jenis_prw')
          .andOn('periksa_lab.tgl_periksa', '=', 'detail_periksa_lab.tgl_periksa')
          .andOn('periksa_lab.jam', '=', 'detail_periksa_lab.jam');
      })
      .innerJoin('reg_periksa', 'periksa_lab.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('template_laboratorium', 'detail_periksa_lab.id_template', 'template_laboratorium.id_template')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'template_laboratorium.Pemeriksaan as nm_perawatan',
        'detail_periksa_lab.bagian_dokter as tarif',
        knex.raw("DATE_FORMAT(periksa_lab.tgl_periksa, '%Y-%m-%d') as tgl"),
        'periksa_lab.jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'periksa_lab.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Lab (Detail Pemeriksaan)' AS tipe"),
        knex.raw("'LAB' AS kat_code")
      )
      .whereRaw("concat(detail_periksa_lab.tgl_periksa, ' ', detail_periksa_lab.jam) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('periksa_lab.kd_dokter', kd_dokter)
      .where('detail_periksa_lab.bagian_dokter', '>', 0);
    applyCommonFilters(qLab2);
    queries.push(qLab2);

    const qLab3 = knex('periksa_lab')
      .innerJoin('reg_periksa', 'periksa_lab.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('jns_perawatan_lab', 'periksa_lab.kd_jenis_prw', 'jns_perawatan_lab.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'jns_perawatan_lab.nm_perawatan',
        'periksa_lab.tarif_perujuk as tarif',
        knex.raw("DATE_FORMAT(periksa_lab.tgl_periksa, '%Y-%m-%d') as tgl"),
        'periksa_lab.jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'periksa_lab.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Lab (Perujuk)' AS tipe"),
        knex.raw("'LAB' AS kat_code")
      )
      .whereRaw("concat(periksa_lab.tgl_periksa, ' ', periksa_lab.jam) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('periksa_lab.dokter_perujuk', kd_dokter)
      .where('periksa_lab.tarif_perujuk', '>', 0);
    applyCommonFilters(qLab3);
    queries.push(qLab3);

    const qLab4 = knex('detail_periksa_lab')
      .innerJoin('periksa_lab', function () {
        this.on('periksa_lab.no_rawat', '=', 'detail_periksa_lab.no_rawat')
          .andOn('periksa_lab.kd_jenis_prw', '=', 'detail_periksa_lab.kd_jenis_prw')
          .andOn('periksa_lab.tgl_periksa', '=', 'detail_periksa_lab.tgl_periksa')
          .andOn('periksa_lab.jam', '=', 'detail_periksa_lab.jam');
      })
      .innerJoin('reg_periksa', 'periksa_lab.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('template_laboratorium', 'detail_periksa_lab.id_template', 'template_laboratorium.id_template')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'template_laboratorium.Pemeriksaan as nm_perawatan',
        'detail_periksa_lab.bagian_perujuk as tarif',
        knex.raw("DATE_FORMAT(periksa_lab.tgl_periksa, '%Y-%m-%d') as tgl"),
        'periksa_lab.jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'periksa_lab.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Lab (Detail Perujuk)' AS tipe"),
        knex.raw("'LAB' AS kat_code")
      )
      .whereRaw("concat(detail_periksa_lab.tgl_periksa, ' ', detail_periksa_lab.jam) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('periksa_lab.dokter_perujuk', kd_dokter)
      .where('detail_periksa_lab.bagian_perujuk', '>', 0);
    applyCommonFilters(qLab4);
    queries.push(qLab4);
  }

  // 5. Radiologi
  if (kats.includes('RAD')) {
    const qRad1 = knex('periksa_radiologi')
      .innerJoin('reg_periksa', 'periksa_radiologi.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('jns_perawatan_radiologi', 'periksa_radiologi.kd_jenis_prw', 'jns_perawatan_radiologi.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'jns_perawatan_radiologi.nm_perawatan',
        'periksa_radiologi.tarif_tindakan_dokter as tarif',
        knex.raw("DATE_FORMAT(periksa_radiologi.tgl_periksa, '%Y-%m-%d') as tgl"),
        'periksa_radiologi.jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'periksa_radiologi.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Radiologi (Pemeriksaan Dokter)' AS tipe"),
        knex.raw("'RAD' AS kat_code")
      )
      .whereRaw("concat(periksa_radiologi.tgl_periksa, ' ', periksa_radiologi.jam) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('periksa_radiologi.kd_dokter', kd_dokter)
      .where('periksa_radiologi.tarif_tindakan_dokter', '>', 0);
    applyCommonFilters(qRad1);
    queries.push(qRad1);

    const qRad2 = knex('periksa_radiologi')
      .innerJoin('reg_periksa', 'periksa_radiologi.no_rawat', 'reg_periksa.no_rawat')
      .innerJoin('pasien', 'reg_periksa.no_rkm_medis', 'pasien.no_rkm_medis')
      .innerJoin('jns_perawatan_radiologi', 'periksa_radiologi.kd_jenis_prw', 'jns_perawatan_radiologi.kd_jenis_prw')
      .innerJoin('penjab', 'reg_periksa.kd_pj', 'penjab.kd_pj')
      .select(
        'pasien.nm_pasien',
        'jns_perawatan_radiologi.nm_perawatan',
        'periksa_radiologi.tarif_perujuk as tarif',
        knex.raw("DATE_FORMAT(periksa_radiologi.tgl_periksa, '%Y-%m-%d') as tgl"),
        'periksa_radiologi.jam',
        'reg_periksa.kd_pj',
        'penjab.png_jawab',
        'periksa_radiologi.kd_jenis_prw as kd_tindakan',
        'reg_periksa.no_rawat',
        'reg_periksa.no_rkm_medis',
        knex.raw("'Radiologi (Perujuk)' AS tipe"),
        knex.raw("'RAD' AS kat_code")
      )
      .whereRaw("concat(periksa_radiologi.tgl_periksa, ' ', periksa_radiologi.jam) BETWEEN ? AND ?", [tgl1Dt, tgl2Dt])
      .where('periksa_radiologi.dokter_perujuk', kd_dokter)
      .where('periksa_radiologi.tarif_perujuk', '>', 0);
    applyCommonFilters(qRad2);
    queries.push(qRad2);
  }

  return queries;
}

exports.getHarianDokter = async (req, res) => {
  const tgl1 = req.query.tgl1 || getTodayString();
  const tgl2 = req.query.tgl2 || getTodayString();
  const status = req.query.status || 'Semua';
  const kd_pj = req.query.kd_pj || 'Semua';
  const kategori = req.query.kategori || 'RJ,RI,OP,LAB,RAD';
  const search = req.query.search || '';
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;

  const kd_dokter = req.query.dokter || req.user?.username;

  if (!kd_dokter) {
    return response.unauthorized(res, null, 'Dokter tidak teridentifikasi');
  }

  try {
    const queries = buildHarianDokterQueries({ tgl1, tgl2, status, kd_pj, kategori, search }, kd_dokter);
    
    if (queries.length === 0) {
      return response.ok(res, {
        total: 0,
        page,
        limit,
        data: []
      });
    }

    const queryResults = await Promise.all(queries);
    const allTx = queryResults.flat();

    allTx.sort((a, b) => {
      const dateTimeA = `${a.tgl} ${a.jam}`;
      const dateTimeB = `${b.tgl} ${b.jam}`;
      return dateTimeB.localeCompare(dateTimeA);
    });

    const total = allTx.length;
    const startIndex = (page - 1) * limit;
    const paginatedData = allTx.slice(startIndex, startIndex + limit);

    return response.ok(res, {
      total,
      page,
      limit,
      data: paginatedData
    });
  } catch (error) {
    logger.error('Get Harian Dokter Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil data harian dokter');
  }
};

exports.getHarianDokterSummary = async (req, res) => {
  const tgl1 = req.query.tgl1 || getTodayString();
  const tgl2 = req.query.tgl2 || getTodayString();
  const status = req.query.status || 'Semua';
  const kd_pj = req.query.kd_pj || 'Semua';
  const kategori = req.query.kategori || 'RJ,RI,OP,LAB,RAD';
  const search = req.query.search || '';

  const kd_dokter = req.query.dokter || req.user?.username;

  if (!kd_dokter) {
    return response.unauthorized(res, null, 'Dokter tidak teridentifikasi');
  }

  try {
    const queries = buildHarianDokterQueries({ tgl1, tgl2, status, kd_pj, kategori, search }, kd_dokter);

    let summary = {
      total_rj: 0,
      total_ri: 0,
      total_op: 0,
      total_lab: 0,
      total_rad: 0,
      grand_total: 0
    };

    if (queries.length > 0) {
      const queryResults = await Promise.all(queries);
      const allTx = queryResults.flat();

      for (const tx of allTx) {
        const tarif = parseFloat(tx.tarif) || 0;
        if (tx.kat_code === 'RJ') summary.total_rj += tarif;
        else if (tx.kat_code === 'RI') summary.total_ri += tarif;
        else if (tx.kat_code === 'OP') summary.total_op += tarif;
        else if (tx.kat_code === 'LAB') summary.total_lab += tarif;
        else if (tx.kat_code === 'RAD') summary.total_rad += tarif;
      }
      summary.grand_total = summary.total_rj + summary.total_ri + summary.total_op + summary.total_lab + summary.total_rad;
    }

    return response.ok(res, summary);
  } catch (error) {
    logger.error('Get Harian Dokter Summary Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil ringkasan harian dokter');
  }
};

exports.getCaraBayar = async (req, res) => {
  const cacheKey = 'harian_dokter_cara_bayar';
  
  try {
    const options = await cache.remember(cacheKey, async () => {
      return await knex('penjab')
        .select('kd_pj', 'png_jawab')
        .orderBy('png_jawab');
    }, 120);

    return response.ok(res, options);
  } catch (error) {
    logger.error('Get Cara Bayar Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil daftar cara bayar');
  }
};
