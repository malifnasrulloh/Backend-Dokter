const jose = require('jose');
const { z } = require('zod');
const db = require('../../config/db');
const _validateParams = require('../../middleware/validateParams');
const response = require('../../middleware/responseHandler');
const { logger } = require('../../middleware/logger');

const loginSchema = z.object({
  username: z.any().refine((val) => typeof val === 'string' && val.trim().length > 0, {
    message: 'Username tidak boleh kosong',
  }),
  password: z.any().refine((val) => typeof val === 'string' && val.trim().length > 0, {
    message: 'Password tidak boleh kosong',
  }),
});
const redisClient = require('../../config/redis');

const secretKey = () => new TextEncoder().encode(process.env.SECRETTOKEN);

// ── Brute-force lockout per username ─────────────────────────────────────────
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SEC = 15 * 60; // 15 menit
const memLoginAttempts = new Map(); // fallback jika Redis tidak ready

// Cache untuk kolom tabel user (TTL 2 jam)
let cachedUserColumns = null;
let cachedUserColumnsExpiry = 0;
const USER_COLUMNS_CACHE_TTL = 2 * 60 * 60 * 1000; // 2 jam

async function getLoginAttempts(username) {
  if (redisClient.status === 'ready') {
    const val = await redisClient.get(`login_fail:${username}`);
    return val ? parseInt(val, 10) : 0;
  }
  const entry = memLoginAttempts.get(username);
  if (!entry || Date.now() > entry.resetAt) return 0;
  return entry.count;
}

async function incrLoginAttempts(username) {
  if (redisClient.status === 'ready') {
    const key = `login_fail:${username}`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, LOGIN_WINDOW_SEC);
    return count;
  }
  const now = Date.now();
  const entry = memLoginAttempts.get(username) || {
    count: 0,
    resetAt: now + LOGIN_WINDOW_SEC * 1000,
  };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + LOGIN_WINDOW_SEC * 1000;
  }
  entry.count++;
  memLoginAttempts.set(username, entry);
  return entry.count;
}

async function resetLoginAttempts(username) {
  if (redisClient.status === 'ready') {
    await redisClient.del(`login_fail:${username}`);
    return;
  }
  memLoginAttempts.delete(username);
}
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Credential check aligned with the Khanza reference implementation
 * (SIMRS-Khanza-fork/src/fungsi/akses.java): passwords live in the legacy
 * `user`/`admin` tables, AES_ENCRYPT'd with DB_AES_KEY_*; a user is an
 * ADMIN only when username AND password also match the `admin` table.
 */
const ACCESS_TOKEN_TTL_SEC = 172800; // 48 jam

// Token yang kedaluwarsa ≤24 jam masih boleh di-refresh (jendela toleransi).
const REFRESH_GRACE_SEC = 24 * 60 * 60;

async function issueToken(username) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SEC;

  const payload = {
    iss: 'SIRS RS Islam Aminah',
    aud: 'Client RS Islam Aminah REST API',
    iat: iat,
    exp: exp,
    data: {
      username,
    },
  };

  return new jose.SignJWT(payload).setProtectedHeader({ alg: 'HS256' }).sign(secretKey());
}

async function isAdminCredentials(username, password) {
  try {
    const [rows] = await db.query(
      `SELECT 1 FROM admin
        WHERE usere = AES_ENCRYPT(?, ?)
          AND passworde = AES_ENCRYPT(?, ?)
        LIMIT 1`,
      [username, process.env.DB_AES_KEY_USER, password, process.env.DB_AES_KEY_PASS]
    );
    return rows.length > 0;
  } catch (err) {
    logger.error(`[AUTH] Cek admin gagal untuk ${username}: ${err.message}`);
    return false;
  }
}

