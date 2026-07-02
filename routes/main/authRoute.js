const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();
const authController = require('../../controllers/main/authController');
const auditTrail = require('../../middleware/auditTrail');
const validateTokenJWT = require('../../middleware/validateTokenJwt');

router.post('/login', auditTrail('Login'), asyncHandler(authController.authentication));
router.post('/logout', validateTokenJWT, auditTrail('Logout'), asyncHandler(authController.logout));
router.post('/change-password', validateTokenJWT, auditTrail('Change Password'), asyncHandler(authController.changePassword));
router.get('/harian-access', validateTokenJWT, asyncHandler(authController.getHarianAccess));
router.put('/harian-access', validateTokenJWT, auditTrail('Update Harian Access'), asyncHandler(authController.updateHarianAccess));

module.exports = router;
