const jose = require('jose');
const { z } = require('zod');
const db = require('../../config/db');
const validateParams = require('../../middleware/validateParams');
const response = require('../../middleware/responseHandler');

const loginSchema = z.object({
  username: z.any().refine((val) => typeof val === 'string' && val.trim().length > 0, {
    message: 'Username tidak boleh kosong',
  }),
  password: z.any().refine((val) => typeof val === 'string' && val.trim().length > 0, {
    message: 'Password tidak boleh kosong',
  }),
});
const redisClient = require('../../config/redis');

const secretKey = new TextEncoder().encode(process.env.SECRETTOKEN);

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
  const entry = memLoginAttempts.get(username) || { count: 0, resetAt: now + LOGIN_WINDOW_SEC * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + LOGIN_WINDOW_SEC * 1000; }
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

  const queryadmin = `
  SELECT
    TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR))       AS username,
    TRIM(CAST(AES_DECRYPT(passworde, ?) AS CHAR)) AS password
  FROM
    admin
  WHERE
    TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ?
    AND TRIM(CAST(AES_DECRYPT(passworde, ?) AS CHAR)) = ?`;

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
  const allowedAccessColumns = dbColumns.filter(
    (col) => col !== 'id_user' && col !== 'password'
  );

  const selectFields = [
    'TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) AS username',
    'TRIM(CAST(AES_DECRYPT(password, ?) AS CHAR)) AS password',
    ...allowedAccessColumns
  ].join(',\n    ');

  const query = `
    SELECT
      ${selectFields}
    FROM
      user
    WHERE
      TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) = ?
      AND TRIM(CAST(AES_DECRYPT(password, ?) AS CHAR)) = ?
  `;
  const [rowsadmin] = await db.query(queryadmin, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    process.env.DB_AES_KEY_USER,
    username,
    process.env.DB_AES_KEY_PASS,
    password,
  ]);

  const admin = rowsadmin[0];
  let user = null;
  let rows = [];

  if (rowsadmin.length > 0) {
    // Login admin sukses — reset counter
    await resetLoginAttempts(username);

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 172800;

    const payload = {
      iss: 'SIRS RS Islam Aminah',
      aud: 'Client RS Islam Aminah REST API',
      iat: iat,
      exp: exp,
      data: {
        username: admin.username,
      },
    };

    const token = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secretKey);

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
        nama: 'Admin Ganteng',
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
  [rows] = await db.query(query, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    process.env.DB_AES_KEY_USER,
    username,
    process.env.DB_AES_KEY_PASS,
    password,
  ]);
  user = rows[0];

  if (rows.length > 0) {
    // Login user sukses — reset counter
    await resetLoginAttempts(username);

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

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 172800;

    const payload = {
      iss: 'SIRS RS Islam Aminah',
      aud: 'Client RS Islam Aminah REST API',
      iat: iat,
      exp: exp,
      data: {
        username: user.username,
      },
    };

    const token = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256' })
      .sign(secretKey);

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
        isadmin: username === 'K0000086',
        userakses: filteredUserKeys,
      }
    );
  } else {
    // Login gagal — increment counter, beri pesan umum
    const failCount = await incrLoginAttempts(username);
    const remaining = LOGIN_MAX_ATTEMPTS - failCount;
    const msg = remaining > 0
      ? `Username atau password salah. Sisa percobaan: ${remaining}`
      : 'Akun dikunci karena terlalu banyak percobaan gagal. Coba lagi setelah 15 menit.';
    return response.badRequest(req, res, msg);
  }
};

exports.logout = async (req, res) => {
  res.clearCookie('token');
  return response.ok(res, null, 'Logout berhasil');
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
    WHERE TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ?
  `;

  const [admins] = await db.query(queryAdmin, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    process.env.DB_AES_KEY_USER,
    username,
  ]);

  if (admins.length > 0) {
    const admin = admins[0];
    if (admin.password !== oldPassword) {
      return response.badRequest(res, 'Password lama salah');
    }

    // Update password di tabel admin
    const updateQuery = `
      UPDATE admin 
      SET passworde = AES_ENCRYPT(?, ?) 
      WHERE TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ?
    `;
    await db.query(updateQuery, [
      newPassword,
      process.env.DB_AES_KEY_PASS,
      process.env.DB_AES_KEY_USER,
      username,
    ]);

    return response.ok(res, null, 'Password admin berhasil diubah');
  }

  // 2. Jika bukan admin utama, cek di tabel user (untuk pegawai biasa, termasuk K0000086)
  const queryUser = `
    SELECT 
      TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) AS username,
      TRIM(CAST(AES_DECRYPT(password, ?) AS CHAR)) AS password
    FROM user 
    WHERE TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) = ?
  `;

  const [users] = await db.query(queryUser, [
    process.env.DB_AES_KEY_USER,
    process.env.DB_AES_KEY_PASS,
    process.env.DB_AES_KEY_USER,
    username,
  ]);

  if (users.length > 0) {
    const user = users[0];
    if (user.password !== oldPassword) {
      return response.badRequest(res, 'Password lama salah');
    }

    // Update password di tabel user
    const updateQuery = `
      UPDATE user 
      SET password = AES_ENCRYPT(?, ?) 
      WHERE TRIM(CAST(AES_DECRYPT(id_user, ?) AS CHAR)) = ?
    `;
    await db.query(updateQuery, [
      newPassword,
      process.env.DB_AES_KEY_PASS,
      process.env.DB_AES_KEY_USER,
      username,
    ]);

    return response.ok(res, null, 'Password berhasil diubah');
  }

  return response.notFound(res, 'Data pengguna tidak ditemukan');
};