exports.authentication = async (req, res) => {
  const { username, password } = req.body;

  const parsed = loginSchema.safeParse({ username, password });
  if (!parsed.success) {
    const errorMsg = parsed.error.issues.map((i) => i.message).join(', ');
    return response.badRequest(req, res, errorMsg);
  }

  // Cek lockout sebelum query ke DB
  const attempts = await getLoginAttempts(username);
  if (attempts >= LOGIN_MAX_ATTEMPTS) {
    return response.unauthorized(
      res,
      null,
      `Akun sementara dikunci karena terlalu banyak percobaan login gagal. Coba lagi setelah 15 menit.`
    );
  }

  // Reference semantics (akses.java): admin credentials match username AND
  // password against the `admin` table first; otherwise fall through to
  // the `user` table. Compare via AES_ENCRYPT (deterministic, no decrypt
  // casts) exactly like the desktop app.
  const queryadmin = `
  SELECT
    TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR))       AS username,
    TRIM(CAST(AES_DECRYPT(passworde, ?) AS CHAR)) AS password
  FROM
    admin
  WHERE
    usere = AES_ENCRYPT(?, ?)
    AND passworde = AES_ENCRYPT(?, ?)`;

  let dbColumns;
  const now = Date.now();
  if (cachedUserColumns && now < cachedUserColumnsExpiry) {
    dbColumns = cachedUserColumns;
  } else {
    const [columns] = await db.query('SHOW COLUMNS FROM user');
    dbColumns = columns.map((c) => c.Field);
    cachedUserColumns = dbColumns;
    cachedUserColumnsExpiry = now + USER_COLUMNS_CACHE_TTL;
  }
  const allowedAccessColumns = dbColumns.filter((col) => col !== 'id_user' && col !== 'password');

  const selectFields = [
    'TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) AS username',
    'TRIM(CAST(AES_DECRYPT(password, ?) AS CHAR)) AS password',
    ...allowedAccessColumns,
  ].join(',\n    ');

  const query = `
    SELECT
      ${selectFields}
    FROM
      user
    WHERE
      id_user = AES_ENCRYPT(?, ?)
      AND password = AES_ENCRYPT(?, ?)`;

  const [rowsadmin] = await db.query(queryadmin, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    username,
    process.env.DB_AES_KEY_USER,
    password,
    process.env.DB_AES_KEY_PASS,
  ]);

  const admin = rowsadmin[0];

  if (admin) {
    // Login admin sukses — reset counter
    await resetLoginAttempts(username);

    const token = await issueToken(admin.username);

    const [pjLab] = await db.query(`
      SELECT
        s.kd_dokterlab, d1.nm_dokter as nm_dokterlab,
        s.kd_dokterrad, d2.nm_dokter as nm_dokterrad,
        s.kd_dokterhemodialisa, d3.nm_dokter as nm_dokterhemodialisa,
        s.kd_dokterutd, d4.nm_dokter as nm_dokterutd,
        s.kd_dokterlabpa, d5.nm_dokter as nm_dokterlabpa,
        s.kd_dokterlabmb, d6.nm_dokter as nm_dokterlabmb
      FROM set_pjlab s
      LEFT JOIN dokter d1 ON s.kd_dokterlab = d1.kd_dokter
      LEFT JOIN dokter d2 ON s.kd_dokterrad = d2.kd_dokter
      LEFT JOIN dokter d3 ON s.kd_dokterhemodialisa = d3.kd_dokter
      LEFT JOIN dokter d4 ON s.kd_dokterutd = d4.kd_dokter
      LEFT JOIN dokter d5 ON s.kd_dokterlabpa = d5.kd_dokter
      LEFT JOIN dokter d6 ON s.kd_dokterlabmb = d6.kd_dokter
      LIMIT 1`);
    const pj = pjLab[0] || {};

    return response.ok(
      res,
      {
        nama: admin.username,
        jabatan: 'Admin All',
        kddokter: pj.kd_dokterrad || '',
        namadokter: pj.nm_dokterrad || '',
        kddokterrad: pj.kd_dokterrad || '',
        namadokterrad: pj.nm_dokterrad || '',
        kddokterlab: pj.kd_dokterlab || '',
        namadokterlab: pj.nm_dokterlab || '',
        kddokterhemo: pj.kd_dokterhemodialisa || '',
        namadokterhemo: pj.nm_dokterhemodialisa || '',
        kddokterutd: pj.kd_dokterutd || '',
        namadokterutd: pj.nm_dokterutd || '',
        kddokterlabpa: pj.kd_dokterlabpa || '',
        namadokterlabpa: pj.nm_dokterlabpa || '',
        kddokterlabmb: pj.kd_dokterlabmb || '',
        namadokterlabmb: pj.nm_dokterlabmb || '',
      },
      'Login berhasil',
      {
        token: token,
        isadmin: true,
      }
    );
  }
  let rows = [];
  [rows] = await db.query(query, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    username,
    process.env.DB_AES_KEY_USER,
    password,
    process.env.DB_AES_KEY_PASS,
  ]);
  const user = rows[0];

  if (user) {
    // Login user sukses — reset counter; isadmin hanya jika kredensial
    // (username + password) juga cocok dengan tabel admin (akses.java).
    await resetLoginAttempts(username);
    const isadmin = await isAdminCredentials(username, password);

    const querydetail = `
    SELECT
      pegawai.nik,
      pegawai.nama,
      pegawai.jbtn,
      departemen.nama AS namadep
    FROM
      pegawai
      INNER JOIN departemen ON pegawai.departemen = departemen.dep_id
    WHERE
      pegawai.nik = ?`;

    const [rowsdetail] = await db.query(querydetail, [user.username]);
    const detail = rowsdetail[0];

    if (!detail) {
      return response.unauthorized(res, null, 'Data pegawai tidak ditemukan');
    }

    const token = await issueToken(user.username);

    user.username = undefined;
    user.password = undefined;

    const filteredUserKeys = Object.keys(user)
      .filter((key) => user[key] === 'true')
      .sort();

    const [pjLab] = await db.query(`
        SELECT
          s.kd_dokterlab, d1.nm_dokter as nm_dokterlab,
          s.kd_dokterrad, d2.nm_dokter as nm_dokterrad,
          s.kd_dokterhemodialisa, d3.nm_dokter as nm_dokterhemodialisa,
          s.kd_dokterutd, d4.nm_dokter as nm_dokterutd,
          s.kd_dokterlabpa, d5.nm_dokter as nm_dokterlabpa,
          s.kd_dokterlabmb, d6.nm_dokter as nm_dokterlabmb
        FROM set_pjlab s
        LEFT JOIN dokter d1 ON s.kd_dokterlab = d1.kd_dokter
        LEFT JOIN dokter d2 ON s.kd_dokterrad = d2.kd_dokter
        LEFT JOIN dokter d3 ON s.kd_dokterhemodialisa = d3.kd_dokter
        LEFT JOIN dokter d4 ON s.kd_dokterutd = d4.kd_dokter
        LEFT JOIN dokter d5 ON s.kd_dokterlabpa = d5.kd_dokter
        LEFT JOIN dokter d6 ON s.kd_dokterlabmb = d6.kd_dokter
        LIMIT 1`);
    const pj = pjLab[0] || {};

    return response.ok(
      res,
      {
        nip: detail.nik,
        nama: detail.nama,
        jabatan: detail.jbtn,
        departemen: detail.namadep,
        kddokter: pj.kd_dokterrad || '',
        namadokter: pj.nm_dokterrad || '',
        kddokterrad: pj.kd_dokterrad || '',
        namadokterrad: pj.nm_dokterrad || '',
        kddokterlab: pj.kd_dokterlab || '',
        namadokterlab: pj.nm_dokterlab || '',
        kddokterhemo: pj.kd_dokterhemodialisa || '',
        namadokterhemo: pj.nm_dokterhemodialisa || '',
        kddokterutd: pj.kd_dokterutd || '',
        namadokterutd: pj.nm_dokterutd || '',
        kddokterlabpa: pj.kd_dokterlabpa || '',
        namadokterlabpa: pj.nm_dokterlabpa || '',
        kddokterlabmb: pj.kd_dokterlabmb || '',
        namadokterlabmb: pj.nm_dokterlabmb || '',
      },
      'Login berhasil',
      {
        token: token,
        isadmin: isadmin,
        userakses: filteredUserKeys,
      }
    );
  } else {
    // Login gagal — increment counter, beri pesan umum
    const failCount = await incrLoginAttempts(username);
    const remaining = LOGIN_MAX_ATTEMPTS - failCount;
    const msg =
      remaining > 0
        ? `Username atau password salah. Sisa percobaan: ${remaining}`
        : 'Akun dikunci karena terlalu banyak percobaan gagal. Coba lagi setelah 15 menit.';
    return response.badRequest(req, res, msg);
  }
};

