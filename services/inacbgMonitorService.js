const knex = require('../config/knex');
const { enqueueNotification } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * INA-CBG Billing Monitor
 *
 * Periodically checks active inpatient billing against the INA-CBG tariff
 * estimate. Uses the billing denormalized table (same source as INA-CBG
 * claim submission) for simplicity and reliability.
 *
 * Thresholds: 80%, 100%, 120% of INA-CBG tariff.
 * In-memory dedup prevents repeat alerts — zero schema coupling.
 */

const THRESHOLDS = [80, 100, 120];
const POLL_INTERVAL = parseInt(process.env.INACBG_MONITOR_INTERVAL || '300000', 10);

// In-memory dedup: no_rawat -> Set of already-alerted thresholds
const alerted = new Map();
let isPolling = false;

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // Get all active Ranap patients with INA-CBG tariff
    // Use billing denormalized table for actual total, SUM only non-Ttl rows
    const patients = await knex('reg_periksa as rp')
      .select(
        'rp.no_rawat',
        'rp.kd_dokter',
        knex.raw('COALESCE(SUM(b.totalbiaya), 0) as total_real'),
        'pbr.tarif as estimasi',
        'p.nm_pasien'
      )
      .innerJoin('perkiraan_biaya_ranap as pbr', 'rp.no_rawat', 'pbr.no_rawat')
      .leftJoin('billing as b', function () {
        this.on('rp.no_rawat', '=', 'b.no_rawat')
          .andOn(knex.raw('b.status NOT LIKE ?', ['Ttl%']));
      })
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('rp.status_lanjut', 'Ranap')
      .whereIn('rp.stts', ['Belum', 'Dirawat'])
      .groupBy('rp.no_rawat');

    if (patients.length === 0) {
      logger.info('[INACBG] No active Ranap patients with tariff found');
      return;
    }

    for (const pt of patients) {
      const n = pt.no_rawat;
      const estimasi = Number(pt.estimasi) || 0;
      const totalReal = Number(pt.total_real) || 0;

      if (estimasi <= 0) continue;

      const ratio = Math.round((totalReal / estimasi) * 100);
      const already = alerted.get(n) || new Set();

      for (const threshold of THRESHOLDS) {
        if (ratio >= threshold && !already.has(threshold)) {
          const eventName =
            threshold === 80 ? 'billing_threshold_80'
            : threshold === 100 ? 'billing_threshold_100'
            : 'billing_threshold_120';

          await enqueueNotification(pt.kd_dokter, eventName, {
            no_rawat: n,
            nm_pasien: pt.nm_pasien || 'Unknown',
            total_real: totalReal,
            estimasi_inacbg: estimasi,
            rasio: ratio,
          });

          already.add(threshold);
          alerted.set(n, already);

          logger.info(`[INACBG] Alerted ${pt.kd_dokter} for ${n}: ${ratio}% (threshold ${threshold}%)`);
        }
      }
    }

    // Cleanup discharged patients from memory
    const activeSet = new Set(patients.map((r) => r.no_rawat));
    for (const key of alerted.keys()) {
      if (!activeSet.has(key)) alerted.delete(key);
    }
  } catch (err) {
    logger.error(`[INACBG] Poll error: ${err.message}`);
  } finally {
    isPolling = false;
  }
}

function start() {
  logger.info('[INACBG] Monitor started (interval: 5min)');
  poll();
  setInterval(poll, POLL_INTERVAL);
}

module.exports = { start };
