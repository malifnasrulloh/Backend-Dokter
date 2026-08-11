const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const pemeriksaanSbarController = require('../../controllers/rekammedis/pemeriksaan/pemeriksaanSbarController');
const auditTrail = require('../../middleware/auditTrail');

router.get('/', asyncHandler(pemeriksaanSbarController.getPemeriksaanById));
router.get('/dokter', asyncHandler(pemeriksaanSbarController.getPemeriksaanByDokter));
router.post(
  '/',
  auditTrail('Pemeriksaan SBAR'),
  asyncHandler(pemeriksaanSbarController.createPemeriksaan)
);
router.put(
  '/',
  auditTrail('Pemeriksaan SBAR'),
  asyncHandler(pemeriksaanSbarController.updatePemeriksaan)
);
router.delete(
  '/',
  auditTrail('Pemeriksaan SBAR'),
  asyncHandler(pemeriksaanSbarController.deletePemeriksaan)
);
router.post(
  '/validasi',
  auditTrail('Pemeriksaan SBAR'),
  asyncHandler(pemeriksaanSbarController.validasiPemeriksaan)
);

module.exports = router;
