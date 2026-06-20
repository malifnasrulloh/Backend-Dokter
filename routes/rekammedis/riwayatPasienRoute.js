const { Hono } = require('hono');
const asyncHandler = require('../../middleware/asyncHandler');
const router = new Hono();

// Controllers yang dipakai Flutter dokter
const riwayatMedisRanapController = require('../../controllers/rekammedis/riwayat/riwayatMedisRanapController');
const riwayatMedisIgdController = require('../../controllers/rekammedis/riwayat/riwayatMedisIgdController');
const riwayatKebidananIgdController = require('../../controllers/rekammedis/riwayat/riwayatKebidananIgdController');
const riwayatSoapRalanController = require('../../controllers/rekammedis/riwayat/riwayatSoapRalanController');
const riwayatSoapRanapController = require('../../controllers/rekammedis/riwayat/riwayatSoapRanapController');
const riwayatDiagnosaProsedurController = require('../../controllers/rekammedis/riwayat/riwayatDiagnosaProsedurController');
const riwayatObatController = require('../../controllers/rekammedis/riwayat/riwayatObatController');
const riwayatLaboratoriumController = require('../../controllers/rekammedis/riwayat/riwayatLaboratoriumController');
const riwayatRadiologiController = require('../../controllers/rekammedis/riwayat/riwayatRadiologiController');
const riwayatBillingController = require('../../controllers/rekammedis/riwayat/riwayatBillingController');

// Riwayat medis - RANAP
router.get('/medis-ranap', asyncHandler(riwayatMedisRanapController.getRiwayatMedisRanap));
router.get('/medis-ranap-neonatus', asyncHandler(riwayatMedisRanapController.getRiwayatMedisRanapNeonatus));
router.get('/medis-ranap-kebidanan', asyncHandler(riwayatMedisRanapController.getRiwayatMedisRanapKebidanan));

// Riwayat medis - IGD
router.get('/medis-igd', asyncHandler(riwayatMedisIgdController.getRiwayatMedisIgd));
router.get('/igd-kebidanan', asyncHandler(riwayatKebidananIgdController.getKebidananIgd));

// SOAP
router.get('/soap-ralan', asyncHandler(riwayatSoapRalanController.getRiwayatSoapRalan));
router.get('/soap-ranap', asyncHandler(riwayatSoapRanapController.getRiwayatSoapRanap));

// Diagnosa & Prosedur
router.get('/diagnosa', asyncHandler(riwayatDiagnosaProsedurController.getDiagnosa));
router.get('/prosedur', asyncHandler(riwayatDiagnosaProsedurController.getProsedur));

// Obat
router.get('/pemberian-obat', asyncHandler(riwayatObatController.getPemberianObat));

// Laboratorium
router.get('/laboratorium', asyncHandler(riwayatLaboratoriumController.getLaboratorium));

// Radiologi
router.get('/radiologi', asyncHandler(riwayatRadiologiController.getRadiologi));

// Billing
router.get('/total-tagihan', asyncHandler(riwayatBillingController.getTotalBiaya));

module.exports = router;
