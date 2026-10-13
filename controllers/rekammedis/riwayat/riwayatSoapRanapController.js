const db = require('../../../config/db');
const validateParams = require('../../../middleware/validateParams');
const response = require('../../../middleware/responseHandler');
const { resolveDoctorKdSet } = require('../../../utils/doctorIdentity');

exports.getRiwayatSoapRanap = async (req, res) => {
  const { no_rawat } = req.query;

  const queryParams = { no_rawat };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  const user = req.user || {};
  const username = user.username || '';
  const isSuperAdmin = user.isadmin === true || username.toLowerCase() === 'admin';
  const doctorCodes = await resolveDoctorKdSet(username);

  const query = `SELECT
          pemeriksaan_ranap.suhu_tubuh,
          pemeriksaan_ranap.tensi,
          pemeriksaan_ranap.nadi,
          pemeriksaan_ranap.respirasi,
          pemeriksaan_ranap.tinggi,
          pemeriksaan_ranap.berat,
          pemeriksaan_ranap.spo2,
          pemeriksaan_ranap.gcs,
          pemeriksaan_ranap.kesadaran,
          pemeriksaan_ranap.keluhan,
          pemeriksaan_ranap.penilaian,
          pemeriksaan_ranap.rtl,
          pemeriksaan_ranap.pemeriksaan,
          pemeriksaan_ranap.alergi,
          pemeriksaan_ranap.tgl_perawatan,
          pemeriksaan_ranap.jam_rawat,
          pemeriksaan_ranap.nip,
          pegawai.nama,
          pegawai.jbtn,
          pemeriksaan_ranap.instruksi,
          pemeriksaan_ranap.evaluasi,
          verif.kd_dokter AS v_kd_dokter,
          COALESCE(dok_v.nm_dokter, peg_v.nama, verif.kd_dokter) AS v_nm_dokter,
          IFNULL(verif.tgl_verifikasi, '') AS v_tgl,
          IFNULL(verif.jam_verifikasi, '') AS v_jam,
          IFNULL(verif.catatan, '') AS v_catatan,
          IF(verif.tgl_verifikasi IS NOT NULL, 'SUDAH',
             IF(NOW() > COALESCE(
                 (SELECT MIN(TIMESTAMP(DATE_ADD(pemeriksaan_ranap.tgl_perawatan, INTERVAL 1 DAY), j.jam_mulai))
                  FROM dpjp_ranap dr
                  INNER JOIN jadwal j ON j.kd_dokter = dr.kd_dokter
                  WHERE dr.no_rawat = pemeriksaan_ranap.no_rawat
                    AND j.hari_kerja = ELT(DAYOFWEEK(pemeriksaan_ranap.tgl_perawatan), 'AKHAD', 'SENIN', 'SELASA', 'RABU', 'KAMIS', 'JUMAT', 'SABTU')
                    AND j.jam_mulai >= pemeriksaan_ranap.jam_rawat),
                 DATE_ADD(TIMESTAMP(pemeriksaan_ranap.tgl_perawatan, pemeriksaan_ranap.jam_rawat), INTERVAL 24 HOUR)
             ), 'KADALUARSA', 'BELUM')) AS status_verifikasi,
          (SELECT COUNT(*) FROM dpjp_ranap WHERE dpjp_ranap.no_rawat = pemeriksaan_ranap.no_rawat AND dpjp_ranap.kd_dokter IN (?)) AS is_patient_dpjp
      FROM
          pemeriksaan_ranap
          INNER JOIN pegawai ON pemeriksaan_ranap.nip = pegawai.nik
          INNER JOIN reg_periksa ON pemeriksaan_ranap.no_rawat = reg_periksa.no_rawat
          LEFT JOIN verifikasi_pemeriksaan_ranap verif ON verif.no_rawat = pemeriksaan_ranap.no_rawat
            AND verif.tgl_perawatan = pemeriksaan_ranap.tgl_perawatan
            AND verif.jam_rawat = pemeriksaan_ranap.jam_rawat
          LEFT JOIN dokter dok_v ON dok_v.kd_dokter = verif.kd_dokter
          LEFT JOIN pegawai peg_v ON peg_v.nik = verif.kd_dokter
      WHERE
          pemeriksaan_ranap.no_rawat = ?
      ORDER BY
          pemeriksaan_ranap.tgl_perawatan,
          pemeriksaan_ranap.jam_rawat`;

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
