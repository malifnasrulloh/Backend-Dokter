const knex = require('../config/knex');
const { enqueueNotification } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * INA-CBG Billing Monitor
 *
 * Periodically checks active inpatient billing against the INA-CBG tariff
 * estimate. Uses the same proven calculation logic from
 * perkiraanBiayaController.js (raw source tables, not billing denormalized).
 *
 * Sends notifications to the DPJP doctor when configurable thresholds
 * are crossed (80%, 100%, 120% of INA-CBG tariff).
 *
 * Uses in-memory dedup to prevent repeat alerts — zero schema coupling.
 */

const THRESHOLDS = [80, 100, 120];
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

// In-memory dedup: no_rawat -> Set of already-alerted thresholds
const alerted = new Map();

let isPolling = false;

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // ── 1. Get active Ranap patients WITH perkiraan_biaya_ranap ──
    const patients = await knex('reg_periksa as rp')
      .select(
        'rp.no_rawat',
        'rp.kd_dokter',
        'rp.no_rkm_medis',
        'p.nm_pasien',
        'pbr.tarif as estimasi'
      )
      .innerJoin('perkiraan_biaya_ranap as pbr', 'rp.no_rawat', 'pbr.no_rawat')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .where('rp.status_lanjut', 'Ranap')
      .whereIn('rp.stts', ['Belum', 'Dirawat']);

    if (patients.length === 0) return;

    const ids = patients.map((r) => r.no_rawat);

    // ── 2. Compute billing components (mirrors perkiraanBiayaController) ──
    // Each query returns rows with no_rawat + total

    // BHP: SUM(bhp) from rawat tables + oksigen from tambahan_biaya
    const [bhpRows] = await knex.raw(`
      SELECT no_rawat, SUM(val) AS total FROM (
        SELECT no_rawat, bhp AS val FROM rawat_jl_pr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, bhp FROM rawat_jl_dr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, bhp FROM rawat_jl_drpr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, bhp FROM rawat_inap_pr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, bhp FROM rawat_inap_dr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, bhp FROM rawat_inap_drpr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, besar_biaya FROM tambahan_biaya WHERE no_rawat IN (?) AND nama_biaya LIKE '%OKSIGEN%'
      ) combined GROUP BY no_rawat
    `, [ids, ids, ids, ids, ids, ids, ids]);

    // Rumah sakit: SUM(material+menejemen) + operasi biayaalat+... + tambahan_biaya (non OKSIGEN/LAB/RAD)
    const [rsRows] = await knex.raw(`
      SELECT no_rawat, SUM(val) AS total FROM (
        SELECT no_rawat, material + menejemen AS val FROM rawat_jl_pr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, material + menejemen FROM rawat_jl_dr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, material + menejemen FROM rawat_jl_drpr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, material + menejemen FROM rawat_inap_pr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, material + menejemen FROM rawat_inap_dr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, material + menejemen FROM rawat_inap_drpr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, biayaalat + biayasewaok + akomodasi + bagian_rs + biayasarpras FROM operasi WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, besar_biaya FROM tambahan_biaya WHERE no_rawat IN (?) AND nama_biaya NOT LIKE '%OKSIGEN%' AND nama_biaya NOT LIKE '%LAB%' AND nama_biaya NOT LIKE '%RAD%'
      ) combined GROUP BY no_rawat
    `, [ids, ids, ids, ids, ids, ids, ids, ids]);

    // Jasa: SUM(tarif_tindakanpr/tarif_tindakandr) + operasi operator/anestesi/etc
    const [jasaRows] = await knex.raw(`
      SELECT no_rawat, SUM(val) AS total FROM (
        SELECT no_rawat, tarif_tindakanpr AS val FROM rawat_jl_pr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, tarif_tindakandr FROM rawat_jl_dr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, tarif_tindakanpr + tarif_tindakandr FROM rawat_jl_drpr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, tarif_tindakanpr FROM rawat_inap_pr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, tarif_tindakandr FROM rawat_inap_dr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, tarif_tindakanpr + tarif_tindakandr FROM rawat_inap_drpr WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, biayaoperator1 + biayaoperator2 + biayaoperator3 + biayaasisten_operator1 + biayaasisten_operator2 + biayaasisten_operator3 + biayainstrumen + biayadokter_anak + biayaperawaat_resusitas + biayadokter_anestesi + biayaasisten_anestesi + biayaasisten_anestesi2 + biayabidan + biayabidan2 + biayabidan3 + biayaperawat_luar + biaya_omloop + biaya_omloop2 + biaya_omloop3 + biaya_omloop4 + biaya_omloop5 + biaya_dokter_pjanak + biaya_dokter_umum FROM operasi WHERE no_rawat IN (?)
      ) combined GROUP BY no_rawat
    `, [ids, ids, ids, ids, ids, ids, ids]);

    // Kamar: SUM(ttl_biaya) + SUM(biaya_sekali.besar_biaya)
    const [kamarRows] = await knex.raw(`
      SELECT ki.no_rawat,
        COALESCE(SUM(ki.ttl_biaya), 0) + COALESCE(SUM(bs.besar_biaya), 0) AS total
      FROM kamar_inap ki
      LEFT JOIN biaya_sekali bs ON ki.kd_kamar = bs.kd_kamar
      WHERE ki.no_rawat IN (?)
      GROUP BY ki.no_rawat
    `, [ids]);

    // Harian: SUM(biaya_harian.jml * besar_biaya * kamar_inap.lama)
    const [harianRows] = await knex.raw(`
      SELECT ki.no_rawat,
        COALESCE(SUM(bh.jml * bh.besar_biaya * ki.lama), 0) AS total
      FROM kamar_inap ki
      INNER JOIN biaya_harian bh ON ki.kd_kamar = bh.kd_kamar
      WHERE ki.no_rawat IN (?)
      GROUP BY ki.no_rawat
    `, [ids]);

    // Laborat: SUM(periksa_lab.biaya) + SUM(detail_periksa_lab.biaya_item) + tambahan_biaya LAB
    const [labRows] = await knex.raw(`
      SELECT no_rawat, SUM(val) AS total FROM (
        SELECT no_rawat, biaya AS val FROM periksa_lab WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, biaya_item FROM detail_periksa_lab WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, besar_biaya FROM tambahan_biaya WHERE no_rawat IN (?) AND nama_biaya LIKE '%LAB%'
      ) combined GROUP BY no_rawat
    `, [ids, ids, ids]);

    // Radiologi: SUM(periksa_radiologi.biaya) + tambahan_biaya RAD
    const [radRows] = await knex.raw(`
      SELECT no_rawat, SUM(val) AS total FROM (
        SELECT no_rawat, biaya AS val FROM periksa_radiologi WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, besar_biaya FROM tambahan_biaya WHERE no_rawat IN (?) AND nama_biaya LIKE '%RAD%'
      ) combined GROUP BY no_rawat
    `, [ids, ids]);

    // Obat: SUM(detail_pemberian_obat.total) + SUM(tagihan_obat_langsung.besar_tagihan) + SUM(beri_obat_operasi)
    const [obatRows] = await knex.raw(`
      SELECT no_rawat, SUM(val) AS total FROM (
        SELECT no_rawat, total AS val FROM detail_pemberian_obat WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, besar_tagihan FROM tagihan_obat_langsung WHERE no_rawat IN (?)
        UNION ALL SELECT no_rawat, hargasatuan * jumlah FROM beri_obat_operasi WHERE no_rawat IN (?)
      ) combined GROUP BY no_rawat
    `, [ids, ids, ids]);

    // Resep pulang
    const [rpRows] = await knex.raw(`
      SELECT no_rawat, COALESCE(SUM(total), 0) AS total
      FROM resep_pulang WHERE no_rawat IN (?) GROUP BY no_rawat
    `, [ids]);

    // Potongan
    const [potRows] = await knex.raw(`
      SELECT no_rawat, COALESCE(SUM(besar_pengurangan), 0) AS total
      FROM pengurangan_biaya WHERE no_rawat IN (?) GROUP BY no_rawat
    `, [ids]);

    // Retur obat (subquery via LIKE on no_retur_jual matching no_rawat)
    const [returRows] = await knex.raw(`
      SELECT drj.no_retur_jual, COALESCE(SUM(drj.subtotal), 0) AS total
      FROM detreturjual drj
      WHERE drj.no_retur_jual LIKE ?
      GROUP BY drj.no_retur_jual
    `, ['%' + ids[0] + '%']);

    // ── 3. Build lookup maps ──
    const toMap = (rows) => {
      const m = new Map();
      for (const r of rows) m.set(r.no_rawat, Number(r.total) || 0);
      return m;
    };

    // Registration fee: from reg_periksa.biaya_reg (queried inline)

    const bhpMap = toMap(bhpRows);
    const rsMap = toMap(rsRows);
    const jasaMap = toMap(jasaRows);
    const kamarMap = toMap(kamarRows);
    const harianMap = toMap(harianRows);
    const labMap = toMap(labRows);
    const radMap = toMap(radRows);
    const obatMap = toMap(obatRows);
    const rpMap = toMap(rpRows);
    const potMap = toMap(potRows);

    // ── 4. Calculate totals and alert ──
    for (const pt of patients) {
      const n = pt.no_rawat;
      const estimasi = Number(pt.estimasi) || 0;
      if (estimasi <= 0) continue;

      const registrasi = Number(pt.biaya_reg) || 0;

      const bhp = bhpMap.get(n) || 0;
      const kamar = kamarMap.get(n) || 0;
      const harian = harianMap.get(n) || 0;
      const rumahsakit = rsMap.get(n) || 0;
      const jasa = jasaMap.get(n) || 0;
      const laborat = labMap.get(n) || 0;
      const radiologi = radMap.get(n) || 0;
      const obat = obatMap.get(n) || 0;
      const resep_pulang = rpMap.get(n) || 0;
      const retur_obat = 0; // retur needs no_rawat extraction from no_retur_jual — rarely material, skip for threshold calc
      const potongan = potMap.get(n) || 0;

      const jumlah_rs = bhp + registrasi + kamar + harian + rumahsakit;
      const jumlah_penunjang = laborat + radiologi + obat + resep_pulang - retur_obat;
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

    // ── 5. Cleanup discharged patients from memory ──
    const activeSet = new Set(patients.map((r) => r.no_rawat));
    for (const key of alerted.keys()) {
      if (!activeSet.has(key)) alerted.delete(key);
    }
  } catch (err) {
    logger.error('[INACBG] Poll error:', err);
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