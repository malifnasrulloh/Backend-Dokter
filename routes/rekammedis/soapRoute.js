const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const soapController = require('../../controllers/rekammedis/pemeriksaan/soapController');
const auditTrail = require('../../middleware/auditTrail');

router.post(
  '/ralan',
  auditTrail('Create SOAP Ralan'),
  asyncHandler(soapController.createSoapRalan)
);
router.put(
  '/ralan',
  auditTrail('Update SOAP Ralan'),
  asyncHandler(soapController.updateSoapRalan)
);
router.delete(
  '/ralan',
  auditTrail('Delete SOAP Ralan'),
  asyncHandler(soapController.deleteSoapRalan)
);

router.post(
  '/ranap',
  auditTrail('Create SOAP Ranap'),
  asyncHandler(soapController.createSoapRanap)
);
router.put(
  '/ranap',
  auditTrail('Update SOAP Ranap'),
  asyncHandler(soapController.updateSoapRanap)
);
router.delete(
  '/ranap',
  auditTrail('Delete SOAP Ranap'),
  asyncHandler(soapController.deleteSoapRanap)
);

module.exports = router;
