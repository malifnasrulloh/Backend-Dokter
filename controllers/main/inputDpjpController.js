const db = require('../../config/db');
const { logger } = require('../../middleware/logger');

const validateParams = require('../../middleware/validateParams');
const response = require('../../middleware/responseHandler');

exports.getDpjp = async (req, res) => {
  const { no_rawat } = req.query;
  const validateErrors = validateParams(req, res, { no_rawat });
  if (validateErrors) {
    return validateErrors;
  }
  const query =
    'SELECT dpjp_ranap.no_rawat, dpjp_ranap.kd_dokter, dokter.nm_dokter FROM dpjp_ranap inner join dokter on dpjp_ranap.kd_dokter = dokter.kd_dokter WHERE dpjp_ranap.no_rawat = ?';
  const [result] = await db.execute(query, [no_rawat]);
  const mappedResult = result.map((row, index) => ({
    ...row,
    pjranap_ke: (index + 1).toString(),
  }));
  return response.ok(res, mappedResult);
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

  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    await connection.execute('DELETE FROM dpjp_ranap WHERE no_rawat = ?', [no_rawat]);

    const values = kd_dokter.map((kd) => [no_rawat, kd]);

    const query = 'INSERT INTO dpjp_ranap (no_rawat, kd_dokter) VALUES ?';

    await connection.query(query, [values]);

    await connection.commit();
    response.created(res, { message: 'Data DPJP berhasil disinkronkan', count: values.length });
  } catch (error) {
    await connection.rollback();
    logger.error('Transaction Error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return response.badRequest(req, res, 'Terdapat duplikasi dokter pada nomor rawat ini.');
    }

    return response.internalError(req, res, error, 'Gagal menyimpan data ke server');
  } finally {
    connection.release();
  }
};

exports.updateDpjp = async (req, res) => {
  const { no_rawat, kd_dokter } = req.body;

  if (!no_rawat || !Array.isArray(kd_dokter)) {
    return response.badRequest(req, res, 'Payload harus berisi array kd_dokter');
  }

  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    await connection.execute('DELETE FROM dpjp_ranap WHERE no_rawat = ?', [no_rawat]);

    const values = kd_dokter.map((kd) => [no_rawat, kd]);

    const query = 'INSERT INTO dpjp_ranap (no_rawat, kd_dokter) VALUES ?';
    await connection.query(query, [values]);

    await connection.commit();
    response.ok(res, { message: 'Susunan DPJP berhasil diperbarui' });
  } catch (error) {
    await connection.rollback();
    logger.error('Update Error:', error);
    return response.internalError(req, res, error, 'Gagal memperbarui susunan DPJP');
  } finally {
    connection.release();
  }
};

exports.deleteDpjp = async (req, res) => {
  const { no_rawat, kd_dokter } = req.body;

  if (!no_rawat || !kd_dokter) {
    return response.badRequest(req, res, 'no_rawat dan kd_dokter diperlukan');
  }

  const connection = await db.getConnection();
  await connection.beginTransaction();

  try {
    const [check] = await connection.execute(
      'SELECT * FROM dpjp_ranap WHERE no_rawat = ? AND kd_dokter = ?',
      [no_rawat, kd_dokter]
    );

    if (check.length === 0) {
      await connection.rollback();
      return response.noContent(res);
    }

    await connection.execute('DELETE FROM dpjp_ranap WHERE no_rawat = ? AND kd_dokter = ?', [
      no_rawat,
      kd_dokter,
    ]);

    await connection.commit();
    response.ok(res, { message: 'Dokter berhasil dihapus dari DPJP' });
  } catch (error) {
    await connection.rollback();
    logger.error('Delete Error:', error);
    return response.internalError(req, res, error, 'Terjadi kesalahan saat menghapus data');
  } finally {
    connection.release();
  }
};

