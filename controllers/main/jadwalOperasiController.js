const db = require('../../config/db');
const dayjs = require('dayjs');
const response = require('../../middleware/responseHandler');
require('dayjs/locale/id');
dayjs.locale('id');

exports.getJadwalOperasi = async (req, res) => {
  const { tanggal: queryTanggal, kd_dokter, search } = req.query;
  const tanggal = queryTanggal || dayjs(new Date()).format('YYYY-MM-DD');

  let query = `
      SELECT
          booking_operasi.no_rawat,
          reg_periksa.no_rkm_medis,
          pasien.nm_pasien,
          booking_operasi.tanggal,
          booking_operasi.jam_mulai,
          booking_operasi.jam_selesai,
          booking_operasi.STATUS,
          booking_operasi.kd_dokter,
          dokter.nm_dokter,
          booking_operasi.kode_paket,
          paket_operasi.nm_perawatan,
          concat( reg_periksa.umurdaftar, ' ', reg_periksa.sttsumur ) AS umur,
          pasien.jk,
          ruang_ok.nm_ruang_ok
      FROM
          booking_operasi
          INNER JOIN reg_periksa ON booking_operasi.no_rawat = reg_periksa.no_rawat
          INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
          INNER JOIN paket_operasi ON booking_operasi.kode_paket = paket_operasi.kode_paket
          INNER JOIN dokter ON booking_operasi.kd_dokter = dokter.kd_dokter
          INNER JOIN ruang_ok ON booking_operasi.kd_ruang_ok = ruang_ok.kd_ruang_ok
      WHERE
          booking_operasi.tanggal = ?
  `;

  const queryParams = [tanggal];

  if (kd_dokter) {
    query += ' AND booking_operasi.kd_dokter = ?';
    queryParams.push(kd_dokter);
  }

  if (search) {
    query +=
      ' AND (pasien.nm_pasien LIKE ? OR dokter.nm_dokter LIKE ? OR paket_operasi.nm_perawatan LIKE ? OR ruang_ok.nm_ruang_ok LIKE ?)';
    const searchWildcard = `%${search}%`;
    queryParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard);
  }

  query += `
      ORDER BY
          booking_operasi.tanggal,
          booking_operasi.jam_mulai
  `;

  const cache = require('../../utils/cache');
  const cacheKey = `jadwal_operasi_${tanggal}_${kd_dokter || 'all'}_${search || ''}`;

  try {
    const rows = await cache.remember(
      cacheKey,
      async () => {
        const [result] = await db.query(query, queryParams);
        return result;
      },
      15
    );

    if (rows.length === 0) {
      return response.noContent(res);
    }
    return response.ok(res, rows);
  } catch (error) {
    return response.internalError(req, res, error);
  }
};

const fetchBedData = async () => {
  const query = `
      SELECT
          kamar.kd_kamar,
          kamar.kd_bangsal,
          bangsal.nm_bangsal,
          kamar.kelas,
          kamar.trf_kamar,
          kamar.STATUS
      FROM
          bangsal
          INNER JOIN kamar ON kamar.kd_bangsal = bangsal.kd_bangsal
      WHERE
          kamar.statusdata = '1'
      ORDER BY
          kamar.trf_kamar DESC,
          bangsal.nm_bangsal ASC
  `;

  const [rows] = await db.query(query);
  const grouped = {};
  const classesMap = new Map();

  rows.forEach((item) => {
    const key = item.nm_bangsal;

    if (!grouped[key]) {
      grouped[key] = {
        nm_bangsal: item.nm_bangsal,
        kelas: item.kelas,
        trf_kamar: item.trf_kamar,
        total_bed: 0,
        total_isi: 0,
        total_kosong: 0,
        items: [],
      };
    }

    grouped[key].items.push(item);
    grouped[key].total_bed++;

    if (item.STATUS === 'ISI') {
      grouped[key].total_isi++;
    } else {
      grouped[key].total_kosong++;
    }

    if (!classesMap.has(item.kelas)) {
      classesMap.set(item.kelas, { kelas: item.kelas, trf_kamar: item.trf_kamar });
    }
  });

  const bedClasses = Array.from(classesMap.values()).sort((a, b) => b.trf_kamar - a.trf_kamar);

  return {
    bedDetails: Object.values(grouped),
    bedClasses,
    isEmpty: rows.length === 0,
  };
};

exports.getBed = async (req, res) => {
  const cache = require('../../utils/cache');
  const cacheKey = 'bed_availability_data';

  const result = await cache.remember(
    cacheKey,
    async () => {
      return await fetchBedData();
    },
    60
  );

  if (result.isEmpty) {
    return response.noContent(res);
  }
  const finalResult = { ...result };
  finalResult.isEmpty = undefined;
  return response.ok(res, finalResult);
};

exports.fetchBedData = fetchBedData;
