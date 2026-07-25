const knex = require('../config/knex');
const { sendNotification } = require('../controllers/main/notificationController');
const { cleanOldNotifications } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * DB Monitor — Reliable timestamp-based polling for real-time notifications.
 *
 * CRITICAL: All JOINs use LEFT JOIN so rows are NEVER silently dropped due
 * to missing reference data (e.g. dokter/pegawai/pasien record missing).
 * Fields from failed joins get fallback values so notifications always fire.
 */

let lastPollTime = '';
let isPolling = false;

// Dedup set for consultation responses (handles same-timestamp edge case)
const processedJkmPermintaan = new Set();

async function init() {
  try {
    // Use DB time as reference — eliminates clock skew between app & DB servers
    const [nowRaw] = await knex.raw('SELECT NOW() as now');
    lastPollTime = nowRaw[0]?.now || '';

    // Pre-populate dedup set with existing responses so historical ones don't re-fire
    const existing = await knex('jawaban_konsultasi_medik').select('no_permintaan');
    for (const row of existing) {
      processedJkmPermintaan.add(row.no_permintaan);
    }

    logger.info(`[DB-Monitor] Started. Tracking from ${lastPollTime} | ${existing.length} existing replies pre-loaded`);
  } catch (err) {
    logger.error('[DB-Monitor] Init error:', err);
  }
}

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // Get current DB time as poll window upper bound
    const [nowRaw] = await knex.raw('SELECT NOW() as now');
    const currentPollTime = nowRaw[0]?.now || '';

    // ── 1. New consultation requests (konsultasi_medik) ──
    // NOTE: LEFT JOIN so missing dokter/pasien refs don't drop the row
    const newKm = await knex('konsultasi_medik as km')
      .select(
        'km.no_permintaan',
        'km.no_rawat',
        'km.kd_dokter as kd_dokter_asal',
        'km.kd_dokter_dikonsuli',
        'km.diagnosa_kerja',
        'km.uraian_konsultasi',
        'dr_asal.nm_dokter as nm_dokter_asal',
        'p.nm_pasien'
      )
      .leftJoin('dokter as dr_asal', 'km.kd_dokter', 'dr_asal.kd_dokter')
      .leftJoin('reg_periksa as rp', 'km.no_rawat', 'rp.no_rawat')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('km.tanggal', '>', lastPollTime)
      .andWhere('km.tanggal', '<=', currentPollTime)
      .orderBy('km.tanggal', 'asc');

    for (const row of newKm) {
      logger.info(`[DB-Monitor] New consultation: ${row.no_permintaan} → dr ${row.kd_dokter_dikonsuli}`);
      await sendNotification(row.kd_dokter_dikonsuli, 'consultation_request', {
        no_permintaan: row.no_permintaan,
        no_rawat: row.no_rawat,
        nm_dokter_pemberi: row.nm_dokter_asal || 'System',
        diagnosa_kerja: row.diagnosa_kerja || '',
        uraian_konsultasi: row.uraian_konsultasi || '',
        nm_pasien: row.nm_pasien || 'Unknown',
      });
    }

    // ── 2. New SBAR requests (konsultasi_perawat) ──
    const newKp = await knex('konsultasi_perawat as kp')
      .select(
        'kp.no_permintaan',
        'kp.no_rawat',
        'kp.kd_dokter_dikonsuli',
        'kp.situation',
        'kp.nip',
        'pegawai.nama as nama_petugas',
        'p.nm_pasien'
      )
      .leftJoin('pegawai', 'kp.nip', 'pegawai.nik')
      .leftJoin('reg_periksa as rp', 'kp.no_rawat', 'rp.no_rawat')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('kp.tanggal', '>', lastPollTime)
      .andWhere('kp.tanggal', '<=', currentPollTime)
      .orderBy('kp.tanggal', 'asc');

    for (const row of newKp) {
      logger.info(`[DB-Monitor] New SBAR: ${row.no_permintaan} → dr ${row.kd_dokter_dikonsuli}`);
      await sendNotification(row.kd_dokter_dikonsuli, 'sbar_request', {
        no_permintaan: row.no_permintaan,
        no_rawat: row.no_rawat,
        nama_petugas: row.nama_petugas || 'Perawat',
        situation: row.situation || '',
        nm_pasien: row.nm_pasien || 'Unknown',
      });
    }

    // ── 3. New consultation responses (jawaban_konsultasi_medik) ──
    const newJkm = await knex('jawaban_konsultasi_medik as jkm')
      .select(
        'jkm.no_permintaan',
        'jkm.tanggal',
        'km.kd_dokter as kd_dokter_peminta',
        'dr_tujuan.nm_dokter as nm_dokter_dikonsuli'
      )
      .leftJoin('konsultasi_medik as km', 'jkm.no_permintaan', 'km.no_permintaan')
      .leftJoin('dokter as dr_tujuan', 'km.kd_dokter_dikonsuli', 'dr_tujuan.kd_dokter')
      .where('jkm.tanggal', '>', lastPollTime)
      .andWhere('jkm.tanggal', '<=', currentPollTime)
      .orderBy('jkm.tanggal', 'asc');

    for (const row of newJkm) {
      if (processedJkmPermintaan.has(row.no_permintaan)) continue;
      processedJkmPermintaan.add(row.no_permintaan);

      logger.info(`[DB-Monitor] New consultation reply: ${row.no_permintaan} → dr ${row.kd_dokter_peminta}`);
      await sendNotification(row.kd_dokter_peminta, 'consultation_response', {
        no_permintaan: row.no_permintaan,
        nm_dokter_dikonsuli: row.nm_dokter_dikonsuli || 'Rekan Dokter',
      });
    }

    // ── 4. New registrations (reg_periksa) ──
    const newReg = await knex('reg_periksa as rp')
      .select('rp.no_rawat', 'rp.kd_dokter', 'p.nm_pasien')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where(
        knex.raw("STR_TO_DATE(CONCAT(rp.tgl_registrasi, ' ', rp.jam_reg), '%Y-%m-%d %H:%i:%s')"),
        '>',
        lastPollTime
      )
      .andWhere(
        knex.raw("STR_TO_DATE(CONCAT(rp.tgl_registrasi, ' ', rp.jam_reg), '%Y-%m-%d %H:%i:%s')"),
        '<=',
        currentPollTime
      )
      .orderBy('rp.tgl_registrasi', 'asc')
      .orderBy('rp.jam_reg', 'asc');

    for (const row of newReg) {
      logger.info(`[DB-Monitor] New registration: ${row.no_rawat} → dr ${row.kd_dokter}`);
      await sendNotification(row.kd_dokter, 'new_admission', {
        no_rawat: row.no_rawat,
        nm_pasien: row.nm_pasien || 'Pasien Baru',
      });
    }

    // Advance polling window
    lastPollTime = currentPollTime;

  } catch (err) {
    logger.error('[DB-Monitor] Polling error:', err);
  } finally {
    isPolling = false;
  }
}

function start() {
  init().then(() => {
    setInterval(poll, 3000);
    // Cleanup old notifications once per hour
    setInterval(() => {
      cleanOldNotifications(7).catch((err) => {
        logger.error('[DB-Monitor] Cleanup error:', err);
      });
    }, 3600000);
  });
}

module.exports = { start };