exports.getCapabilities = async (_req, res) => {
  const {
    writeAccessEnabled,
    WRITE_GATED_PREFIXES,
  } = require('../../middleware/writeAccessMiddleware');
  const writeAccess = writeAccessEnabled();

  return response.ok(res, {
    write_access: writeAccess,
    write_endpoints: WRITE_GATED_PREFIXES,
    notifications_enabled: process.env.NOTIFICATIONS_ENABLED !== 'false',
    read_only: !writeAccess,
  });
};

exports.logout = async (_req, res) => {
  res.clearCookie('token');
  return response.ok(res, null, 'Logout berhasil');
};

/**
 * Sliding-session refresh: issues a fresh 48h token from a still-valid (or
 * recently expired within REFRESH_GRACE_SEC) JWT, without re-authenticating.
 * The app never stores the password for silent re-login; it refreshes here
 * instead. Account existence is re-verified so deleted users are rejected.
 * `deps.query` is a test seam (vitest cannot mock CJS require chains).
 */
exports.refreshToken = async (req, res, deps = {}) => {
  const token = req.body?.token;
  const query = deps.query || db.query.bind(db);

  if (!token || typeof token !== 'string') {
    return response.badRequest(res, 'Token wajib diisi');
  }

  let payload;
  try {
    const verified = await jose.jwtVerify(token, secretKey(), {
      clockTolerance: REFRESH_GRACE_SEC,
    });
    payload = verified.payload;
  } catch {
    return response.unauthorized(res, null, 'Sesi berakhir, silakan login ulang');
  }

  const username = payload?.data?.username;
  if (!username) {
    return response.unauthorized(res, null, 'Token tidak valid');
  }

  const [admins] = await query(
    `SELECT 1 FROM admin WHERE usere = AES_ENCRYPT(?, ?) LIMIT 1`,
    [username, process.env.DB_AES_KEY_USER]
  );
  if (admins.length > 0) {
    return response.ok(res, { token: await issueToken(username) }, 'Token berhasil diperbarui');
  }

  const [users] = await query(
    `SELECT 1 FROM user WHERE id_user = AES_ENCRYPT(?, ?) LIMIT 1`,
    [username, process.env.DB_AES_KEY_USER]
  );
  if (users.length > 0) {
    return response.ok(res, { token: await issueToken(username) }, 'Token berhasil diperbarui');
  }

  return response.unauthorized(res, null, 'Akun tidak ditemukan, silakan login ulang');
};

