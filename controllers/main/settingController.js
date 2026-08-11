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
