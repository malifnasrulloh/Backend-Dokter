const knex = require('../config/knex');
const { enqueueNotification } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * INA-CBG Billing Monitor
 *
 * Periodically checks active inpatient billing against the INA-CBG tariff
 * estimate (perkiraan_biaya_ranap.tarif). Sends notifications to the DPJP
 * doctor when configurable thresholds are crossed (80%, 100%, 120%).
 *
 * Uses in-memory tracking (not DB columns) to prevent repeat alerts for
 * the same threshold on the same patient visit — zero schema coupling.
 */

const THRESHOLDS = [80, 100, 120];
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ── In-memory dedup: no_rawat → Set<alerted_threshold> ──────────
// Cleared on restart. Persisting in DB is not worth the schema coupling.
const alerted = new Map();

let isPolling = false;

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // Single query: active Ranap patients where actual billing >= 80% of tariff
    const rows = await knex('reg_periksa as rp')
      .select(
        'rp.no_rawat',
        'rp.kd_dokter',
        'p.nm_pasien',
        knex.raw('COALESCE(SUM(b.totalbiaya), 0) as total_real'),
        'pbr.tarif as estimasi'
      )
      .leftJoin('billing as b', function () {
        this.on('rp.no_rawat', '=', 'b.no_rawat')
          .andOn('b.status', 'not like', 'Ttl%');
      })
      .leftJoin('perkiraan_biaya_ranap as pbr', 'rp.no_rawat', 'pbr.no_rawat')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('rp.status_lanjut', 'Ranap')
      .whereIn('rp.stts', ['Belum', 'Dirawat'])
      .whereNotNull('pbr.tarif')
      .groupBy('rp.no_rawat')
      .having(knex.raw('COALESCE(SUM(b.totalbiaya), 0)'), '>=', knex.raw('pbr.tarif * 0.8'));

    for (const row of rows) {
      const ratio = Math.round((Number(row.total_real) / Number(row.estimasi)) * 100);
      const already = alerted.get(row.no_rawat) || new Set();

      for (const threshold of THRESHOLDS) {
        if (ratio >= threshold && !already.has(threshold)) {
          const eventName =
            threshold === 80
              ? 'billing_threshold_80'
              : threshold === 100
              ? 'billing_threshold_100'
              : 'billing_threshold_120';

          await enqueueNotification(row.kd_dokter, eventName, {
            no_rawat: row.no_rawat,
            nm_pasien: row.nm_pasien || 'Unknown',
            total_real: row.total_real,
            estimasi_inacbg: row.estimasi,
            rasio: ratio,
          });

          already.add(threshold);
          alerted.set(row.no_rawat, already);

          logger.info(
            `[INACBG] Alerted ${row.kd_dokter} for ${row.no_rawat}: ${ratio}% (threshold ${threshold}%)`
          );
        }
      }
    }

    // ── Cleanup: remove discharged patients from memory ─────────
    // Build set of patients that still matched this poll cycle
    const activeThisCycle = new Set(rows.map((r) => r.no_rawat));
    for (const key of alerted.keys()) {
      if (!activeThisCycle.has(key)) {
        alerted.delete(key);
      }
    }
  } catch (err) {
    logger.error('[INACBG] Poll error:', err);
  } finally {
    isPolling = false;
  }
}

function start() {
  logger.info('[INACBG] Monitor started (interval: 5min)');
  poll(); // Run immediately on startup
  setInterval(poll, POLL_INTERVAL);
}

module.exports = { start };