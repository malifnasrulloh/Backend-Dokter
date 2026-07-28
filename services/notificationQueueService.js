const knex = require('../config/knex');
const { logger } = require('../middleware/logger');

/**
 * Enqueue a notification into the notification_queue table.
 * Constructs human-readable title/body based on event type.
 */
async function enqueueNotification(targetNik, eventName, data) {
  let title = '';
  let body = '';

  switch (eventName) {
    case 'consultation_request':
      title = 'Konsultasi Baru';
      body = `Permintaan konsultasi dari ${data?.nm_dokter_pemberi || 'Rekan Dokter'}: "${data?.diagnosa_kerja || ''}"`;
      break;
    case 'consultation_response':
      title = 'Konsultasi Dijawab';
      body = `Balasan dari ${data?.nm_dokter_dikonsuli || 'Rekan Dokter'} untuk permintaan ${data?.no_permintaan || ''}`;
      break;
    case 'new_admission':
      title = 'Pasien Baru Terdaftar';
      body = `Anda telah didelegasikan sebagai DPJP untuk ${data?.nm_pasien || 'Pasien Baru'} (${data?.no_rawat || ''})`;
      break;
    case 'emergency_igd_consultation':
      title = 'URGENT: KONSUL IGD';
      body = `Permintaan konsultasi segera dari ${data?.nm_dokter_pemberi || 'Rekan Dokter'} untuk pasien ${data?.nm_pasien || 'Pasien'}`;
      break;
    case 'sbar_request':
      title = 'Permintaan SBAR Baru';
      body = `S: ${data?.situation || ''}\nB: ${data?.background || ''}\nA: ${data?.assessment || ''}\nR: ${data?.recomendation || ''}`;
      break;
    // ── B. Laboratory ──
    case 'lab_request':
      title = 'Permintaan Laboratorium Baru';
      body = `Permintaan lab untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_rawat || ''})`;
      break;
    case 'labpa_request':
      title = 'Permintaan PA Baru';
      body = `Permintaan Patologi Anatomi untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_rawat || ''})`;
      break;
    case 'labmb_request':
      title = 'Permintaan Lab MB Baru';
      body = `Permintaan laboratorium molekuler untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_rawat || ''})`;
      break;
    // ── C. Radiology ──
    case 'radiology_request':
      title = 'Permintaan Radiologi Baru';
      body = `Permintaan radiologi untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_rawat || ''})`;
      break;
    // ── D. Prescription & Medication ──
    case 'discharge_prescription':
      title = 'Resep Pulang Baru';
      body = `Resep pulang untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_permintaan || ''})`;
      break;
    case 'prescription_dispensed':
      title = 'Resep Telah Dilayani';
      body = `Resep pulang ${data?.no_permintaan || ''} telah dilayani`;
      break;
    case 'medication_stock_request':
      title = 'Stok Obat Pasien';
      body = `Permintaan stok obat untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_permintaan || ''})`;
      break;
    case 'medication_dispensed':
      title = 'Stok Obat Tersedia';
      body = `Stok obat ${data?.no_permintaan || ''} tersedia`;
      break;
    // ── E. Patient Services ──
    case 'spiritual_guidance_request':
      title = 'Bimbingan Rohani';
      body = `Bimbingan rohani untuk ${data?.nm_pasien || 'Pasien'} — ${data?.jns_pelayanan || ''}`;
      break;
    case 'second_opinion_request':
      title = 'Second Opinion';
      body = `Second opinion untuk ${data?.nm_pasien || 'Pasien'} oleh ${data?.pembuat_pernyataan || ''}`;
      break;
    case 'surgery_booking':
      title = 'Booking Operasi Baru';
      body = `Booking operasi untuk ${data?.nm_pasien || 'Pasien'} pada ${data?.tanggal || ''}`;
      break;
    case 'bed_request':
      title = 'Permintaan Rawat Inap';
      body = `Permintaan ranap untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_rawat || ''}) — ${data?.diagnosa || ''}`;
      break;
    case 'medication_request':
      title = 'Permintaan Obat';
      body = `Permintaan obat untuk ${data?.nm_pasien || 'Pasien'} (${data?.no_rawat || ''})`;
      break;
    // ── F. Employee / Supply ──
    case 'kitchen_request':
      title = 'Permintaan Dapur Baru';
      body = `Permintaan dapur oleh ${data?.nama_pegawai || 'Pegawai'} (${data?.no_permintaan || ''})`;
      break;
    case 'kitchen_approved':
      title = 'Permintaan Dapur Disetujui';
      body = `Permintaan dapur ${data?.no_permintaan || ''} telah disetujui`;
      break;
    case 'kitchen_rejected':
      title = 'Permintaan Dapur Ditolak';
      body = `Permintaan dapur ${data?.no_permintaan || ''} ditolak`;
      break;
    case 'medical_supply_request':
      title = 'Barang Medis';
      body = `Permintaan barang medis oleh ${data?.nama_pegawai || 'Pegawai'} (${data?.no_permintaan || ''})`;
      break;
    case 'medical_supply_approved':
      title = 'Barang Medis Disetujui';
      body = `Permintaan barang medis ${data?.no_permintaan || ''} telah disetujui`;
      break;
    case 'medical_supply_rejected':
      title = 'Barang Medis Ditolak';
      body = `Permintaan barang medis ${data?.no_permintaan || ''} ditolak`;
      break;
    case 'non_medical_request':
      title = 'Non Medis';
      body = `Permintaan non medis oleh ${data?.nama_pegawai || 'Pegawai'} (${data?.no_permintaan || ''})`;
      break;
    case 'non_medical_approved':
      title = 'Non Medis Disetujui';
      body = `Permintaan non medis ${data?.no_permintaan || ''} telah disetujui`;
      break;
    case 'non_medical_rejected':
      title = 'Non Medis Ditolak';
      body = `Permintaan non medis ${data?.no_permintaan || ''} ditolak`;
      break;
    case 'inventory_repair_request':
      title = 'Perbaikan Inventaris';
      body = `Permintaan perbaikan ${data?.no_inventaris || ''}: ${data?.deskripsi_kerusakan || ''}`;
      break;
    case 'violence_protection_letter':
      title = 'Perlindungan Kekerasan';
      body = `Surat perlindungan untuk ${data?.no_rawat || ''}`;
      break;
    // ── G. HR & Admin ──
    case 'leave_application':
      title = 'Pengajuan Cuti Baru';
      body = `${data?.nama_pegawai || 'Pegawai'} mengajukan cuti`;
      break;
    case 'leave_approved':
      title = 'Cuti Disetujui';
      body = `Pengajuan cuti ${data?.no_pengajuan || ''} telah disetujui`;
      break;
    case 'leave_rejected':
      title = 'Cuti Ditolak';
      body = `Pengajuan cuti ${data?.no_pengajuan || ''} ditolak`;
      break;
    case 'inventory_application':
      title = 'Pengajuan Inventaris Baru';
      body = `Pengajuan inventaris oleh ${data?.nama_pegawai || 'Pegawai'}`;
      break;
    case 'inventory_approved':
      title = 'Inventaris Disetujui';
      body = `Pengajuan inventaris ${data?.no_pengajuan || ''} telah disetujui`;
      break;
    case 'inventory_rejected':
      title = 'Inventaris Ditolak';
      body = `Pengajuan inventaris ${data?.no_pengajuan || ''} ditolak`;
      break;
    // ── INA-CBG Billing Threshold ──
    case 'billing_threshold_80':
      title = 'Biaya Mendekati Batas CBG';
      body = `Biaya pasien ${data?.nm_pasien || 'Unknown'} (${data?.no_rawat || ''}) telah mencapai 80% dari tarif CBG`;
      break;
    case 'billing_threshold_100':
      title = 'Biaya Mencapai Batas CBG';
      body = `Biaya pasien ${data?.nm_pasien || 'Unknown'} (${data?.no_rawat || ''}) telah mencapai 100% dari tarif CBG`;
      break;
    case 'billing_threshold_120':
      title = 'Biaya Melebihi Batas CBG';
      body = `Biaya pasien ${data?.nm_pasien || 'Unknown'} (${data?.no_rawat || ''}) telah melebihi 120% dari tarif CBG`;
      break;
    case 'leave_approved_manajemen':
      title = 'Cuti Disetujui (Manajemen)';
      body = `Pengajuan cuti ${data?.no_pengajuan || ''} telah disetujui oleh manajemen`;
      break;
    case 'leave_rejected_manajemen':
      title = 'Cuti Ditolak (Manajemen)';
      body = `Pengajuan cuti ${data?.no_pengajuan || ''} ditolak oleh manajemen`;
      break;
    default:
      title = eventName;
      body = JSON.stringify(data || {});
  }

  const [result] = await knex('notification_queue').insert({
    nik: targetNik,
    event_type: eventName,
    title,
    body,
    payload: JSON.stringify(data || {}),
    created_at: knex.fn.now(),
  });

  logger.info(`[Notif-Queue] Enqueued ${eventName} for ${targetNik} (id=${result})`);
  return result;
}

