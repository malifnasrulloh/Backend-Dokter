const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const harianDokterController = require('../../controllers/main/harianDokterController');

const router = new Hono();

router.get('/', asyncHandler(harianDokterController.getHarianDokter));
router.get('/summary', asyncHandler(harianDokterController.getHarianDokterSummary));
router.get('/cara-bayar', asyncHandler(harianDokterController.getCaraBayar));

module.exports = router;
