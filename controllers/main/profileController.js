const knex = require('../../config/knex');
const db = require('../../config/db');
const response = require('../../middleware/responseHandler');
const { logger } = require('../../middleware/logger');

exports.getProfile = async (req, res) => {
  const username = req.user?.username;

  if (!username) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  try {
    const employee = await knex('pegawai')
      .leftJoin('departemen', 'pegawai.departemen', 'departemen.dep_id')
      .select(
        'pegawai.nik',
        'pegawai.nama',
        'pegawai.jk',
        'pegawai.jbtn as jabatan',
        'departemen.nama as departemen',
        'pegawai.alamat',
        'pegawai.tmp_lahir',
        'pegawai.tgl_lahir'
      )
      .where('pegawai.nik', username)
      .first();

    if (!employee) {
      // Query userakses for admin if user is admin
      const [columns] = await db.query('SHOW COLUMNS FROM user');
      const allowedAccessColumns = columns
        .map((c) => c.Field)
        .filter((col) => col !== 'id_user' && col !== 'password');
      const selectFields = [
        'TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) AS username',
        ...allowedAccessColumns
      ].join(',\n    ');
      const queryUser = `
        SELECT
          ${selectFields}
        FROM
          user
        WHERE
          TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) = ?
      `;
      const [userRows] = await db.query(queryUser, [
        process.env.DB_AES_KEY_USER,
        username
      ]);
      const userRecord = userRows[0];
      const userakses = userRecord
        ? Object.keys(userRecord).filter((k) => userRecord[k] === 'true').sort()
        : [];

      return response.ok(res, {
        nik: username,
        nama: username === 'sirs' ? 'Admin Sirs' : username,
        jabatan: 'Administrator',
        departemen: 'IT',
        is_dokter: false,
        userakses: userakses
      });
    }

    const doctor = await knex('dokter')
      .leftJoin('spesialis', 'dokter.kd_sps', 'spesialis.kd_sps')
      .select(
        'dokter.kd_dokter',
        'dokter.nm_dokter',
        'dokter.no_ijn_praktek',
        'spesialis.nm_sps as spesialis'
      )
      .where('dokter.kd_dokter', username)
      .first();

    // Query userakses
    const [columns] = await db.query('SHOW COLUMNS FROM user');
    const allowedAccessColumns = columns
      .map((c) => c.Field)
      .filter((col) => col !== 'id_user' && col !== 'password');
    const selectFields = [
      'TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) AS username',
      ...allowedAccessColumns
    ].join(',\n    ');
    const queryUser = `
      SELECT
        ${selectFields}
      FROM
        user
      WHERE
        TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) = ?
    `;
    const [userRows] = await db.query(queryUser, [
      process.env.DB_AES_KEY_USER,
      username
    ]);
    const userRecord = userRows[0];
    const userakses = userRecord
      ? Object.keys(userRecord).filter((k) => userRecord[k] === 'true').sort()
      : [];

    const profile = {
      nik: employee.nik,
      nama: employee.nama,
      jenis_kelamin: employee.jk === 'L' ? 'Laki-laki' : employee.jk === 'P' ? 'Perempuan' : employee.jk,
      jabatan: employee.jabatan,
      departemen: employee.departemen,
      alamat: employee.alamat,
      tempat_lahir: employee.tmp_lahir,
      tanggal_lahir: employee.tgl_lahir,
      is_dokter: !!doctor,
      userakses: userakses,
      dokter_info: doctor ? {
        kd_dokter: doctor.kd_dokter,
        nm_dokter: doctor.nm_dokter,
        no_ijn_praktek: doctor.no_ijn_praktek,
        spesialis: doctor.spesialis
      } : null
    };

    return response.ok(res, profile);
  } catch (error) {
    logger.error('Get Profile Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil data profil');
  }
};
