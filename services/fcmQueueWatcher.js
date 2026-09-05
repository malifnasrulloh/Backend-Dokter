const knex = require('../config/knex');
const { sendDataPushToDoctor } = require('./fcmService');
const { logger } = require('../middleware/logger');

let lastDispatchedId = 0;
let isPolling = false;
let watcherTimer = null;

const DISPATCH_INTERVAL_MS = 1000; // 1 second real-time queue watch
const STALE_ALERT_TTL_HOURS = 24;

/**
 * Initializes the last dispatched ID cursor on server startup.
 */
async function initWatcher() {
  try {
    const row = await knex('notification_queue').max('id as maxId').first();
    lastDispatchedId = row?.maxId || 0;
    logger.info(
      `[FCM-Watcher] Started. Seeded cursor at notification_queue ID: ${lastDispatchedId}`
    );
  } catch (err) {
    logger.error(`[FCM-Watcher] Cursor init error: ${err.message}`);
  }
}

/**
 * Scans for newly queued notification records and dispatches High-Priority
 * FCM Data-Only "Tickle" pushes to recipient doctors' devices.
 */
async function pollNewNotifications() {
  if (isPolling) return;
  isPolling = true;

  try {
    const rows = await knex('notification_queue')
      .select('id', 'nik', 'event_type', 'created_at')
      .where('id', '>', lastDispatchedId)
      .whereNull('deleted_at')
      .orderBy('id', 'asc')
      .limit(50);

    if (!rows || rows.length === 0) {
      return;
    }

    const now = Date.now();
    const ttlCutoff = now - STALE_ALERT_TTL_HOURS * 60 * 60 * 1000;

    for (const row of rows) {
      lastDispatchedId = row.id;

      // Routine notification TTL check: if older than 24 hours, advance cursor silently
      const createdAtMs = new Date(row.created_at).getTime();
      const isUrgent = row.event_type === 'emergency_igd_consultation';
      if (!isUrgent && createdAtMs < ttlCutoff) {
        continue;
      }

      // Dispatch high-priority FCM data push (fire-and-forget, non-blocking)
      sendDataPushToDoctor(row.nik, row.event_type, row.id).catch((err) => {
        logger.warn(`[FCM-Watcher] Failed push for notif #${row.id} to ${row.nik}: ${err.message}`);
      });
    }
  } catch (err) {
    logger.error(`[FCM-Watcher] Poll error: ${err.message}`);
  } finally {
    isPolling = false;
  }
}

function start() {
  initWatcher().then(() => {
    watcherTimer = setInterval(pollNewNotifications, DISPATCH_INTERVAL_MS);
  });
}

function stop() {
  if (watcherTimer) {
    clearInterval(watcherTimer);
    watcherTimer = null;
  }
}

module.exports = {
  start,
  stop,
  pollNewNotifications,
};
