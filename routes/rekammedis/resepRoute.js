const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const resepController = require('../../controllers/rekammedis/resepController');
const auditTrail = require('../../middleware/auditTrail');

router.get(
  '/obat-list',
  asyncHandler(resepController.getMedicineList)
);
router.post(
  '/',
  auditTrail('Create Prescription'),
  asyncHandler(resepController.createPrescription)
);
router.delete(
  '/:no_resep',
  auditTrail('Delete Prescription'),
  asyncHandler(resepController.deletePrescription)
);

module.exports = router;
