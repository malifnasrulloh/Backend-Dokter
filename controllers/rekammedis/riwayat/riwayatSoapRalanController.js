const db = require('../../../config/db');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');
const { resolveDoctorKdSet } = require('../../../utils/doctorIdentity');

exports.getRiwayatSoapRalan = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const user = req.user || {};
  const username = user.username || '';
  const isSuperAdmin = user.isadmin === true || username.toLowerCase() === 'admin';
  const doctorCodes = await resolveDoctorKdSet(username);

  const query = `SELECT
          pemeriksaan_ralan.tgl_perawatan,
          pemeriksaan_ralan.jam_rawat,
          pemeriksaan_ralan.suhu_tubuh,
          pemeriksaan_ralan.tensi,
          pemeriksaan_ralan.nadi,
          pemeriksaan_ralan.respirasi,
          pemeriksaan_ralan.tinggi,
          pemeriksaan_ralan.berat,
          pemeriksaan_ralan.spo2,
          pemeriksaan_ralan.gcs,
          pemeriksaan_ralan.kesadaran,
          pemeriksaan_ralan.keluhan,
          pemeriksaan_ralan.pemeriksaan,
          pemeriksaan_ralan.alergi,
          pemeriksaan_ralan.lingkar_perut,
          pemeriksaan_ralan.rtl,
          pemeriksaan_ralan.penilaian,
          pemeriksaan_ralan.instruksi,
          pemeriksaan_ralan.evaluasi,
          pemeriksaan_ralan.nip,
          pegawai.nama,
          pegawai.jbtn,
          verif.kd_dokter AS v_kd_dokter,
          COALESCE(dok_v.nm_dokter, peg_v.nama, verif.kd_dokter) AS v_nm_dokter,
          IFNULL(verif.tgl_verifikasi, '') AS v_tgl,
          IFNULL(verif.jam_verifikasi, '') AS v_jam,
          IFNULL(verif.catatan, '') AS v_catatan,
          IF(verif.tgl_verifikasi IS NOT NULL, 'SUDAH',
             IF(NOW() > COALESCE(
                 (SELECT MIN(TIMESTAMP(DATE_ADD(pemeriksaan_ralan.tgl_perawatan, INTERVAL 1 DAY), j.jam_mulai))
                  FROM reg_periksa rp
                  INNER JOIN jadwal j ON j.kd_dokter = rp.kd_dokter
                  WHERE rp.no_rawat = pemeriksaan_ralan.no_rawat
                    AND j.hari_kerja = ELT(DAYOFWEEK(pemeriksaan_ralan.tgl_perawatan), 'AKHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU')
                    AND j.jam_mulai >= pemeriksaan_ralan.jam_rawat),
                 DATE_ADD(TIMESTAMP(pemeriksaan_ralan.tgl_perawatan, pemeriksaan_ralan.jam_rawat), INTERVAL 24 HOUR)
             ), 'KADALUARSA', 'BELUM')) AS status_verifikasi,
          IF(reg_periksa.kd_dokter IN (?), 1, 0) AS is_patient_dpjp
      FROM
          pemeriksaan_ralan
          INNER JOIN pegawai ON pemeriksaan_ralan.nip = pegawai.nik
          INNER JOIN reg_periksa ON pemeriksaan_ralan.no_rawat = reg_periksa.no_rawat
          LEFT JOIN verifikasi_pemeriksaan_ralan verif ON verif.no_rawat = pemeriksaan_ralan.no_rawat
            AND verif.tgl_perawatan = pemeriksaan_ralan.tgl_perawatan
            AND verif.jam_rawat = pemeriksaan_ralan.jam_rawat
          LEFT JOIN dokter dok_v ON dok_v.kd_dokter = verif.kd_dokter
          LEFT JOIN pegawai peg_v ON peg_v.nik = verif.kd_dokter
      WHERE
          pemeriksaan_ralan.no_rawat = ?
      ORDER BY
          pemeriksaan_ralan.tgl_perawatan,
          pemeriksaan_ralan.jam_rawat`;

  const [rows] = await db.query(query, [doctorCodes.length > 0 ? doctorCodes : ['-'], no_rawat]);

  if (rows.length === 0) {
    return response.noContent(res);
  }

  const mapped = rows.map((r) => {
    const isVerified = r.status_verifikasi === 'SUDAH';
    const isExpired = r.status_verifikasi === 'KADALUARSA';
    const isDPJP = isSuperAdmin || Number(r.is_patient_dpjp) > 0;
    const isOwnEntry = doctorCodes.includes(r.nip) || r.nip === username;

    return {
      ...r,
      is_verified: isVerified,
      is_own_entry: isOwnEntry,
      can_verify: isSuperAdmin ? !isVerified : !isVerified && !isExpired && isDPJP && !isOwnEntry,
    };
  });

  return response.ok(res, mapped);
};
