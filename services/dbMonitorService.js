const db = require('../config/db');
const { sendNotification } = require('../controllers/main/notificationController');
const { logger } = require('../middleware/logger');

let lastKmNo = '';
let lastKpNo = '';
let lastJkmTime = '';
let lastRegNo = '';

let isPolling = false;

async function init() {
  try {
    // 1. Get max no_permintaan for konsultasi_medik
    const [kmRows] = await db.query('SELECT MAX(no_permintaan) as max_val FROM konsultasi_medik');
    lastKmNo = kmRows[0]?.max_val || '';

    // 2. Get max no_permintaan for konsultasi_perawat
    const [kpRows] = await db.query('SELECT MAX(no_permintaan) as max_val FROM konsultasi_perawat');
    lastKpNo = kpRows[0]?.max_val || '';

    // 3. Get max tanggal for jawaban_konsultasi_medik
    const [jkmRows] = await db.query('SELECT MAX(tanggal) as max_val FROM jawaban_konsultasi_medik');
    lastJkmTime = jkmRows[0]?.max_val || '';

    // 4. Get max no_rawat for reg_periksa
    const [regRows] = await db.query('SELECT MAX(no_rawat) as max_val FROM reg_periksa');
    lastRegNo = regRows[0]?.max_val || '';

    logger.info(`[DB-Monitor] Initialized tracking counters: KM: ${lastKmNo}, KP: ${lastKpNo}, JKM: ${lastJkmTime}, REG: ${lastRegNo}`);
  } catch (err) {
    logger.error('[DB-Monitor] Initialization error:', err);
  }
}

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // 1. Check new incoming consultations (konsultasi_medik)
    if (lastKmNo) {
      const [newKm] = await db.query(
        `SELECT
           km.no_permintaan,
           km.no_rawat,
           km.kd_dokter as kd_dokter_asal,
           dr_asal.nm_dokter as nm_dokter_asal,
           km.kd_dokter_dikonsuli,
           km.diagnosa_kerja,
           km.uraian_konsultasi,
           p.nm_pasien
         FROM konsultasi_medik km
         INNER JOIN dokter dr_asal ON km.kd_dokter = dr_asal.kd_dokter
         INNER JOIN reg_periksa rp ON km.no_rawat = rp.no_rawat
         INNER JOIN pasien p ON rp.no_rkm_medis = p.no_rkm_medis
         WHERE km.no_permintaan > ?
         ORDER BY km.no_permintaan ASC`,
        [lastKmNo]
      );

      for (const row of newKm) {
        logger.info(`[DB-Monitor] Detected new consultation: ${row.no_permintaan}`);
        await sendNotification(row.kd_dokter_dikonsuli, 'consultation_request', {
          no_permintaan: row.no_permintaan,
          no_rawat: row.no_rawat,
          nm_dokter_pemberi: row.nm_dokter_asal,
          diagnosa_kerja: row.diagnosa_kerja,
          uraian_konsultasi: row.uraian_konsultasi,
          nm_pasien: row.nm_pasien
        });
        lastKmNo = row.no_permintaan;
      }
    }

    // 2. Check new SBAR requests (konsultasi_perawat)
    if (lastKpNo) {
      const [newKp] = await db.query(
        `SELECT
           kp.no_permintaan,
           kp.no_rawat,
           kp.nip,
           pegawai.nama as nama_petugas,
           kp.kd_dokter_dikonsuli,
           kp.situation,
           p.nm_pasien
         FROM konsultasi_perawat kp
         LEFT JOIN pegawai ON kp.nip = pegawai.nik
         INNER JOIN reg_periksa rp ON kp.no_rawat = rp.no_rawat
         INNER JOIN pasien p ON rp.no_rkm_medis = p.no_rkm_medis
         WHERE kp.no_permintaan > ?
         ORDER BY kp.no_permintaan ASC`,
        [lastKpNo]
      );

      for (const row of newKp) {
        logger.info(`[DB-Monitor] Detected new SBAR: ${row.no_permintaan}`);
        await sendNotification(row.kd_dokter_dikonsuli, 'sbar_request', {
          no_permintaan: row.no_permintaan,
          no_rawat: row.no_rawat,
          nama_petugas: row.nama_petugas || 'Perawat',
          situation: row.situation,
          nm_pasien: row.nm_pasien
        });
        lastKpNo = row.no_permintaan;
      }
    }

    // 3. Check new consultation responses (jawaban_konsultasi_medik)
    if (lastJkmTime) {
      const [newJkm] = await db.query(
        `SELECT
           jkm.no_permintaan,
           jkm.tanggal,
           km.kd_dokter as kd_dokter_peminta,
           km.kd_dokter_dikonsuli,
           dr_tujuan.nm_dokter as nm_dokter_dikonsuli
         FROM jawaban_konsultasi_medik jkm
         INNER JOIN konsultasi_medik km ON jkm.no_permintaan = km.no_permintaan
         INNER JOIN dokter dr_tujuan ON km.kd_dokter_dikonsuli = dr_tujuan.kd_dokter
         WHERE jkm.tanggal > ?
         ORDER BY jkm.tanggal ASC`,
        [lastJkmTime]
      );

      for (const row of newJkm) {
        logger.info(`[DB-Monitor] Detected new consultation reply for: ${row.no_permintaan}`);
        await sendNotification(row.kd_dokter_peminta, 'consultation_response', {
          no_permintaan: row.no_permintaan,
          nm_dokter_dikonsuli: row.nm_dokter_dikonsuli
        });
        lastJkmTime = row.tanggal;
      }
    }

    // 4. Check new DPJP admissions (reg_periksa)
    if (lastRegNo) {
      const [newReg] = await db.query(
        `SELECT
           rp.no_rawat,
           rp.kd_dokter,
           p.nm_pasien
         FROM reg_periksa rp
         INNER JOIN pasien p ON rp.no_rkm_medis = p.no_rkm_medis
         WHERE rp.no_rawat > ?
         ORDER BY rp.no_rawat ASC`,
        [lastRegNo]
      );

      for (const row of newReg) {
        logger.info(`[DB-Monitor] Detected new DPJP registration: ${row.no_rawat}`);
        await sendNotification(row.kd_dokter, 'new_admission', {
          no_rawat: row.no_rawat,
          nm_pasien: row.nm_pasien
        });
        lastRegNo = row.no_rawat;
      }
    }
  } catch (err) {
    logger.error('[DB-Monitor] Polling error:', err);
  } finally {
    isPolling = false;
  }
}

function start() {
  init().then(() => {
    setInterval(poll, 3000);
  });
}

module.exports = { start };
