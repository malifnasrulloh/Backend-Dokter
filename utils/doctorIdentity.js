/**
 * Doctor identity resolution (finding F9).
 *
 * `reg_periksa.kd_dokter` mixes NIK-style values (e.g. '4202091815')
 * and legacy 'Dxxxx' codes. A doctor logs in with their NIK (user.id),
 * so filtering `kd_dokter = username` misses legacy-coded rows.
 *
 * `dokter_user_mapping` (migration 0006, seeded by
 * scripts/map-dokter-users.js) links legacy codes to the login username.
 * Patient lists filter by the resolved candidate set instead of a single
 * value. No columns are added to the legacy `dokter` table.
 */
const db = require('../config/db');

async function resolveDoctorKdSet(username) {
  if (!username || typeof username !== 'string') return [];
  const codes = new Set([username]);
  const [direct] = await db.query('SELECT kd_dokter FROM dokter WHERE kd_dokter = ?', [username]);
  for (const row of direct) codes.add(row.kd_dokter);
  const [mapped] = await db.query(
    `SELECT m.kd_dokter
       FROM dokter_user_mapping m
       INNER JOIN dokter d ON d.kd_dokter = m.kd_dokter
      WHERE m.username = ?`,
    [username]
  );
  for (const row of mapped) codes.add(row.kd_dokter);
  return [...codes];
}

/**
 * Returns `{ sql, params }` for `column IN (...)` over the doctor's
 * candidate kd_dokter values.
 */
async function doctorInCondition(column, username) {
  const codes = await resolveDoctorKdSet(username);
  if (codes.length === 0) return { sql: '1 = 0', params: [] };
  const placeholders = codes.map(() => '?').join(', ');
  return { sql: `${column} IN (${placeholders})`, params: codes };
}

module.exports = { resolveDoctorKdSet, doctorInCondition };
