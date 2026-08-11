const { streamSSE } = require('hono/streaming');
const { logger } = require('../../middleware/logger');
const { enqueueNotification } = require('../../services/notificationQueueService');

// Map NIK to a Set of active SSE streams
const activeDoctorStreams = new Map();

exports.sseNotificationConnection = async (c) => {
  const doctorNik = c.get('user')?.username;
  if (!doctorNik) {
    c.status(401);
    return c.text('User tidak terautentikasi');
  }

  return streamSSE(c, async (stream) => {
    if (!activeDoctorStreams.has(doctorNik)) {
      activeDoctorStreams.set(doctorNik, new Set());
    }
    const streams = activeDoctorStreams.get(doctorNik);
    streams.add(stream);

    logger.info(`[SSE] Doctor ${doctorNik} connected. Total active streams: ${streams.size}`);

    // FIX 2: Use a flag to break the keep-alive loop immediately on disconnect
    let isAborted = false;

    stream.onAbort(() => {
      isAborted = true;
      logger.info(`[SSE] Doctor ${doctorNik} disconnected.`);
      streams.delete(stream);
      if (streams.size === 0) {
        activeDoctorStreams.delete(doctorNik);
      }
    });

    // Send initial handshake message
    await stream.writeSSE({
      event: 'handshake',
      data: JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() }),
    });

    // Keep connection alive with periodic pings every 30 seconds
    while (!isAborted) {
      await stream.sleep(30000);
      if (isAborted) break; // Check flag immediately after waking up

      try {
        await stream.writeSSE({
          event: 'ping',
          data: 'keep-alive',
        });
      } catch (_err) {
        // Stream was closed unexpectedly during write
        break;
      }
    }
  });
};

/**
 * Dispatches a real-time message payload to all active streams of a target doctor
 * @param {string} targetNik - The NIK/username of the doctor
 * @param {string} eventName - The event name tag
 * @param {object} data - The message payload object
 */
exports.sendNotification = async (targetNik, eventName, data) => {
  // Always persist to database queue (for Flutter polling)
  try {
    await enqueueNotification(targetNik, eventName, data);
  } catch (err) {
    logger.error(`[Notif-Queue] Failed to enqueue for ${targetNik}:`, err);
  }

  // Also try SSE broadcast for any connected live stream (backward compat)
  const streams = activeDoctorStreams.get(targetNik);
  if (!streams || streams.size === 0) {
    logger.info(`[SSE] Notification to ${targetNik} skipped (no active stream found)`);
    return false;
  }

  logger.info(`[SSE] Broadcasting to ${targetNik} (event: ${eventName}, streams: ${streams.size})`);
  const payload = JSON.stringify(data);
  const sendPromises = [];

  for (const stream of streams) {
    sendPromises.push(
      stream
        .writeSSE({
          event: eventName,
          data: payload,
        })
        .catch((err) => {
          logger.error(`[SSE] Failed writing to stream for ${targetNik}:`, err);

          // FIX 1: Clean up "zombie" streams that failed to write (silent disconnects)
          streams.delete(stream);
          if (streams.size === 0) {
            activeDoctorStreams.delete(targetNik);
          }
        })
    );
  }

  await Promise.all(sendPromises);
  return true;
};
