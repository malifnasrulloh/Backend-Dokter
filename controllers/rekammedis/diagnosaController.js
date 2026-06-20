const knex = require('../../config/knex');
const response = require('../../middleware/responseHandler');
const validateParams = require('../../middleware/validateParams');
const { logger } = require('../../middleware/logger');

// ── GET DISEASES (ICD-10 CATALOG) ────────────────────────────────────────────

exports.getDiseases = async (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;

  const pageNum = Number.parseInt(page, 10) || 1;
  const limitNum = Number.parseInt(limit, 10) || 20;
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = knex('penyakit').select('kd_penyakit', 'nm_penyakit', 'ciri_ciri', 'keterangan');

    if (keyword && keyword.trim() !== '') {
      const searchPattern = `%${keyword.trim()}%`;
      query = query.where((builder) => {
        builder.where('kd_penyakit', 'like', searchPattern)
               .orWhere('nm_penyakit', 'like', searchPattern);
      });
    }

    // Run total count query
    const totalQuery = knex('penyakit').count('kd_penyakit as total');
    if (keyword && keyword.trim() !== '') {
      const searchPattern = `%${keyword.trim()}%`;
      totalQuery.where((builder) => {
        builder.where('kd_penyakit', 'like', searchPattern)
                  .orWhere('nm_penyakit', 'like', searchPattern);
      });
    }

    const [totalRecord, list] = await Promise.all([
      totalQuery.first(),
      query.orderBy('nm_penyakit', 'asc').limit(limitNum).offset(offset)
    ]);

    const totalCount = totalRecord?.total || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    return response.ok(res, {
      list,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        total_pages: totalPages
      }
    });
  } catch (error) {
    logger.error('Get Diseases Catalog Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil katalog penyakit');
  }
};

// ── GET PROCEDURES (ICD-9 CATALOG) ───────────────────────────────────────────

exports.getProcedures = async (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;

  const pageNum = Number.parseInt(page, 10) || 1;
  const limitNum = Number.parseInt(limit, 10) || 20;
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = knex('icd9').select('kode', 'deskripsi_panjang', 'deskripsi_pendek');

    if (keyword && keyword.trim() !== '') {
      const searchPattern = `%${keyword.trim()}%`;
      query = query.where((builder) => {
        builder.where('kode', 'like', searchPattern)
               .orWhere('deskripsi_panjang', 'like', searchPattern)
               .orWhere('deskripsi_pendek', 'like', searchPattern);
      });
    }

    // Run total count query
    const totalQuery = knex('icd9').count('kode as total');
    if (keyword && keyword.trim() !== '') {
      const searchPattern = `%${keyword.trim()}%`;
      totalQuery.where((builder) => {
        builder.where('kode', 'like', searchPattern)
                  .orWhere('deskripsi_panjang', 'like', searchPattern)
                  .orWhere('deskripsi_pendek', 'like', searchPattern);
      });
    }

    const [totalRecord, list] = await Promise.all([
      totalQuery.first(),
      query.orderBy('deskripsi_panjang', 'asc').limit(limitNum).offset(offset)
    ]);

    const totalCount = totalRecord?.total || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    return response.ok(res, {
      list,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        total_pages: totalPages
      }
    });
  } catch (error) {
    logger.error('Get Procedures Catalog Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil katalog prosedur');
  }
};

// ── CREATE PATIENT DIAGNOSIS ─────────────────────────────────────────────────

exports.createDiagnosis = async (req, res) => {
  const { no_rawat, kd_penyakit, status, prioritas, status_penyakit } = req.body;

  const queryParams = { no_rawat, kd_penyakit, status, prioritas };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    // Normalise status case to match DB constraints
    const statusVal = status.toLowerCase() === 'ralan' ? 'Ralan' : 'Ranap';
    const statusPenyakitVal = status_penyakit && status_penyakit.toLowerCase() === 'lama' ? 'Lama' : 'Baru';

    const data = {
      no_rawat,
      kd_penyakit,
      status: statusVal,
      prioritas: Number.parseInt(prioritas, 10) || 1,
      status_penyakit: statusPenyakitVal
    };

    // Prevent duplicate entries
    const existing = await knex('diagnosa_pasien')
      .where({ no_rawat, kd_penyakit, status: statusVal })
      .first();

    if (existing) {
      await knex('diagnosa_pasien')
        .where({ no_rawat, kd_penyakit, status: statusVal })
        .update(data);
    } else {
      await knex('diagnosa_pasien').insert(data);
    }

    return response.created(res, data);
  } catch (error) {
    logger.error('Create Patient Diagnosis Error:', error);
    return response.internalError(req, res, error, 'Gagal menyimpan diagnosa pasien');
  }
};

// ── DELETE PATIENT DIAGNOSIS ─────────────────────────────────────────────────

exports.deleteDiagnosis = async (req, res) => {
  const { no_rawat, kd_penyakit, status } = req.body;

  const queryParams = { no_rawat, kd_penyakit, status };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const statusVal = status.toLowerCase() === 'ralan' ? 'Ralan' : 'Ranap';

    const affectedRows = await knex('diagnosa_pasien')
      .where({ no_rawat, kd_penyakit, status: statusVal })
      .del();

    if (affectedRows === 0) {
      return response.failedDelete(res);
    }

    return response.ok(res, { no_rawat, kd_penyakit, status: statusVal });
  } catch (error) {
    logger.error('Delete Patient Diagnosis Error:', error);
    return response.internalError(req, res, error, 'Gagal menghapus diagnosa pasien');
  }
};

// ── CREATE PATIENT PROCEDURE ─────────────────────────────────────────────────

exports.createProcedure = async (req, res) => {
  const { no_rawat, kode, status, prioritas, jumlah } = req.body;

  const queryParams = { no_rawat, kode, status, prioritas };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const statusVal = status.toLowerCase() === 'ralan' ? 'Ralan' : 'Ranap';

    const data = {
      no_rawat,
      kode,
      status: statusVal,
      prioritas: Number.parseInt(prioritas, 10) || 1,
      jumlah: String(jumlah || '1')
    };

    // Prevent duplicate entries
    const existing = await knex('prosedur_pasien')
      .where({ no_rawat, kode, status: statusVal })
      .first();

    if (existing) {
      await knex('prosedur_pasien')
        .where({ no_rawat, kode, status: statusVal })
        .update(data);
    } else {
      await knex('prosedur_pasien').insert(data);
    }

    return response.created(res, data);
  } catch (error) {
    logger.error('Create Patient Procedure Error:', error);
    return response.internalError(req, res, error, 'Gagal menyimpan prosedur pasien');
  }
};

// ── DELETE PATIENT PROCEDURE ─────────────────────────────────────────────────

exports.deleteProcedure = async (req, res) => {
  const { no_rawat, kode, status } = req.body;

  const queryParams = { no_rawat, kode, status };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  try {
    const statusVal = status.toLowerCase() === 'ralan' ? 'Ralan' : 'Ranap';

    const affectedRows = await knex('prosedur_pasien')
      .where({ no_rawat, kode, status: statusVal })
      .del();

    if (affectedRows === 0) {
      return response.failedDelete(res);
    }

    return response.ok(res, { no_rawat, kode, status: statusVal });
  } catch (error) {
    logger.error('Delete Patient Procedure Error:', error);
    return response.internalError(req, res, error, 'Gagal menghapus prosedur pasien');
  }
};
