const knex = require('../../config/knex');
const db = require('../../config/db');
const response = require('../../middleware/responseHandler');
const { logger } = require('../../middleware/logger');

// Cache for user table columns to avoid querying the DB on every request
let cachedUserColumns = null;

/**
 * Helper function to fetch user access rights (DRY principle)
 */
async function getUserAccess(username) {
  // 1. Fetch and cache columns (Performance fix)
  if (!cachedUserColumns) {
    const [columns] = await db.query('SHOW COLUMNS FROM user');
    cachedUserColumns = columns
      .map((c) => c.Field)
      .filter((col) => col !== 'id_user' && col !== 'password');
  }

  // 2. Escape column names with backticks (Security/Syntax fix)
  const escapedColumns = cachedUserColumns.map((col) => `\`${col}\``);

  const selectFields = [
    'TRIM(CAST(AES_DECRYPT(`id_user`, ?) AS CHAR)) AS `username`',
    ...escapedColumns,
  ].join(',\n    ');

  const queryUser = `
    SELECT ${selectFields}
    FROM user
    WHERE TRIM(CAST(AES_DECRYPT(\`id_user\`, ?) AS CHAR)) = ?
  `;

  // 3. FIX: Pass 3 parameters instead of 2 (Critical Bug fix)
  const [userRows] = await db.query(queryUser, [
    process.env.DB_AES_KEY_USER, // For SELECT decrypt
    process.env.DB_AES_KEY_USER, // For WHERE decrypt
    username, // For WHERE comparison
  ]);

  const userRecord = userRows[0];
  if (!userRecord) return [];

  // 4. Robust truthy check for access columns (Robustness fix)
  return Object.keys(userRecord)
    .filter((k) => {
      const val = userRecord[k];
      return val === 'true' || val === true || val === 1 || val === '1';
    })
    .sort();
}

exports.getProfile = async (req, res) => {
  const username = req.user?.username;

  if (!username) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  try {
    // 1. Fetch Employee Data
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

    // Fetch access rights once for both flows
    const userakses = await getUserAccess(username);

    // 2. Fallback for Admin/Non-Employee
    if (!employee) {
      return response.ok(res, {
        nik: username,
        nama: username,
        jabatan: 'Administrator',
        departemen: 'IT',
        is_dokter: false,
        userakses: userakses,
      });
    }

    // 3. Fetch Doctor Data (if applicable)
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

    // 4. Construct Final Profile
    const profile = {
      nik: employee.nik,
      nama: employee.nama,
      jenis_kelamin:
        employee.jk === 'L' ? 'Laki-laki' : employee.jk === 'P' ? 'Perempuan' : employee.jk,
      jabatan: employee.jabatan,
      departemen: employee.departemen,
      alamat: employee.alamat,
      tempat_lahir: employee.tmp_lahir,
      tanggal_lahir: employee.tgl_lahir,
      is_dokter: !!doctor,
      userakses: userakses,
      dokter_info: doctor
        ? {
            kd_dokter: doctor.kd_dokter,
            nm_dokter: doctor.nm_dokter,
            no_ijn_praktek: doctor.no_ijn_praktek,
            spesialis: doctor.spesialis,
          }
        : null,
    };

    return response.ok(res, profile);
  } catch (error) {
    logger.error('Get Profile Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil data profil');
  }
};
