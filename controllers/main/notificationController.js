const { streamSSE } = require('hono/streaming');
const { logger } = require('../../middleware/logger');

// Map NIK to a Set of active SSE streams (to support multiple active logins/devices per doctor)
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
    activeDoctorStreams.get(doctorNik).add(stream);

    logger.info(`[SSE] Doctor ${doctorNik} connected to real-time notification stream`);

    stream.onAbort(() => {
      logger.info(`[SSE] Doctor ${doctorNik} disconnected from real-time notification stream`);
      const streams = activeDoctorStreams.get(doctorNik);
      if (streams) {
        streams.delete(stream);
        if (streams.size === 0) {
          activeDoctorStreams.delete(doctorNik);
        }
      }
    });

    // Send initial handshake message
    await stream.writeSSE({
      event: 'handshake',
      data: JSON.stringify({ status: 'connected', timestamp: new Date().toISOString() })
    });

    // Keep connection alive with periodic pings every 30 seconds
    while (true) {
      await stream.sleep(30000);
      try {
        await stream.writeSSE({
          event: 'ping',
          data: 'keep-alive'
        });
      } catch (err) {
        break; // Stream was closed
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
  const streams = activeDoctorStreams.get(targetNik);
  if (!streams || streams.size === 0) {
    logger.info(`[SSE] Notification to ${targetNik} skipped (no active stream found)`);
    return false;
  }

  logger.info(`[SSE] Broadcasting notification to ${targetNik} (event: ${eventName})`);
  const payload = JSON.stringify(data);
  const sendPromises = [];

  for (const stream of streams) {
    sendPromises.push(
      stream.writeSSE({
        event: eventName,
        data: payload
      }).catch((err) => {
        logger.error(`[SSE] Failed writing notification stream payload for ${targetNik}:`, err);
      })
    );
  }

  await Promise.all(sendPromises);
  return true;
};