exports.changePassword = async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const username = req.user?.username;

  if (!username) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  if (!oldPassword || !newPassword) {
    return response.badRequest(res, 'Password lama dan password baru wajib diisi');
  }

  if (newPassword.length < 8) {
    return response.badRequest(res, 'Password baru minimal harus 8 karakter');
  }

  if (newPassword === username) {
    return response.badRequest(res, 'Password baru tidak boleh sama dengan username/NIK');
  }

  if (newPassword === oldPassword) {
    return response.badRequest(res, 'Password baru tidak boleh sama dengan password lama');
  }

  // 1. Cek di tabel admin dulu (untuk akun admin utama seperti 'sirs')
  const queryAdmin = `
    SELECT 
      TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) AS username,
      TRIM(CAST(AES_DECRYPT(passworde, ?) AS CHAR)) AS password
    FROM admin 
    WHERE usere = AES_ENCRYPT(?, ?)
  `;

  const [admins] = await db.query(queryAdmin, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    username,
    process.env.DB_AES_KEY_USER,
  ]);

  if (admins.length > 0) {
    const admin = admins[0];
    if (admin.password !== oldPassword) {
      return response.badRequest(res, 'Password lama salah');
    }

    // Update password di tabel admin (AES, sama seperti aplikasi desktop)
    const updateQuery = `
      UPDATE admin 
      SET passworde = AES_ENCRYPT(?, ?) 
      WHERE usere = AES_ENCRYPT(?, ?)
    `;
    await db.query(updateQuery, [
      newPassword,
      process.env.DB_AES_KEY_PASS,
      username,
      process.env.DB_AES_KEY_USER,
    ]);

    return response.ok(res, null, 'Password admin berhasil diubah');
  }

  // 2. Jika bukan admin utama, cek di tabel user
  const queryUser = `
    SELECT 
      TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) AS username,
      TRIM(CAST(AES_DECRYPT(password, ?) AS CHAR)) AS password
    FROM user 
    WHERE id_user = AES_ENCRYPT(?, ?)
  `;

  const [users] = await db.query(queryUser, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    username,
    process.env.DB_AES_KEY_USER,
  ]);

  if (users.length > 0) {
    const user = users[0];
    if (user.password !== oldPassword) {
      return response.badRequest(res, 'Password lama salah');
    }

    // Update password di tabel user (AES, sama seperti aplikasi desktop)
    const updateQuery = `
      UPDATE user 
      SET password = AES_ENCRYPT(?, ?) 
      WHERE id_user = AES_ENCRYPT(?, ?)
    `;
    await db.query(updateQuery, [
      newPassword,
      process.env.DB_AES_KEY_PASS,
      username,
      process.env.DB_AES_KEY_USER,
    ]);

    return response.ok(res, null, 'Password berhasil diubah');
  }

  return response.notFound(res, 'Data pengguna tidak ditemukan');
};

