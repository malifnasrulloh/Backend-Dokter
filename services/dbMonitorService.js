const knex = require('../config/knex');
const { sendNotification } = require('../controllers/main/notificationController');
const { cleanOldNotifications } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * DB Monitor — Unconditional polling for real-time notifications.
 *
 * Uses MAX(auto_increment id) to detect NEW rows in each source table.
 * This is the ONLY approach that works regardless of:
 * - What timestamp format the source app uses (CURDATE, NOW, etc.)
 * - What timezone the source app uses
 * - JOIN failures from missing reference data (LEFT JOIN handles this)
 *
 * In-memory dedup Sets prevent re-sending on restart or edge cases.
 */

// ── Per-table tracking ──
// Store the last-seen MAX(id) for each source table
const lastMaxId = {
  konsultasi_medik: 0,
  konsultasi_perawat: 0,
  jawaban_konsultasi_medik: 0,
  reg_periksa: 0,
};

// Dedup Sets: populated at init, prevents re-sending across restarts
const dedup = {
  konsultasiMedik: new Set(),
  konsultasiPerawat: new Set(),
  jawabanKonsultasi: new Set(),
  regPeriksa: new Set(),
};

let isPolling = false;

// ── Init ───────────────────────────────────────────────────────────

async function init() {
  try {
    // Pre-populate dedup with ALL existing rows so historical ones never fire
    const populate = async (table, idColumn, destSet) => {
      const rows = await knex(table).select(idColumn);
      for (const r of rows) destSet.add(r[idColumn]);
    };

    await Promise.all([
      populate('konsultasi_medik', 'no_permintaan', dedup.konsultasiMedik),
      populate('konsultasi_perawat', 'no_permintaan', dedup.konsultasiPerawat),
      populate('jawaban_konsultasi_medik', 'no_permintaan', dedup.jawabanKonsultasi),
      populate('reg_periksa', 'no_rawat', dedup.regPeriksa),
    ]);

    // Get current MAX ids
    const getMax = async (table, idCol) => {
      const [row] = await knex(table).max(`${idCol} as mx`);
      return row?.mx ?? 0;
    };

    lastMaxId.konsultasi_medik = await getMax('konsultasi_medik', 'no_permintaan');
    lastMaxId.konsultasi_perawat = await getMax('konsultasi_perawat', 'no_permintaan');
    lastMaxId.jawaban_konsultasi_medik = await getMax('jawaban_konsultasi_medik', 'no_permintaan');
    lastMaxId.reg_periksa = await getMax('reg_periksa', 'no_rawat');

    logger.info(
      `[DB-Monitor] Started. Dedup pre-loaded: KM=${dedup.konsultasiMedik.size} KP=${dedup.konsultasiPerawat.size} JKM=${dedup.jawabanKonsultasi.size} RP=${dedup.regPeriksa.size}`
    );
  } catch (err) {
    logger.error('[DB-Monitor] Init error:', err);
  }
}

// ── Poll ───────────────────────────────────────────────────────────

/**
 * Helper: fetch rows where string id > lastMax, with LEFT JOIN + fallbacks.
 * Uses string comparison (no_permintaan / no_rawat) since those are the
 * only available identifiers in these legacy tables (no numeric PK).
 */
async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // ── 1. New consultation requests (konsultasi_medik) ──
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
      .where('km.no_permintaan', '>', lastMaxId.konsultasi_medik)
      .orderBy('km.no_permintaan', 'asc');

    for (const row of newKm) {
      if (dedup.konsultasiMedik.has(row.no_permintaan)) continue;
      dedup.konsultasiMedik.add(row.no_permintaan);
      lastMaxId.konsultasi_medik = row.no_permintaan;

      logger.info(
        `[DB-Monitor] New consultation: ${row.no_permintaan} → dr ${row.kd_dokter_dikonsuli}`
      );
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
      .where('kp.no_permintaan', '>', lastMaxId.konsultasi_perawat)
      .orderBy('kp.no_permintaan', 'asc');

    for (const row of newKp) {
      if (dedup.konsultasiPerawat.has(row.no_permintaan)) continue;
      dedup.konsultasiPerawat.add(row.no_permintaan);
      lastMaxId.konsultasi_perawat = row.no_permintaan;

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
      .where('jkm.no_permintaan', '>', lastMaxId.jawaban_konsultasi_medik)
      .orderBy('jkm.no_permintaan', 'asc');

    for (const row of newJkm) {
      if (dedup.jawabanKonsultasi.has(row.no_permintaan)) continue;
      dedup.jawabanKonsultasi.add(row.no_permintaan);
      lastMaxId.jawaban_konsultasi_medik = row.no_permintaan;

      logger.info(
        `[DB-Monitor] New consultation reply: ${row.no_permintaan} → dr ${row.kd_dokter_peminta}`
      );
      await sendNotification(row.kd_dokter_peminta, 'consultation_response', {
        no_permintaan: row.no_permintaan,
        nm_dokter_dikonsuli: row.nm_dokter_dikonsuli || 'Rekan Dokter',
      });
    }

    // ── 4. New registrations (reg_periksa) ──
    const newReg = await knex('reg_periksa as rp')
      .select('rp.no_rawat', 'rp.kd_dokter', 'p.nm_pasien')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('rp.no_rawat', '>', lastMaxId.reg_periksa)
      .orderBy('rp.no_rawat', 'asc');

    for (const row of newReg) {
      if (dedup.regPeriksa.has(row.no_rawat)) continue;
      dedup.regPeriksa.add(row.no_rawat);
      lastMaxId.reg_periksa = row.no_rawat;

      logger.info(`[DB-Monitor] New registration: ${row.no_rawat} → dr ${row.kd_dokter}`);
      await sendNotification(row.kd_dokter, 'new_admission', {
        no_rawat: row.no_rawat,
        nm_pasien: row.nm_pasien || 'Pasien Baru',
      });
    }
  } catch (err) {
    logger.error('[DB-Monitor] Polling error:', err);
  } finally {
    isPolling = false;
  }
}

// ── Start ──────────────────────────────────────────────────────────

function start() {
  const pollInterval = parseInt(process.env.DB_MONITOR_INTERVAL || '3000', 10);
  init().then(() => {
    if (pollInterval > 0) setInterval(poll, pollInterval);
    // Cleanup old notifications once per hour
    setInterval(() => {
      cleanOldNotifications(7).catch((err) => {
        logger.error('[DB-Monitor] Cleanup error:', err);
      });
    }, 3600000);
  });
}

module.exports = { start };
