const admin = require('firebase-admin');
const { getMessaging } = require('firebase-admin/messaging');
const fs = require('node:fs');
const knex = require('../config/knex');
const { logger } = require('../middleware/logger');

let firebaseApp = null;
let isInitialized = false;

/**
 * Initializes Firebase Admin SDK using hybrid credential lookup:
 * 1. FIREBASE_CREDENTIALS_JSON (raw JSON or base64 JSON string)
 * 2. FIREBASE_CREDENTIALS_PATH (path to service account JSON file)
 * Gracefully degrades if neither is provided (logs warning, disabled state).
 */
function initFirebase() {
  if (isInitialized) return firebaseApp;

  try {
    let serviceAccount = null;

    if (process.env.FIREBASE_CREDENTIALS_JSON) {
      let raw = process.env.FIREBASE_CREDENTIALS_JSON.trim();
      if (!raw.startsWith('{')) {
        try {
          raw = Buffer.from(raw, 'base64').toString('utf8');
        } catch (_err) {
          // not base64, keep raw
        }
      }
      serviceAccount = JSON.parse(raw);
    } else if (process.env.FIREBASE_CREDENTIALS_PATH) {
      const filePath = process.env.FIREBASE_CREDENTIALS_PATH;
      if (fs.existsSync(filePath)) {
        serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    }

    if (serviceAccount?.project_id) {
      firebaseApp = admin.initializeApp({
        credential: admin.cert(serviceAccount),
      });
      isInitialized = true;
      logger.info(
        `[FCM] Firebase Admin SDK initialized successfully (Project: ${serviceAccount.project_id})`
      );
    } else {
      logger.warn(
        '[FCM] No valid Firebase credentials configured (FIREBASE_CREDENTIALS_JSON/PATH). FCM pushes are disabled.'
      );
    }
  } catch (err) {
    logger.error(`[FCM] Initialization error: ${err.message}`);
  }

  return firebaseApp;
}

/**
 * Sends a High-Priority Data-Only "Tickle" push notification to all active devices
 * registered to a doctor (nik).
 *
 * Privacy Guarantees (UU PDP & Permenkes):
 * - ZERO Protected Health Information (PHI) sent to Google servers.
 * - Payload strictly contains: { notification_id, event_type, timestamp }.
 */
async function sendDataPushToDoctor(nik, eventType, notificationId) {
  if (!isInitialized) {
    initFirebase();
    if (!isInitialized) return { sent: 0, skipped: true };
  }

  try {
    const tokens = await knex('user_fcm_tokens').select('device_id', 'fcm_token').where({ nik });

    if (!tokens || tokens.length === 0) {
      return { sent: 0, reason: 'no_tokens' };
    }

    const deadTokens = [];
    let sentCount = 0;

    for (const item of tokens) {
      const { device_id, fcm_token } = item;
      const message = {
        token: fcm_token,
        data: {
          notification_id: String(notificationId),
          event_type: String(eventType),
          timestamp: String(Date.now()),
        },
        android: {
          priority: 'high',
        },
      };

      try {
        await getMessaging().send(message);
        sentCount++;
      } catch (sendErr) {
        const errorCode = sendErr.code || sendErr.errorInfo?.code;
        if (
          errorCode === 'messaging/registration-token-not-registered' ||
          errorCode === 'messaging/invalid-registration-token'
        ) {
          logger.info(`[FCM] Purging stale token for device ${device_id} (nik: ${nik})`);
          deadTokens.push(device_id);
        } else {
          logger.warn(`[FCM] Push failed to ${device_id} (nik: ${nik}): ${sendErr.message}`);
        }
      }
    }

    if (deadTokens.length > 0) {
      await knex('user_fcm_tokens').where({ nik }).whereIn('device_id', deadTokens).del();
    }

    return { sent: sentCount };
  } catch (err) {
    logger.error(`[FCM] Error dispatching push to ${nik}: ${err.message}`);
    return { sent: 0, error: err.message };
  }
}

module.exports = {
  initFirebase,
  sendDataPushToDoctor,
};
