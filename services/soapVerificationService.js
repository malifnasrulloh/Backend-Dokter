const db = require('../config/db');
const { resolveDoctorKdSet } = require('../utils/doctorIdentity');

/**
 * Memeriksa apakah user login terdaftar sebagai administrator di tabel admin
 */
async function isAdminUser(username) {
  if (!username) return false;
  const lower = username.toLowerCase();
  if (lower === 'admin' || lower === 'admin utama') return true;

  try {
    const [adminCheck] = await db.query(
      `SELECT 1 FROM admin WHERE TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ? LIMIT 1`,
      [process.env.DB_AES_KEY_USER, username]
    );
    return adminCheck.length > 0;
  } catch (_e) {
    return false;
  }
}

/**
 * Memeriksa apakah user login berstatus DPJP untuk pasien (Ralan / Ranap)
 */
async function isDoctorDPJP(noRawat, username, jenis = 'ranap', isSuperAdmin = false) {
  if (isSuperAdmin || (await isAdminUser(username))) return true;
  if (!username) return false;

  const doctorCodes = await resolveDoctorKdSet(username);
  if (doctorCodes.length === 0) return false;

  const placeholders = doctorCodes.map(() => '?').join(', ');

  if (jenis === 'ranap') {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS total FROM dpjp_ranap WHERE no_rawat = ? AND kd_dokter IN (${placeholders})`,
      [noRawat, ...doctorCodes]
    );
    return rows[0].total > 0;
  } else {
    const [rows] = await db.query(
      `SELECT COUNT(*) AS total FROM reg_periksa WHERE no_rawat = ? AND kd_dokter IN (${placeholders})`,
      [noRawat, ...doctorCodes]
    );
    return rows[0].total > 0;
  }
}

/**
 * Menghitung batas waktu verifikasi (smart deadline: 24 jam atau jadwal dokter berikutnya)
 */
async function checkVerificationDeadline(noRawat, tglPerawatan, jamRawat, jenis = 'ranap') {
  const tglJamStr = `${tglPerawatan} ${jamRawat}`;
  const now = new Date();

  // Query deadline konsisten dengan SIMRS Khanza desktop
  const query = `
    SELECT
      IF(NOW() > COALESCE(
          (SELECT MIN(TIMESTAMP(DATE_ADD(?, INTERVAL 1 DAY), j.jam_mulai))
           FROM ${jenis === 'ranap' ? 'dpjp_ranap dr' : 'reg_periksa dr'}
           INNER JOIN jadwal j ON j.kd_dokter = dr.kd_dokter
           WHERE dr.no_rawat = ?
             AND j.hari_kerja = ELT(DAYOFWEEK(?), 'AKHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU')
             AND j.jam_mulai >= ?),
          DATE_ADD(TIMESTAMP(?, ?), INTERVAL 24 HOUR)
      ), 1, 0) AS is_expired,
      COALESCE(
          (SELECT MIN(TIMESTAMP(DATE_ADD(?, INTERVAL 1 DAY), j.jam_mulai))
           FROM ${jenis === 'ranap' ? 'dpjp_ranap dr' : 'reg_periksa dr'}
           INNER JOIN jadwal j ON j.kd_dokter = dr.kd_dokter
           WHERE dr.no_rawat = ?
             AND j.hari_kerja = ELT(DAYOFWEEK(?), 'AKHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU')
             AND j.jam_mulai >= ?),
          DATE_ADD(TIMESTAMP(?, ?), INTERVAL 24 HOUR)
      ) AS deadline_waktu
  `;

  try {
    const [rows] = await db.query(query, [
      tglPerawatan,
      noRawat,
      tglPerawatan,
      jamRawat,
      tglPerawatan,
      jamRawat,
      tglPerawatan,
      noRawat,
      tglPerawatan,
      jamRawat,
      tglPerawatan,
      jamRawat,
    ]);

    if (rows.length > 0) {
      return {
        isExpired: rows[0].is_expired === 1,
        deadline: rows[0].deadline_waktu,
      };
    }
  } catch (_e) {
    // Fallback 24 jam manual jika kalkulasi jadwal error
  }

  const dtPerawatan = new Date(tglJamStr);
  const deadlineFallback = new Date(dtPerawatan.getTime() + 24 * 60 * 60 * 1000);
  return {
    isExpired: now > deadlineFallback,
    deadline: deadlineFallback,
  };
}

/**
 * Menyimpan verifikasi ke database
 */
async function verifySoap({
  noRawat,
  tglPerawatan,
  jamRawat,
  jenis = 'ranap',
  kdDokter,
  catatan = '-',
  isSuperAdmin = false,
}) {
  const tableVerif =
    jenis === 'ranap' ? 'verifikasi_pemeriksaan_ranap' : 'verifikasi_pemeriksaan_ralan';

  // 1. Cek apakah sudah terverifikasi sebelumnya
  const [existing] = await db.query(
    `SELECT * FROM ${tableVerif} WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?`,
    [noRawat, tglPerawatan, jamRawat]
  );
  if (existing.length > 0) {
    throw new Error('ALREADY_VERIFIED');
  }

  // 2. Cek apakah kadaluarsa jika bukan SuperAdmin
  if (!isSuperAdmin) {
    const { isExpired } = await checkVerificationDeadline(noRawat, tglPerawatan, jamRawat, jenis);
    if (isExpired) {
      throw new Error('VERIFICATION_EXPIRED');
    }
  }

  // 3. Simpan ke database
  const tglVerif = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const jamVerif = new Date().toLocaleTimeString('it-IT', { timeZone: 'Asia/Jakarta' });

  await db.query(
    `INSERT INTO ${tableVerif} (no_rawat, tgl_perawatan, jam_rawat, kd_dokter, tgl_verifikasi, jam_verifikasi, catatan)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [noRawat, tglPerawatan, jamRawat, kdDokter, tglVerif, jamVerif, catatan || '-']
  );

  return {
    no_rawat: noRawat,
    tgl_perawatan: tglPerawatan,
    jam_rawat: jamRawat,
    kd_dokter: kdDokter,
    tgl_verifikasi: tglVerif,
    jam_verifikasi: jamVerif,
    catatan: catatan || '-',
  };
}

/**
 * Membatalkan verifikasi (hanya SuperAdmin)
 */
async function unverifySoap({
  noRawat,
  tglPerawatan,
  jamRawat,
  jenis = 'ranap',
  isSuperAdmin = false,
}) {
  if (!isSuperAdmin) {
    throw new Error('ONLY_SUPERADMIN_ALLOWED');
  }
  const tableVerif =
    jenis === 'ranap' ? 'verifikasi_pemeriksaan_ranap' : 'verifikasi_pemeriksaan_ralan';
  const [res] = await db.query(
    `DELETE FROM ${tableVerif} WHERE no_rawat = ? AND tgl_perawatan = ? AND jam_rawat = ?`,
    [noRawat, tglPerawatan, jamRawat]
  );
  if (res.affectedRows === 0) {
    throw new Error('NOT_FOUND');
  }
  return true;
}

module.exports = {
  isAdminUser,
  isDoctorDPJP,
  checkVerificationDeadline,
  verifySoap,
  unverifySoap,
};
