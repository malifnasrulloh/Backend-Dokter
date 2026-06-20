const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const indexController = require('../../controllers/main/indexController');
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
  return c.json({ code: isHealthy ? 200 : 503, success: isHealthy, data: checks }, isHealthy ? 200 : 503);
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

// ── DPJP RANAP ───────────────────────────────────────────────────────────────
router.use('/dpjp-ranap/*', validateTokenJWT);
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
router.route('/pemeriksaan', require('../rekammedis/pemeriksaanSbarRoute'));

// ── PERKIRAAN BIAYA (BPJS) ────────────────────────────────────────────────────
router.use('/perkiraan-biaya/*', validateTokenJWT);
router.route('/perkiraan-biaya', require('../keuangan/perkiraanBiayaRoute'));

// ── SOAP CRUD ─────────────────────────────────────────────────────────────────
router.use('/soap/*', validateTokenJWT);
router.route('/soap', require('../rekammedis/soapRoute'));

// ── KONSULTASI MEDIK ──────────────────────────────────────────────────────────
router.use('/konsultasi/*', validateTokenJWT);
router.route('/konsultasi', require('../rekammedis/konsultasiRoute'));

// ── RESEP OBAT ────────────────────────────────────────────────────────────────
router.use('/resep/*', validateTokenJWT);
router.route('/resep', require('../rekammedis/resepRoute'));

// ── DIAGNOSA & PROSEDUR ───────────────────────────────────────────────────────
router.use('/diagnosa-prosedur/*', validateTokenJWT);
router.route('/diagnosa-prosedur', require('../rekammedis/diagnosaRoute'));

module.exports = router;
