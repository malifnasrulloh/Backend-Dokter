require('dotenv').config();

// Fail-fast at boot (not at module load): the API must never run without
// a JWT secret. Tests that only require route modules stay env-free.
if (!process.env.SECRETTOKEN) {
  console.error(
    '[FATAL] SECRETTOKEN tidak di-set di .env! Server tidak boleh berjalan tanpa secret key.'
  );
  process.exit(1);
}

const { Hono } = require('hono');
const honoLoader = require('./loaders/hono');
const db = require('./config/db');
const { runMigrations } = require('./config/dbMigrate');
const cache = require('./utils/cache');
const { logger } = require('./middleware/logger');

async function startServer() {
  await runMigrations();

  const app = new Hono();
  const PORT = process.env.PORT || 4002;

  honoLoader(app);

  // Start background database monitor (disabled by default — triggers handle detection)
  if (process.env.DB_MONITOR_ENABLED === 'true') {
    const dbMonitor = require('./services/dbMonitorService');
    dbMonitor.start();
    logger.info('[DB-Monitor] Enabled via DB_MONITOR_ENABLED=true');
  }

  // Start INA-CBG billing threshold monitor
  const inacbgMonitor = require('./services/inacbgMonitorService');
  inacbgMonitor.start();

  // Start real-time FCM queue watcher daemon (1s interval)
  const fcmQueueWatcher = require('./services/fcmQueueWatcher');
  fcmQueueWatcher.start();

  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}\n${error.stack}`);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled Rejection: ${msg}`);
  });

  if (typeof Bun !== 'undefined' && Bun.gc) {
    setInterval(
      () => {
        Bun.gc(true);
      },
      15 * 60 * 1000
    );
  }

  let server;
  if (typeof Bun !== 'undefined' && Bun.serve) {
    server = Bun.serve({
      fetch: app.fetch,
      port: PORT,
    });
  } else {
    // Node fallback: @hono/node-server wraps the Fetch API request
    // correctly (raw http.createServer would pass IncomingMessage).
    const { serve } = require('@hono/node-server');
    server = serve({ fetch: app.fetch, port: PORT });
  }

  logger.info(
    `[Dokter] Server berjalan di http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`
  );
  console.log(`[Dokter] Server berjalan di http://localhost:${PORT}`);

  if (typeof process.send === 'function') {
    process.send('ready');
  }

  let isShuttingDown = false;
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`${signal} diterima. Graceful shutdown...`);
    try {
      if (server && typeof server.stop === 'function') server.stop();
      if (server && typeof server.close === 'function') {
        await new Promise((resolve) => server.close(resolve));
      }
      cache.destroy();
      if (typeof db.drainLogs === 'function') await db.drainLogs();
      await db.end();
      logger.info('[Shutdown] Server berhenti.');
    } catch (err) {
      logger.error(`[Shutdown] Error: ${err.message}`);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('message', (msg) => {
    if (msg === 'shutdown') gracefulShutdown('PM2_SHUTDOWN');
  });
}

startServer().catch((err) => {
  console.error('Startup error:', err);
  process.exit(1);
});
