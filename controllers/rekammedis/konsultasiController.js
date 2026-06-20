const knex = require('../../config/knex');
const response = require('../../middleware/responseHandler');
const validateParams = require('../../middleware/validateParams');
const dayjs = require('dayjs');
const { logger } = require('../../middleware/logger');

// ── GET INCOMING CONSULTATIONS ───────────────────────────────────────────────

exports.getIncomingConsultations = async (req, res) => {
  const doctorNik = req.user?.username;

  if (!doctorNik) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  try {
    const consultations = await knex('konsultasi_medik as km')
      .join('dokter as dr_asal', 'km.kd_dokter', 'dr_asal.kd_dokter')
      .join('dokter as dr_tujuan', 'km.kd_dokter_dikonsuli', 'dr_tujuan.kd_dokter')
      .join('reg_periksa as rp', 'km.no_rawat', 'rp.no_rawat')
      .join('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .leftJoin('jawaban_konsultasi_medik as jkm', 'km.no_permintaan', 'jkm.no_permintaan')
      .select(
        'km.no_permintaan',
        'km.no_rawat',
        'km.tanggal as tanggal_konsul',
        'km.jenis_permintaan',
        'km.kd_dokter as kd_dokter_asal',
        'dr_asal.nm_dokter as nm_dokter_asal',
        'km.kd_dokter_dikonsuli',
        'dr_tujuan.nm_dokter as nm_dokter_tujuan',
        'km.diagnosa_kerja as diagnosa_kerja_konsul',
        'km.uraian_konsultasi',
        'rp.no_rkm_medis',
        'p.nm_pasien',
        'p.jk as jenis_kelamin',
        'rp.umurdaftar as umur',
        'rp.sttsumur',
        'jkm.tanggal as tanggal_jawaban',
        'jkm.diagnosa_kerja as diagnosa_kerja_jawaban',
        'jkm.uraian_jawaban'
      )
      .where('km.kd_dokter_dikonsuli', doctorNik)
      .orderBy('km.tanggal', 'desc');

    if (consultations.length === 0) {
      return response.noContent(res);
    }

    return response.ok(res, consultations);
  } catch (error) {
    logger.error('Get Incoming Consultations Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil konsultasi masuk');
  }
};

// ── GET OUTGOING CONSULTATIONS ───────────────────────────────────────────────

exports.getOutgoingConsultations = async (req, res) => {
  const doctorNik = req.user?.username;

  if (!doctorNik) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  try {
    const consultations = await knex('konsultasi_medik as km')
      .join('dokter as dr_asal', 'km.kd_dokter', 'dr_asal.kd_dokter')
      .join('dokter as dr_tujuan', 'km.kd_dokter_dikonsuli', 'dr_tujuan.kd_dokter')
      .join('reg_periksa as rp', 'km.no_rawat', 'rp.no_rawat')
      .join('pasien as p', 'rp.no_rkm_medis', 'p.no_rkm_medis')
      .leftJoin('jawaban_konsultasi_medik as jkm', 'km.no_permintaan', 'jkm.no_permintaan')
      .select(
        'km.no_permintaan',
        'km.no_rawat',
        'km.tanggal as tanggal_konsul',
        'km.jenis_permintaan',
        'km.kd_dokter as kd_dokter_asal',
        'dr_asal.nm_dokter as nm_dokter_asal',
        'km.kd_dokter_dikonsuli',
        'dr_tujuan.nm_dokter as nm_dokter_tujuan',
        'km.diagnosa_kerja as diagnosa_kerja_konsul',
        'km.uraian_konsultasi',
        'rp.no_rkm_medis',
        'p.nm_pasien',
        'p.jk as jenis_kelamin',
        'rp.umurdaftar as umur',
        'rp.sttsumur',
        'jkm.tanggal as tanggal_jawaban',
        'jkm.diagnosa_kerja as diagnosa_kerja_jawaban',
        'jkm.uraian_jawaban'
      )
      .where('km.kd_dokter', doctorNik)
      .orderBy('km.tanggal', 'desc');

    if (consultations.length === 0) {
      return response.noContent(res);
    }

    return response.ok(res, consultations);
  } catch (error) {
    logger.error('Get Outgoing Consultations Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil konsultasi keluar');
  }
};

// ── GET DOCTORS LIST ─────────────────────────────────────────────────────────

exports.getDoctorsList = async (req, res) => {
  try {
    const doctors = await knex('dokter')
      .leftJoin('spesialis', 'dokter.kd_sps', 'spesialis.kd_sps')
      .select('dokter.kd_dokter', 'dokter.nm_dokter', 'spesialis.nm_sps as spesialis')
      .where('dokter.status', '1')
      .orderBy('dokter.nm_dokter', 'asc');

    return response.ok(res, doctors);
  } catch (error) {
    logger.error('Get Doctors List Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil daftar dokter');
  }
};

// ── CREATE CONSULTATION REQUEST ──────────────────────────────────────────────

exports.createConsultationRequest = async (req, res) => {
  const { no_rawat, jenis_permintaan, kd_dokter_dikonsuli, diagnosa_kerja, uraian_konsultasi } = req.body;
  const doctorNik = req.user?.username;

  if (!doctorNik) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  const queryParams = { no_rawat, jenis_permintaan, kd_dokter_dikonsuli };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const today = dayjs().format('YYYY-MM-DD');
    const todayStr = dayjs().format('YYYYMMDD');
    
    // Auto-generate no_permintaan matching: KM + YYYYMMDD + 4 digits sequence
    const maxRecord = await knex('konsultasi_medik')
      .whereRaw('left(tanggal, 10) = ?', [today])
      .select(knex.raw('COALESCE(MAX(CONVERT(RIGHT(no_permintaan, 4), SIGNED)), 0) as max_val'))
      .first();

    const nextSeq = (maxRecord?.max_val || 0) + 1;
    const paddedSeq = String(nextSeq).padStart(4, '0');
    const no_permintaan = `KM${todayStr}${paddedSeq}`;

    const data = {
      no_permintaan,
      no_rawat,
      tanggal: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      jenis_permintaan,
      kd_dokter: doctorNik,
      kd_dokter_dikonsuli,
      diagnosa_kerja: diagnosa_kerja || '',
      uraian_konsultasi: uraian_konsultasi || '',
    };

    await knex('konsultasi_medik').insert(data);

    // Send real-time SSE notification
    try {
      const { sendNotification } = require('../../controllers/main/notificationController');
      const sender = await knex('dokter').where('kd_dokter', doctorNik).select('nm_dokter').first();
      await sendNotification(kd_dokter_dikonsuli, 'consultation_request', {
        no_permintaan: data.no_permintaan,
        no_rawat: data.no_rawat,
        tgl_pesan: data.tanggal,
        kd_dokter_pemberi: doctorNik,
        nm_dokter_pemberi: sender?.nm_dokter || doctorNik,
        diagnosa_kerja: data.diagnosa_kerja,
        uraian_konsultasi: data.uraian_konsultasi,
      });
    } catch (sseErr) {
      logger.error('Failed to send SSE notification:', sseErr);
    }

    return response.created(res, data);
  } catch (error) {
    logger.error('Create Consultation Request Error:', error);
    return response.internalError(req, res, error, 'Gagal membuat permintaan konsultasi');
  }
};

