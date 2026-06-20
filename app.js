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

  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}\n${error.stack}`);
  });

  process.on('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled Rejection: ${msg}`);
  });

  if (typeof Bun !== 'undefined' && Bun.gc) {
    setInterval(() => {
      Bun.gc(true);
    }, 15 * 60 * 1000);
  }

  const server = Bun.serve({
    fetch: app.fetch,
    port: PORT,
  });

  logger.info(`[Dokter] Server berjalan di http://localhost:${PORT} [${process.env.NODE_ENV || 'development'}]`);
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
      server.stop();
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
