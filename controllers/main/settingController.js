const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const db = require('../../config/db');
const response = require('../../middleware/responseHandler');

exports.getSetting = async (_req, res) => {
  const [rows] = await db.query(`
    SELECT
      nama_instansi, alamat_instansi, kabupaten, propinsi, kontak, email,
      kode_ppk, kode_ppkinhealth, kode_ppkkemenkes
    FROM setting
    LIMIT 1
  `);

  if (rows.length === 0) {
    return response.notFound(res, 'Data setting tidak ditemukan');
  }

  return response.ok(res, rows[0]);
};

exports.updateSetting = async (req, res) => {
  const data = req.body;

  if (Object.keys(data).length === 0) {
    return response.badRequest(req, res, 'Tidak ada data untuk diperbarui');
  }

  const fields = Object.keys(data)
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = Object.values(data);

  const query = `UPDATE setting SET ${fields}`;
  await db.query(query, values);

  return response.ok(res, null, 'Data setting berhasil diperbarui');
};

// Broadcast tidak dipakai di backend dokter (tanpa websocket)
exports.getBroadcast = async (_req, res) => {
  return response.ok(res, { broadcast_info: '', broadcast_active: false });
};

exports.updateBroadcast = async (_req, res) => {
  return response.ok(res, null, 'Broadcast tidak tersedia di backend dokter');
};

/**
 * GET /api/setting/app-version
 * Returns latest active mobile application release metadata, SHA-256 hash, and download URL.
 */
exports.getAppVersion = async (_req, res) => {
  const [rows] = await db.query(`
    SELECT
      version_name,
      version_code,
      min_supported_version,
      release_notes,
      file_name,
      file_size,
      sha256_checksum,
      download_url,
      created_at
    FROM app_releases
    WHERE is_active = 1
    ORDER BY version_code DESC
    LIMIT 1
  `);

  if (rows.length === 0) {
    // Default fallback if no release uploaded yet
    return response.ok(res, {
      version_name: '1.3.0',
      version_code: 1,
      min_supported_version: '1.0.0',
      release_notes: 'Rilis awal aplikasi E-Dokter.',
      file_name: '',
      file_size: 0,
      sha256_checksum: '',
      download_url: '/api/setting/app-download',
    });
  }

  return response.ok(res, rows[0]);
};

/**
 * POST /api/setting/app-version
 * Admin endpoint: publish or register new app version with automatic SHA-256 calculation.
 */
exports.publishAppVersion = async (req, res) => {
  const username = req.user?.username;
  if (!username) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  // Admin verification
  const [adminCheck] = await db.query(
    `SELECT 1 FROM admin WHERE TRIM(CAST(AES_DECRYPT(usere, ?) AS CHAR)) = ? LIMIT 1`,
    [process.env.DB_AES_KEY_USER, username]
  );
  if (adminCheck.length === 0) {
    return response.forbidden(
      res,
      'Hanya administrator yang diizinkan mempublikasikan versi aplikasi.'
    );
  }

  const { version_name, version_code, min_supported_version, release_notes, file_name, sha256 } =
    req.body;

  if (!version_name || !version_code) {
    return response.badRequest(res, 'version_name dan version_code wajib diisi.');
  }

  let finalChecksum = sha256 || '';
  let finalFileSize = 0;
  const targetFileName = file_name || `edokter-v${version_name}.apk`;
  const releasesDir = path.join(__dirname, '../../uploads/releases');
  const apkPath = path.join(releasesDir, targetFileName);

  if (fs.existsSync(apkPath)) {
    const stats = fs.statSync(apkPath);
    finalFileSize = stats.size;
    if (!finalChecksum) {
      const fileBuffer = fs.readFileSync(apkPath);
      finalChecksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    }
  }

  const downloadUrl = `/api/setting/app-download?file=${encodeURIComponent(targetFileName)}`;

  await db.query(
    `INSERT INTO app_releases (
      app_name, version_name, version_code, min_supported_version,
      release_notes, file_name, file_size, sha256_checksum, download_url, is_active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      'E-Dokter',
      version_name,
      parseInt(version_code, 10),
      min_supported_version || version_name,
      release_notes || '',
      targetFileName,
      finalFileSize,
      finalChecksum,
      downloadUrl,
    ]
  );

  return response.ok(
    res,
    {
      version_name,
      version_code,
      min_supported_version: min_supported_version || version_name,
      sha256_checksum: finalChecksum,
      file_size: finalFileSize,
      download_url: downloadUrl,
    },
    'Versi aplikasi berhasil dipublikasikan'
  );
};

/**
 * GET /api/setting/app-download
 * Streams the APK file with Content-Length and octet-stream headers for reliable mobile downloading.
 */
exports.downloadApp = async (req, res) => {
  const fileName = req.query.file || 'edokter-release.apk';
  // Prevent directory traversal
  const safeBase = path.basename(fileName);
  const releasesDir = path.join(__dirname, '../../uploads/releases');
  const filePath = path.join(releasesDir, safeBase);

  if (!fs.existsSync(filePath)) {
    return response.notFound(res, 'File APK rilis belum tersedia di server.');
  }

  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);

  res.status(200);
  res.headers = {
    ...res.headers,
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Disposition': `attachment; filename="${safeBase}"`,
    'Content-Length': stat.size.toString(),
  };

  return stream;
};
