const knex = require('../config/knex');
const { enqueueNotification } = require('./notificationQueueService');
const { logger } = require('../middleware/logger');

/**
 * INA-CBG Billing Monitor
 *
 * Periodically checks active inpatient billing against the INA-CBG tariff
 * estimate. Uses raw source tables matching perkiraanBiayaController.js.
 *
 * Active Ranap Patient Criteria:
 *   - reg_periksa.status_lanjut = 'Ranap'
 *   - reg_periksa.status_bayar = 'Belum Bayar'
 *   - kamar_inap.stts_pulang = '-'
 *   - (kamar_inap.tgl_keluar IS NULL OR kamar_inap.tgl_keluar = '0000-00-00')
 *
 * Notifications:
 *   - Thresholds: 80%, 100%, 120% of INA-CBG tariff.
 *   - Recipients: All assigned DPJPs (dpjp_ranap), falling back to reg_periksa.kd_dokter.
 *   - Target Identifier: Resolved login username / NIK via dokter_user_mapping / pegawai.
 *   - Deduplication: Checked against notification_queue (persists across restarts).
 */

const THRESHOLDS = [80, 100, 120];
const POLL_INTERVAL = Number.parseInt(process.env.INACBG_MONITOR_INTERVAL || '300000', 10);

let pollTimer = null;
let isPolling = false;

/**
 * Resolves a kd_dokter to the doctor's login username/NIK.
 */
async function resolveDoctorNik(kdDokter) {
  if (!kdDokter || typeof kdDokter !== 'string') return kdDokter;

  try {
    // 1. Check dokter_user_mapping
    const mapped = await knex('dokter_user_mapping')
      .select('username')
      .where('kd_dokter', kdDokter)
      .first();
    if (mapped?.username) return mapped.username;

    // 2. Check if kd_dokter already matches a pegawai.nik
    const peg = await knex('pegawai').select('nik').where('nik', kdDokter).first();
    if (peg?.nik) return peg.nik;

    // 3. Heuristic: match by dokter.nm_dokter = pegawai.nama
    const doc = await knex('dokter').select('nm_dokter').where('kd_dokter', kdDokter).first();
    if (doc?.nm_dokter) {
      const pegName = await knex('pegawai').select('nik').where('nama', doc.nm_dokter).first();
      if (pegName?.nik) return pegName.nik;
    }
  } catch (err) {
    logger.warn(`[INACBG] Error resolving NIK for doctor ${kdDokter}: ${err.message}`);
  }

  return kdDokter;
}

/**
 * Gets all target NIKs to notify for a given no_rawat (all DPJPs + fallback to reg doctor).
 */
async function getRecipientsForPatient(noRawat, defaultKdDokter) {
  const niks = new Set();

  try {
    const dpjps = await knex('dpjp_ranap').select('kd_dokter').where('no_rawat', noRawat);

    if (dpjps.length > 0) {
      for (const row of dpjps) {
        const nik = await resolveDoctorNik(row.kd_dokter);
        if (nik) niks.add(nik);
      }
    } else if (defaultKdDokter) {
      const nik = await resolveDoctorNik(defaultKdDokter);
      if (nik) niks.add(nik);
    }
  } catch (err) {
    logger.warn(`[INACBG] Error fetching recipients for ${noRawat}: ${err.message}`);
    if (defaultKdDokter) niks.add(defaultKdDokter);
  }

  return [...niks];
}

/**
 * Checks if an alert for this patient and threshold already exists in notification_queue.
 */
async function hasBeenAlerted(nik, eventName, noRawat) {
  try {
    const row = await knex('notification_queue')
      .select('id')
      .where({ nik, event_type: eventName })
      .whereNull('deleted_at')
      .whereRaw("JSON_UNQUOTE(JSON_EXTRACT(payload, '$.no_rawat')) = ?", [noRawat])
      .first();
    return Boolean(row);
  } catch (_err) {
    // If JSON extract is unsupported or fails, fall back to LIKE query
    try {
      const rowFallback = await knex('notification_queue')
        .select('id')
        .where({ nik, event_type: eventName })
        .whereNull('deleted_at')
        .where('payload', 'like', `%"no_rawat":"${noRawat}"%`)
        .first();
      return Boolean(rowFallback);
    } catch {
      return false;
    }
  }
}

async function poll() {
  if (isPolling) return;
  isPolling = true;

  try {
    // 1. Get active Ranap patients with tariff in perkiraan_biaya_ranap
    const patients = await knex('reg_periksa as rp')
      .join('kamar_inap as ki', 'rp.no_rawat', 'ki.no_rawat')
      .join('perkiraan_biaya_ranap as pbr', 'rp.no_rawat', 'pbr.no_rawat')
      .leftJoin('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .select('rp.no_rawat', 'rp.kd_dokter', 'rp.biaya_reg', 'p.nm_pasien')
      .max('pbr.tarif as estimasi')
      .where('rp.status_lanjut', 'Ranap')
      .where('rp.status_bayar', 'Belum Bayar')
      .where('ki.stts_pulang', '-')
      .where((qb) => {
        qb.whereNull('ki.tgl_keluar').orWhere('ki.tgl_keluar', '0000-00-00');
      })
      .groupBy('rp.no_rawat', 'rp.kd_dokter', 'rp.biaya_reg', 'p.nm_pasien')
      .having(knex.raw('COALESCE(MAX(pbr.tarif), 0) > 0'));

    if (patients.length === 0) {
      logger.info('[INACBG] No active Ranap patients with INA-CBG tariff found');
      return;
    }

    // 2. Compute total billing per patient using raw source tables
    for (const pt of patients) {
      const n = pt.no_rawat;
      const estimasi = Number(pt.estimasi) || 0;
      if (estimasi <= 0) continue;

      const [rows] = await knex.raw(
        `
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
      `,
        Array(34).fill(n)
      );

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

      // 3. Resolve target recipients (DPJPs + fallback)
      const recipientNiks = await getRecipientsForPatient(n, pt.kd_dokter);

      for (const threshold of THRESHOLDS) {
        if (ratio >= threshold) {
          const eventName =
            threshold === 80
              ? 'billing_threshold_80'
              : threshold === 100
                ? 'billing_threshold_100'
                : 'billing_threshold_120';

          for (const targetNik of recipientNiks) {
            const alreadyAlerted = await hasBeenAlerted(targetNik, eventName, n);
            if (!alreadyAlerted) {
              await enqueueNotification(targetNik, eventName, {
                no_rawat: n,
                nm_pasien: pt.nm_pasien || 'Unknown',
                total_real: total_biaya,
                estimasi_inacbg: estimasi,
                rasio: ratio,
              });

              logger.info(
                `[INACBG] Alerted ${targetNik} for ${n}: ${ratio}% (threshold ${threshold}%)`
              );
            }
          }
        }
      }
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
  if (!pollTimer) {
    pollTimer = setInterval(poll, POLL_INTERVAL);
  }
}

function stop() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  start,
  stop,
  poll,
  resolveDoctorNik,
  getRecipientsForPatient,
};
