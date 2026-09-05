const { Hono } = require('hono');
const _asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const _indexController = require('../../controllers/main/indexController');
const validateTokenJWT = require('../../middleware/validateTokenJwt');
const db = require('../../config/db');
const cache = require('../../utils/cache');
const os = require('node:os');

// Health check
router.get('/', (c) =>
  c.json({ code: 200, success: true, message: 'API Dokter SIMRS', data: null })
);

router.get('/health', async (c) => {
  // Health check publik: hanya status ok/fail — tidak expose detail internal
  try {
    await db.query('SELECT 1');
    return c.json({ code: 200, success: true, status: 'ok' }, 200);
  } catch (_err) {
    return c.json({ code: 503, success: false, status: 'unavailable' }, 503);
  }
});

// Readiness probe — untuk Kubernetes / Docker zero-downtime deploy
router.get('/ready', async (c) => {
  try {
    await db.query('SELECT 1');
    return c.json({ code: 200, success: true, status: 'ready' });
  } catch (_err) {
    return c.json({ code: 503, success: false, status: 'not ready' }, 503);
  }
});

// Health check detail — hanya untuk internal (via token)
router.get('/health/detail', validateTokenJWT, async (c) => {
  const startTime = Date.now();
  const checks = {
    server: 'healthy',
    database: 'unknown',
    uptime: `${Math.floor(process.uptime())}s`,
    memory: {},
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  };
  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    checks.database = 'healthy';
    checks.dbResponseTime = `${Date.now() - dbStart}ms`;
  } catch (err) {
    checks.database = 'unhealthy';
    checks.dbError = process.env.NODE_ENV === 'production' ? 'Connection failed' : err.message;
  }
  const memUsage = process.memoryUsage();
  checks.memory = {
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    systemFree: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
  };
  checks.cache = cache.stats();
  checks.responseTime = `${Date.now() - startTime}ms`;
  const isHealthy = checks.database === 'healthy';
  return c.json(
    { code: isHealthy ? 200 : 503, success: isHealthy, data: checks },
    isHealthy ? 200 : 503
  );
});

// ── AUTH ─────────────────────────────────────────────────────────────────────
router.route('/auth', require('./authRoute'));

// ── SETTING ──────────────────────────────────────────────────────────────────
router.use('/setting/*', validateTokenJWT);
router.route('/setting', require('./settingRoute'));

// ── PASIEN LIST (Dashboard) ───────────────────────────────────────────────────
router.use('/list-pasien-ranap/*', validateTokenJWT);
router.route('/list-pasien-ranap', require('./listPasienRanapRoute'));

router.use('/list-pasien-ralan/*', validateTokenJWT);
router.route('/list-pasien-ralan', require('./listPasienRalanRoute'));

router.use('/list-pasien-igd/*', validateTokenJWT);
router.route('/list-pasien-igd', require('./listPasienIGDRoute'));

// ── JADWAL (Operasi & Bed) ────────────────────────────────────────────────────
router.use('/jadwal/*', validateTokenJWT);
router.route('/jadwal', require('./jadwalRoute'));

// ── PASIEN DETAIL (Lightweight — for notification routing) ────────────────────
const asyncHandler = require('../../middleware/asyncHandler');
router.get(
  '/pasien/cari-by-rawat',
  validateTokenJWT,
  asyncHandler(require('../../controllers/main/pasienController').cariByNoRawat)
);

const writeAccessMiddleware = require('../../middleware/writeAccessMiddleware');

// ── DPJP RANAP ───────────────────────────────────────────────────────────────
router.use('/dpjp-ranap/*', validateTokenJWT);
router.use('/dpjp-ranap/*', writeAccessMiddleware());
router.route('/dpjp-ranap', require('./inputDpjpRoute'));

// ── PROFILE ──────────────────────────────────────────────────────────────────
router.use('/profile/*', validateTokenJWT);
router.route('/profile', require('./profileRoute'));

// ── HARIAN DOKTER ────────────────────────────────────────────────────────────
router.use('/harian-dokter/*', validateTokenJWT);
router.route('/harian-dokter', require('./harianDokterRoute'));

// ── RIWAYAT PASIEN (Rekam Medis) ─────────────────────────────────────────────
router.use('/riwayat/pasien/*', validateTokenJWT);
router.route('/riwayat/pasien', require('../rekammedis/riwayatPasienRoute'));

// ── PEMERIKSAAN SBAR ──────────────────────────────────────────────────────────
router.use('/pemeriksaan/*', validateTokenJWT);
router.use('/pemeriksaan/*', writeAccessMiddleware());
router.route('/pemeriksaan', require('../rekammedis/pemeriksaanSbarRoute'));

// ── PERKIRAAN BIAYA (BPJS) ────────────────────────────────────────────────────
router.use('/perkiraan-biaya/*', validateTokenJWT);
router.route('/perkiraan-biaya', require('../keuangan/perkiraanBiayaRoute'));

// ── SOAP CRUD ─────────────────────────────────────────────────────────────────
router.use('/soap/*', validateTokenJWT);
router.use('/soap/*', writeAccessMiddleware());
router.route('/soap', require('../rekammedis/soapRoute'));

// ── NOTIFICATION QUEUE & FCM PUSH ─────────────────────────────────────────────
router.get(
  '/notifications/poll',
  validateTokenJWT,
  require('../../controllers/main/notificationQueueController').pollNotifications
);
router.post(
  '/notifications/ack',
  validateTokenJWT,
  require('../../controllers/main/notificationQueueController').ackNotifications
);
router.post(
  '/notifications/fcm-token',
  validateTokenJWT,
  require('../../controllers/main/notificationQueueController').registerFcmToken
);
router.delete(
  '/notifications/fcm-token',
  validateTokenJWT,
  require('../../controllers/main/notificationQueueController').removeFcmToken
);
// DEPRECATED: SSE — kept for backward compat; remove after migration validated
router.get(
  '/notifications',
  validateTokenJWT,
  require('../../controllers/main/notificationController').sseNotificationConnection
);

// ── KONSULTASI MEDIK ──────────────────────────────────────────────────────────
router.use('/konsultasi/*', validateTokenJWT);
router.route('/konsultasi', require('../rekammedis/konsultasiRoute'));

// ── RESEP OBAT ────────────────────────────────────────────────────────────────
router.use('/resep/*', validateTokenJWT);
router.use('/resep/*', writeAccessMiddleware());
router.route('/resep', require('../rekammedis/resepRoute'));

// ── DIAGNOSA & PROSEDUR ───────────────────────────────────────────────────────
router.use('/diagnosa-prosedur/*', validateTokenJWT);
router.use('/diagnosa-prosedur/*', writeAccessMiddleware());
router.route('/diagnosa-prosedur', require('../rekammedis/diagnosaRoute'));

module.exports = router;
