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
      body = `Laporan dari ${data?.nama_petugas || 'Perawat'}: "${data?.situation || ''}"`;
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
 * Cleanup notifications older than N days.
 */
async function cleanOldNotifications(days = 7) {
  const result = await knex('notification_queue')
    .where('created_at', '<', knex.raw('NOW() - INTERVAL ? DAY', [days]))
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
