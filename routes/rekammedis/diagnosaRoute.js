const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const diagnosaController = require('../../controllers/rekammedis/diagnosaController');
const auditTrail = require('../../middleware/auditTrail');

router.get(
  '/penyakit',
  asyncHandler(diagnosaController.getDiseases)
);
router.get(
  '/icd9',
  asyncHandler(diagnosaController.getProcedures)
);
router.post(
  '/diagnosa',
  auditTrail('Create Patient Diagnosis'),
  asyncHandler(diagnosaController.createDiagnosis)
);
router.delete(
  '/diagnosa',
  auditTrail('Delete Patient Diagnosis'),
  asyncHandler(diagnosaController.deleteDiagnosis)
);
router.post(
  '/prosedur',
  auditTrail('Create Patient Procedure'),
  asyncHandler(diagnosaController.createProcedure)
);
router.delete(
  '/prosedur',
  auditTrail('Delete Patient Procedure'),
  asyncHandler(diagnosaController.deleteProcedure)
);

module.exports = router;