exports.getHarianAccess = async (req, res) => {
  const username = req.user?.username;
  if (!username) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  // Check if user is admin
  const [adminCheck] = await db.query(
    `SELECT 1 FROM admin WHERE TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ?`,
    [process.env.DB_AES_KEY_USER, username]
  );
  if (adminCheck.length === 0) {
    return response.forbidden(res, 'Hanya administrator yang diizinkan mengakses konfigurasi.');
  }

  try {
    // 1. Fetch active doctors
    const [doctors] = await db.query(`
      SELECT 
        dokter.kd_dokter, 
        dokter.nm_dokter, 
        spesialis.nm_sps as spesialis
      FROM dokter
      LEFT JOIN spesialis ON dokter.kd_sps = spesialis.kd_sps
      WHERE dokter.status = '1'
      ORDER BY dokter.nm_dokter ASC
    `);

    // 2. Fetch harian_dokter state from user table
    const [users] = await db.query(
      `
      SELECT 
        TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) as username,
        harian_dokter
      FROM user
    `,
      [process.env.DB_AES_KEY_USER]
    );

    const usersMap = {};
    for (const u of users) {
      usersMap[u.username] = u.harian_dokter;
    }

    const result = doctors.map((doc) => {
      const access = usersMap[doc.kd_dokter] || 'false';
      return {
        kd_dokter: doc.kd_dokter,
        nm_dokter: doc.nm_dokter,
        spesialis: doc.spesialis || '-',
        harian_dokter: access === 'true',
      };
    });

    return response.ok(res, result);
  } catch (error) {
    return response.internalError(req, res, error);
  }
};

exports.updateHarianAccess = async (req, res) => {
  const username = req.user?.username;
  if (!username) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  // Check if user is admin
  const [adminCheck] = await db.query(
    `SELECT 1 FROM admin WHERE TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ?`,
    [process.env.DB_AES_KEY_USER, username]
  );
  if (adminCheck.length === 0) {
    return response.forbidden(res, 'Hanya administrator yang diizinkan mengubah konfigurasi.');
  }

  const { kd_dokter, harian_dokter } = req.body;
  if (!kd_dokter) {
    return response.badRequest(res, 'Kode dokter wajib diisi');
  }

  try {
    const val = harian_dokter === true ? 'true' : 'false';

    const updateQuery = `
      UPDATE user
      SET harian_dokter = ?
      WHERE TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) = ?
    `;
    const [result] = await db.query(updateQuery, [val, process.env.DB_AES_KEY_USER, kd_dokter]);

    if (result.affectedRows === 0) {
      return response.notFound(res, 'Pengguna (dokter) tidak ditemukan di tabel user');
    }

    return response.ok(res, null, 'Akses Harian Dokter berhasil diperbarui');
  } catch (error) {
    return response.internalError(req, res, error);
  }
};