// ── RESPOND TO CONSULTATION REQUEST ──────────────────────────────────────────

exports.respondToConsultation = async (req, res) => {
  const { no_permintaan, diagnosa_kerja, uraian_jawaban } = req.body;
  const doctorNik = req.user?.username;

  if (!doctorNik) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  const queryParams = { no_permintaan, uraian_jawaban };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    // Check if the consultation request exists and matches the logged-in doctor as target
    const consult = await knex('konsultasi_medik')
      .where({ no_permintaan })
      .first();

    if (!consult) {
      return response.failedUpdate(res, 'Permintaan konsultasi tidak ditemukan');
    }

    if (consult.kd_dokter_dikonsuli !== doctorNik) {
      return response.forbidden(res, null, 'Anda tidak memiliki hak untuk menjawab konsultasi ini');
    }

    const todayDateTime = dayjs().format('YYYY-MM-DD HH:mm:ss');
    const responseData = {
      no_permintaan,
      tanggal: todayDateTime,
      diagnosa_kerja: diagnosa_kerja || '',
      uraian_jawaban,
    };

    // Upsert response
    const existingResponse = await knex('jawaban_konsultasi_medik')
      .where({ no_permintaan })
      .first();

    if (existingResponse) {
      await knex('jawaban_konsultasi_medik')
        .where({ no_permintaan })
        .update(responseData);
    } else {
      await knex('jawaban_konsultasi_medik').insert(responseData);
    }

    // Send real-time SSE notification
    try {
      const { sendNotification } = require('../../controllers/main/notificationController');
      const responder = await knex('dokter').where('kd_dokter', doctorNik).select('nm_dokter').first();
      await sendNotification(consult.kd_dokter, 'consultation_response', {
        no_permintaan,
        tgl_jawab: responseData.tanggal,
        kd_dokter_dikonsuli: doctorNik,
        nm_dokter_dikonsuli: responder?.nm_dokter || doctorNik,
        diagnosa_kerja: responseData.diagnosa_kerja,
        uraian_jawaban: responseData.uraian_jawaban,
      });
    } catch (sseErr) {
      logger.error('Failed to send SSE notification response:', sseErr);
    }

    return response.ok(res, responseData);
  } catch (error) {
    logger.error('Respond to Consultation Error:', error);
    return response.internalError(req, res, error, 'Gagal menyimpan jawaban konsultasi');
  }
};
