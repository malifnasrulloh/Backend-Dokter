const knex = require('../../config/knex');
const { logger } = require('../../middleware/logger');

const validateParams = require('../../middleware/validateParams');
const response = require('../../middleware/responseHandler');

exports.getDpjp = async (req, res) => {
  const { no_rawat } = req.query;
  const validateErrors = validateParams(req, res, { no_rawat });
  if (validateErrors) {
    return validateErrors;
  }

  try {
    const result = await knex('dpjp_ranap')
      .select('dpjp_ranap.no_rawat', 'dpjp_ranap.kd_dokter', 'dokter.nm_dokter')
      .innerJoin('dokter', 'dpjp_ranap.kd_dokter', 'dokter.kd_dokter')
      .where('dpjp_ranap.no_rawat', no_rawat);

    const mappedResult = result.map((row, index) => ({
      ...row,
      pjranap_ke: (index + 1).toString(),
    }));
    return response.ok(res, mappedResult);
  } catch (error) {
    logger.error('Get DPJP Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil data DPJP');
  }
};

exports.inputDpjp = async (req, res) => {
  const { no_rawat, kd_dokter } = req.body;

  if (!no_rawat || !Array.isArray(kd_dokter)) {
    return response.badRequest(
      req,
      res,
      'Format data tidak valid. kd_dokter harus berupa array.'
    );
  }

  try {
    await knex.transaction(async (trx) => {
      // 1. Hapus yang lama
      await trx('dpjp_ranap').where('no_rawat', no_rawat).del();

      // 2. Masukkan yang baru
      if (kd_dokter.length > 0) {
        const insertData = kd_dokter.map((kd) => ({
          no_rawat,
          kd_dokter: kd,
        }));
        await trx('dpjp_ranap').insert(insertData);
      }
    });

    response.created(res, { message: 'Data DPJP berhasil disinkronkan', count: kd_dokter.length });
  } catch (error) {
    logger.error('Transaction Error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return response.badRequest(req, res, 'Terdapat duplikasi dokter pada nomor rawat ini.');
    }

    return response.internalError(req, res, error, 'Gagal menyimpan data ke server');
  }
};

exports.updateDpjp = async (req, res) => {
  const { no_rawat, kd_dokter } = req.body;

  if (!no_rawat || !Array.isArray(kd_dokter)) {
    return response.badRequest(req, res, 'Payload harus berisi array kd_dokter');
  }

  try {
    await knex.transaction(async (trx) => {
      await trx('dpjp_ranap').where('no_rawat', no_rawat).del();

      if (kd_dokter.length > 0) {
        const insertData = kd_dokter.map((kd) => ({
          no_rawat,
          kd_dokter: kd,
        }));
        await trx('dpjp_ranap').insert(insertData);
      }
    });

    response.ok(res, { message: 'Susunan DPJP berhasil diperbarui' });
  } catch (error) {
    logger.error('Update Error:', error);
    return response.internalError(req, res, error, 'Gagal memperbarui susunan DPJP');
  }
};

exports.deleteDpjp = async (req, res) => {
  const { no_rawat, kd_dokter } = req.body;

  if (!no_rawat || !kd_dokter) {
    return response.badRequest(req, res, 'no_rawat dan kd_dokter diperlukan');
  }

  try {
    let deletedCount = 0;
    await knex.transaction(async (trx) => {
      const check = await trx('dpjp_ranap')
        .where({ no_rawat, kd_dokter })
        .first();

      if (check) {
        deletedCount = await trx('dpjp_ranap')
          .where({ no_rawat, kd_dokter })
          .del();
      }
    });

    if (deletedCount === 0) {
      return response.noContent(res);
    }

    response.ok(res, { message: 'Dokter berhasil dihapus dari DPJP' });
  } catch (error) {
    logger.error('Delete Error:', error);
    return response.internalError(req, res, error, 'Terjadi kesalahan saat menghapus data');
  }
};
