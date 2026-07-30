const knex = require('../config/knex');
const { enqueueNotification } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * INA-CBG Billing Monitor
 *
 * Periodically checks active inpatient billing against the INA-CBG tariff
 * estimate. Uses the same proven per-patient subquery from
 * perkiraanBiayaController.js — raw source tables, not billing denormalized.
 *
 * Thresholds: 80%, 100%, 120% of INA-CBG tariff.
 * In-memory dedup prevents repeat alerts — zero schema coupling.
 */

const THRESHOLDS = [80, 100, 120];
const POLL_INTERVAL = parseInt(process.env.INACBG_MONITOR_INTERVAL || '300000', 10);

const alerted = new Map();
let isPolling = false;

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // Get active Ranap patients WITH perkiraan_biaya_ranap tariff
    const patients = await knex('reg_periksa as rp')
      .select(
        'rp.no_rawat',
        'rp.kd_dokter',
        'rp.biaya_reg',
        'pbr.tarif as estimasi',
        'p.nm_pasien'
      )
      .innerJoin('perkiraan_biaya_ranap as pbr', 'rp.no_rawat', 'pbr.no_rawat')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('rp.status_lanjut', 'Ranap')
      .whereIn('rp.stts', ['Belum', 'Dirawat']);

    if (patients.length === 0) {
      logger.info('[INACBG] No active Ranap patients with tariff found');
      return;
    }

    // Compute total billing per patient using the same subquery as controller
    for (const pt of patients) {
      const n = pt.no_rawat;
      const estimasi = Number(pt.estimasi) || 0;
      if (estimasi <= 0) continue;

      // Same query as perkiraanBiayaController.js — raw source table totals
      const [rows] = await knex.raw(`
        SELECT
          COALESCE((
            SELECT COALESCE(SUM(bhp), 0) FROM rawat_jl_pr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(bhp), 0) FROM rawat_jl_dr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(bhp), 0) FROM rawat_jl_drpr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(bhp), 0) FROM rawat_inap_pr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(bhp), 0) FROM rawat_inap_dr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(bhp), 0) FROM rawat_inap_drpr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya LIKE '%OKSIGEN%'
          ), 0) AS bhp,

          COALESCE((
            SELECT COALESCE(SUM(ttl_biaya), 0) FROM kamar_inap WHERE no_rawat = ?
          ), 0) AS kamar,

          COALESCE((
            SELECT COALESCE(SUM(biaya_harian.jml * biaya_harian.besar_biaya * kamar_inap.lama), 0)
            FROM kamar_inap INNER JOIN biaya_harian ON kamar_inap.kd_kamar = biaya_harian.kd_kamar
            WHERE kamar_inap.no_rawat = ?
          ), 0) AS harian,

          COALESCE((
            SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_jl_pr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_jl_dr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_jl_drpr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_inap_pr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_inap_dr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_inap_drpr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(biayaalat + biayasewaok + akomodasi + bagian_rs + biayasarpras), 0) FROM operasi WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya NOT LIKE '%OKSIGEN%' AND nama_biaya NOT LIKE '%LAB%' AND nama_biaya NOT LIKE '%RAD%'
          ), 0) AS rumahsakit,

          COALESCE((
            SELECT COALESCE(SUM(tarif_tindakanpr), 0) FROM rawat_jl_pr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(tarif_tindakandr), 0) FROM rawat_jl_dr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(tarif_tindakanpr + tarif_tindakandr), 0) FROM rawat_jl_drpr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(tarif_tindakanpr), 0) FROM rawat_inap_pr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(tarif_tindakandr), 0) FROM rawat_inap_dr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(tarif_tindakanpr + tarif_tindakandr), 0) FROM rawat_inap_drpr WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(biayaoperator1 + biayaoperator2 + biayaoperator3 + biayaasisten_operator1 + biayaasisten_operator2 + biayaasisten_operator3 + biayainstrumen + biayadokter_anak + biayaperawaat_resusitas + biayadokter_anestesi + biayaasisten_anestesi + biayaasisten_anestesi2 + biayabidan + biayabidan2 + biayabidan3 + biayaperawat_luar + biaya_omloop + biaya_omloop2 + biaya_omloop3 + biaya_omloop4 + biaya_omloop5 + biaya_dokter_pjanak + biaya_dokter_umum), 0) FROM operasi WHERE no_rawat = ?
          ), 0) AS jasa,

          COALESCE((
            SELECT COALESCE(SUM(biaya), 0) FROM periksa_lab WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(biaya_item), 0) FROM detail_periksa_lab WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya LIKE '%LAB%'
          ), 0) AS laborat,

          COALESCE((
            SELECT COALESCE(SUM(biaya), 0) FROM periksa_radiologi WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya LIKE '%RAD%'
          ), 0) AS radiologi,

          COALESCE((
            SELECT COALESCE(SUM(total), 0) FROM detail_pemberian_obat WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(besar_tagihan), 0) FROM tagihan_obat_langsung WHERE no_rawat = ?
          ) + (
            SELECT COALESCE(SUM(hargasatuan * jumlah), 0) FROM beri_obat_operasi WHERE no_rawat = ?
          ), 0) AS obat,

          COALESCE((
            SELECT COALESCE(SUM(total), 0) FROM resep_pulang WHERE no_rawat = ?
          ), 0) AS resep_pulang,

          COALESCE((
            SELECT COALESCE(SUM(besar_pengurangan), 0) FROM pengurangan_biaya WHERE no_rawat = ?
          ), 0) AS potongan
      `, Array(39).fill(n));

      const d = rows[0] || {};
      const bhp = Number(d.bhp) || 0;
      const registrasi = Number(pt.biaya_reg) || 0;
      const kamar = Number(d.kamar) || 0;
      const harian = Number(d.harian) || 0;
      const rumahsakit = Number(d.rumahsakit) || 0;
      const jasa = Number(d.jasa) || 0;
      const laborat = Number(d.laborat) || 0;
      const radiologi = Number(d.radiologi) || 0;
      const obat = Number(d.obat) || 0;
      const resep_pulang = Number(d.resep_pulang) || 0;
      const potongan = Number(d.potongan) || 0;

      const jumlah_rs = bhp + registrasi + kamar + harian + rumahsakit;
      const jumlah_penunjang = laborat + radiologi + obat + resep_pulang;
      const total_biaya = jumlah_rs + jasa + jumlah_penunjang + potongan;

      const ratio = Math.round((total_biaya / estimasi) * 100);
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
            total_real: total_biaya,
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
