/**
 * Seeds `dokter_user_mapping` (login username ↔ kd_dokter) using:
 *   1. Direct NIK equality (dokter.kd_dokter == user.id_user)
 *   2. Name-match heuristics (dokter.nm_dokter == pegawai.nama) for
 *      legacy `Dxxxx` codes
 *
 * No changes are made to the legacy `dokter` table (design decision:
 * no columns on existing tables). Idempotent — INSERT IGNORE semantics.
 *
 * Run via: node scripts/map-dokter-users.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_AES_KEY_USER } = process.env;
  const pool = mysql.createPool({
    host: DB_HOST,
    port: Number.parseInt(DB_PORT, 10) || 3306,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME || 'sik',
  });

  // Two pass approach:
  //  pass 1: direct NIK matches
  //  pass 2: name-match legacy Dxxxx rows (one NIK keeps a duplicated name)
  const direct = `INSERT IGNORE INTO dokter_user_mapping (kd_dokter, username)
     SELECT d.kd_dokter,
            CONVERT(TRIM(CAST(AES_DECRYPT(u.id_user, ?) AS CHAR)) USING latin1)
       FROM dokter d
       INNER JOIN user u
          ON d.kd_dokter = CONVERT(TRIM(CAST(AES_DECRYPT(u.id_user, ?) AS CHAR)) USING latin1)`;

  const nameCandidates = `SELECT d.kd_dokter,
                                 pw.nik,
                                 CONVERT(TRIM(CAST(AES_DECRYPT(u.id_user, ?) AS CHAR)) USING latin1) AS username
       FROM dokter d
       INNER JOIN pegawai pw ON LOWER(TRIM(pw.nama)) = LOWER(TRIM(d.nm_dokter))
       INNER JOIN user u ON pw.nik = CONVERT(TRIM(CAST(AES_DECRYPT(u.id_user, ?) AS CHAR)) USING latin1)
       WHERE d.kd_dokter LIKE 'D%'
         AND NOT EXISTS (SELECT 1 FROM dokter_user_mapping m WHERE m.kd_dokter = d.kd_dokter)`;

  const unmapped = `SELECT d.kd_dokter, d.nm_dokter
       FROM dokter d
       WHERE d.status = '1'
         AND NOT EXISTS (SELECT 1 FROM dokter_user_mapping m WHERE m.kd_dokter = d.kd_dokter)
         AND NOT EXISTS (
           SELECT 1 FROM user u
            WHERE CONVERT(TRIM(CAST(AES_DECRYPT(u.id_user, ?) AS CHAR)) USING latin1) = d.kd_dokter)`;

  try {
    const [directResult] = await pool.query(direct, [DB_AES_KEY_USER, DB_AES_KEY_USER]);
    console.log(`[DOCTOR-MAP] Direct NIK matches mapped: ${directResult.affectedRows}`);

    const [candidates] = await pool.query(nameCandidates, [DB_AES_KEY_USER, DB_AES_KEY_USER]);
    let nameMapped = 0;
    let nameSkipped = 0;
    const seen = new Set();
    for (const candidate of candidates) {
      if (seen.has(candidate.username)) {
        nameSkipped++;
        console.warn(
          `[DOCTOR-MAP] Skip ${candidate.kd_dokter} -> ${candidate.username}: duplicate name (already mapped)`
        );
        continue; // first doctor keeps the name
      }
      seen.add(candidate.username);
      const [res] = await pool.query(
        'INSERT IGNORE INTO dokter_user_mapping (kd_dokter, username) VALUES (?, ?)',
        [candidate.kd_dokter, candidate.username]
      );
      nameMapped += res.affectedRows;
    }
    console.log(
      `[DOCTOR-MAP] Legacy Dxxxx name matches mapped: ${nameMapped} (skipped ${nameSkipped})`
    );

    const [unmappedRows] = await pool.query(unmapped, [DB_AES_KEY_USER]);
    console.log(`[DOCTOR-MAP] Unmapped active doctors remaining: ${unmappedRows.length}`);
    if (unmappedRows.length > 0) {
      console.log('  Samples:', unmappedRows.slice(0, 8));
    }
  } catch (err) {
    console.error('[DOCTOR-MAP] Error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
