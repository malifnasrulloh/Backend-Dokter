const knex = require('../../../config/knex');
const response = require('../../../middleware/responseHandler');
const validateParams = require('../../../middleware/validateParams');
const dayjs = require('dayjs');
const { logger } = require('../../../middleware/logger');

// ── OUTPATIENT (RALAN) SOAP ──────────────────────────────────────────────────

exports.createSoapRalan = async (req, res) => {
  let {
    no_rawat,
    tgl_perawatan,
    jam_rawat,
    suhu_tubuh,
    tensi,
    nadi,
    respirasi,
    tinggi,
    berat,
    spo2,
    gcs,
    kesadaran,
    keluhan,
    pemeriksaan,
    alergi,
    lingkar_perut,
    rtl,
    penilaian,
    instruksi,
    evaluasi,
    nip,
  } = req.body;

  if (!tgl_perawatan || tgl_perawatan.trim() === '') {
    tgl_perawatan = dayjs().format('YYYY-MM-DD');
  }
  if (!jam_rawat || jam_rawat.trim() === '') {
    jam_rawat = dayjs().format('HH:mm:ss');
  }
  if (!nip || nip.trim() === '') {
    nip = req.user?.username;
  }

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat, nip };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const data = {
      no_rawat,
      tgl_perawatan,
      jam_rawat,
      suhu_tubuh: suhu_tubuh || '-',
      tensi: tensi || '-',
      nadi: nadi || '-',
      respirasi: respirasi || '-',
      tinggi: tinggi || '-',
      berat: berat || '-',
      spo2: spo2 || '-',
      gcs: gcs || '-',
      kesadaran: kesadaran || 'Compos Mentis',
      keluhan: keluhan || '',
      pemeriksaan: pemeriksaan || '',
      alergi: alergi || '-',
      lingkar_perut: lingkar_perut || '-',
      rtl: rtl || '',
      penilaian: penilaian || '',
      instruksi: instruksi || '',
      evaluasi: evaluasi || '',
      nip,
    };

    await knex('pemeriksaan_ralan').insert(data);
    return response.created(res, data);
  } catch (error) {
    logger.error('Create SOAP Ralan Error:', error);
    return response.internalError(req, res, error, 'Gagal menyimpan SOAP Ralan');
  }
};

exports.updateSoapRalan = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const updateData = { ...req.body };
    // Remove primary keys from update payload
    delete updateData.no_rawat;
    delete updateData.tgl_perawatan;
    delete updateData.jam_rawat;

    const affectedRows = await knex('pemeriksaan_ralan')
      .where({ no_rawat, tgl_perawatan, jam_rawat })
      .update(updateData);

    if (affectedRows === 0) {
      return response.failedUpdate(res);
    }

    return response.ok(res, { no_rawat, tgl_perawatan, jam_rawat, ...updateData });
  } catch (error) {
    logger.error('Update SOAP Ralan Error:', error);
    return response.internalError(req, res, error, 'Gagal mengubah SOAP Ralan');
  }
};

exports.deleteSoapRalan = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const affectedRows = await knex('pemeriksaan_ralan')
      .where({ no_rawat, tgl_perawatan, jam_rawat })
      .del();

    if (affectedRows === 0) {
      return response.failedDelete(res);
    }

    return response.ok(res, { no_rawat, tgl_perawatan, jam_rawat });
  } catch (error) {
    logger.error('Delete SOAP Ralan Error:', error);
    return response.internalError(req, res, error, 'Gagal menghapus SOAP Ralan');
  }
};

// ── INPATIENT (RANAP) SOAP ───────────────────────────────────────────────────

exports.createSoapRanap = async (req, res) => {
  let {
    no_rawat,
    tgl_perawatan,
    jam_rawat,
    suhu_tubuh,
    tensi,
    nadi,
    respirasi,
    tinggi,
    berat,
    spo2,
    gcs,
    kesadaran,
    keluhan,
    pemeriksaan,
    alergi,
    rtl,
    penilaian,
    instruksi,
    evaluasi,
    nip,
  } = req.body;

  if (!tgl_perawatan || tgl_perawatan.trim() === '') {
    tgl_perawatan = dayjs().format('YYYY-MM-DD');
  }
  if (!jam_rawat || jam_rawat.trim() === '') {
    jam_rawat = dayjs().format('HH:mm:ss');
  }
  if (!nip || nip.trim() === '') {
    nip = req.user?.username;
  }

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat, nip };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const data = {
      no_rawat,
      tgl_perawatan,
      jam_rawat,
      suhu_tubuh: suhu_tubuh || '-',
      tensi: tensi || '-',
      nadi: nadi || '-',
      respirasi: respirasi || '-',
      tinggi: tinggi || '-',
      berat: berat || '-',
      spo2: spo2 || '-',
      gcs: gcs || '-',
      kesadaran: kesadaran || 'Compos Mentis',
      keluhan: keluhan || '',
      pemeriksaan: pemeriksaan || '',
      alergi: alergi || '-',
      rtl: rtl || '',
      penilaian: penilaian || '',
      instruksi: instruksi || '',
      evaluasi: evaluasi || '',
      nip,
    };

    await knex('pemeriksaan_ranap').insert(data);
    return response.created(res, data);
  } catch (error) {
    logger.error('Create SOAP Ranap Error:', error);
    return response.internalError(req, res, error, 'Gagal menyimpan SOAP Ranap');
  }
};

exports.updateSoapRanap = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const updateData = { ...req.body };
    delete updateData.no_rawat;
    delete updateData.tgl_perawatan;
    delete updateData.jam_rawat;

    const affectedRows = await knex('pemeriksaan_ranap')
      .where({ no_rawat, tgl_perawatan, jam_rawat })
      .update(updateData);

    if (affectedRows === 0) {
      return response.failedUpdate(res);
    }

    return response.ok(res, { no_rawat, tgl_perawatan, jam_rawat, ...updateData });
  } catch (error) {
    logger.error('Update SOAP Ranap Error:', error);
    return response.internalError(req, res, error, 'Gagal mengubah SOAP Ranap');
  }
};

exports.deleteSoapRanap = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat } = req.body;

  const queryParams = { no_rawat, tgl_perawatan, jam_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const affectedRows = await knex('pemeriksaan_ranap')
      .where({ no_rawat, tgl_perawatan, jam_rawat })
      .del();

    if (affectedRows === 0) {
      return response.failedDelete(res);
    }

    return response.ok(res, { no_rawat, tgl_perawatan, jam_rawat });
  } catch (error) {
    logger.error('Delete SOAP Ranap Error:', error);
    return response.internalError(req, res, error, 'Gagal menghapus SOAP Ranap');
  }
};
