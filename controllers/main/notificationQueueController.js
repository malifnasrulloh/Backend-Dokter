const knex = require('../../config/knex');
const { logger } = require('../../middleware/logger');

/**
 * GET /notifications/poll
 * Returns all pending notifications for a given device since its last_read_id.
 * Query params: device_id (required)
 */
/**
 * Retention policy (docs/ideas/notification-queue-db-backed.md):
 *  - hard-delete delivered rows older than 7 days,
 *  - hard-delete soft-deleted (source row removed) rows older than 1 day.
 * Runs opportunistically on each poll — cheap on the small queue table.
 */
async function cleanupExpiredNotifications() {
  try {
    await knex('notification_queue')
      .where(function () {
        this.where('created_at', '<', knex.raw('NOW() - INTERVAL 7 DAY')).andWhere(
          'deleted_at',
          null
        );
      })
      .orWhere('deleted_at', '<', knex.raw('NOW() - INTERVAL 1 DAY'))
      .del();
  } catch (err) {
    logger.error('[NotificationQueue] Cleanup error:', err);
  }
}

exports.pollNotifications = async (c) => {
  const nik = c.get('user')?.username;
  if (!nik) {
    c.status(401);
    return c.json({ success: false, message: 'User tidak terautentikasi' });
  }

  const deviceId = c.req.query('device_id');
  if (!deviceId) {
    c.status(400);
    return c.json({ success: false, message: 'Parameter device_id wajib diisi' });
  }

  await cleanupExpiredNotifications();

  try {
    // Get current device cursor (default 0 if no row)
    const cursorRows = await knex('notification_device_cursor')
      .select('last_read_id')
      .where({ nik, device_id: deviceId })
      .limit(1);

    const lastReadId = cursorRows.length > 0 ? cursorRows[0].last_read_id : 0;

    // Fetch pending notifications since cursor (exclude soft-deleted)
    const notifications = await knex('notification_queue')
      .select('id', 'event_type', 'title', 'body', 'payload', 'created_at')
      .where('nik', nik)
      .andWhere('id', '>', lastReadId)
      .andWhere('deleted_at', null)
      .orderBy('id', 'asc')
      .limit(50);

    const lastId =
      notifications.length > 0 ? notifications[notifications.length - 1].id : lastReadId;

    return c.json({
      success: true,
      data: {
        notifications: notifications.map((n) => ({
          id: n.id,
          event_type: n.event_type,
          title: n.title,
          body: n.body,
          payload: typeof n.payload === 'string' ? JSON.parse(n.payload) : n.payload,
          created_at: n.created_at,
        })),
        last_id: lastId,
      },
    });
  } catch (err) {
    logger.error('[NotificationQueue] Poll error:', err);
    c.status(500);
    return c.json({ success: false, message: 'Gagal mengambil notifikasi' });
  }
};

/**
 * POST /notifications/ack
 * Updates the per-device cursor to the given last_id.
 * Body: { device_id, last_id }
 */
exports.ackNotifications = async (c) => {
  const nik = c.get('user')?.username;
  if (!nik) {
    c.status(401);
    return c.json({ success: false, message: 'User tidak terautentikasi' });
  }

  const body = c.get('body') || {};
  const { device_id, last_id } = body;

  if (!device_id || !last_id) {
    c.status(400);
    return c.json({ success: false, message: 'Parameter device_id dan last_id wajib diisi' });
  }

  try {
    await knex('notification_device_cursor')
      .insert({ nik, device_id, last_read_id: last_id })
      .onConflict(['nik', 'device_id'])
      .merge({
        last_read_id: knex.raw('GREATEST(last_read_id, ?)', [last_id]),
      });

    return c.json({ success: true });
  } catch (err) {
    logger.error('[NotificationQueue] Ack error:', err);
    c.status(500);
    return c.json({ success: false, message: 'Gagal mengirim ack' });
  }
};
