const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const profileController = require('../../controllers/main/profileController');

const router = new Hono();

router.get('/', asyncHandler(profileController.getProfile));

module.exports = router;