/**
 * Poll pending notifications for a given NIK since the device's last_read_id.
 * Soft-deleted rows (deleted_at IS NOT NULL) are excluded.
 */
async function pollNotifications(targetNik, deviceId) {
  const cursorRows = await knex('notification_device_cursor')
    .select('last_read_id')
    .where({ nik: targetNik, device_id: deviceId })
    .limit(1);

  const lastReadId = cursorRows.length > 0 ? cursorRows[0].last_read_id : 0;

  const rows = await knex('notification_queue')
    .select('id', 'event_type', 'title', 'body', 'payload', 'created_at')
    .where('nik', targetNik)
    .andWhere('id', '>', lastReadId)
    .andWhere('deleted_at', null)
    .orderBy('id', 'asc')
    .limit(50);

  return { rows, lastReadId };
}

/**
 * Acknowledge notifications up to lastReadId for a given device.
 */
async function acknowledgeNotifications(targetNik, deviceId, lastReadId) {
  await knex('notification_device_cursor')
    .insert({ nik: targetNik, device_id: deviceId, last_read_id: lastReadId })
    .onConflict(['nik', 'device_id'])
    .merge({
      last_read_id: knex.raw('GREATEST(last_read_id, ?)', [lastReadId]),
    });

  logger.info(`[Notif-Queue] Ack ${targetNik}/${deviceId} → ${lastReadId}`);
}

/**
 * Get the max notification ID for a NIK (used for initial cursor).
 */
async function getLastNotificationId(targetNik) {
  const [row] = await knex('notification_queue')
    .where('nik', targetNik)
    .max('id as max_id');

  return row?.max_id ?? 0;
}

/**
 * Cleanup notifications older than N days (and soft-deleted ones).
 */
async function cleanOldNotifications(days = 7) {
  const result = await knex('notification_queue')
    .where(function () {
      this.where('created_at', '<', knex.raw('NOW() - INTERVAL ? DAY', [days]))
        .orWhere('deleted_at', '<', knex.raw('NOW() - INTERVAL ? DAY', [days]));
    })
    .del();

  if (result > 0) {
    logger.info(`[Notif-Queue] Cleaned ${result} notifications older than ${days} days`);
  }
  return result;
}

module.exports = {
  enqueueNotification,
  pollNotifications,
  acknowledgeNotifications,
  getLastNotificationId,
  cleanOldNotifications,
};
