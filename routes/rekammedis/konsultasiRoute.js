const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const konsultasiController = require('../../controllers/rekammedis/konsultasiController');
const auditTrail = require('../../middleware/auditTrail');

router.get(
  '/masuk',
  asyncHandler(konsultasiController.getIncomingConsultations)
);
router.get(
  '/keluar',
  asyncHandler(konsultasiController.getOutgoingConsultations)
);
router.get(
  '/dokter-list',
  asyncHandler(konsultasiController.getDoctorsList)
);
router.post(
  '/',
  auditTrail('Create Consultation Request'),
  asyncHandler(konsultasiController.createConsultationRequest)
);
router.post(
  '/jawab',
  auditTrail('Respond to Consultation'),
  asyncHandler(konsultasiController.respondToConsultation)
);

module.exports = router;
