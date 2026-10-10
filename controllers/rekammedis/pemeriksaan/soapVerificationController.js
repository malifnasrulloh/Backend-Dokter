const response = require('../../../middleware/responseHandler');
const {
  isAdminUser,
  isDoctorDPJP,
  verifySoap,
  unverifySoap,
} = require('../../../services/soapVerificationService');
const { resolveDoctorKdSet } = require('../../../utils/doctorIdentity');

exports.verifikasiSoap = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat, jenis = 'ranap', catatan } = req.body || {};
  if (!no_rawat || !tgl_perawatan || !jam_rawat) {
    return response.badRequest(res, 'Parameter no_rawat, tgl_perawatan, dan jam_rawat wajib diisi');
  }

  const user = req.user || {};
  const username = user.username || '';
  const isSuperAdmin = await isAdminUser(username);

  // 1. Validasi hak DPJP
  const isDPJP = await isDoctorDPJP(no_rawat, username, jenis, isSuperAdmin);
  if (!isDPJP) {
    return response.forbidden(res, 'Maaf, Anda bukan Dokter DPJP untuk pasien ini');
  }

  // 2. Ambil kode dokter verifikator
  const doctorCodes = await resolveDoctorKdSet(username);
  const kdDokterVerif = doctorCodes.length > 0 ? doctorCodes[0] : username;

  try {
    const data = await verifySoap({
      noRawat: no_rawat,
      tglPerawatan: tgl_perawatan,
      jamRawat: jam_rawat,
      jenis,
      kdDokter: kdDokterVerif,
      catatan,
      isSuperAdmin,
    });
    return response.ok(res, data, 'Catatan SOAPIE berhasil diverifikasi oleh DPJP');
  } catch (err) {
    if (err.message === 'ALREADY_VERIFIED') {
      return response.badRequest(res, 'Catatan SOAPIE ini sudah diverifikasi sebelumnya');
    }
    if (err.message === 'VERIFICATION_EXPIRED') {
      return response.forbidden(
        res,
        'Batas waktu verifikasi DPJP telah berakhir (Kadaluarsa). Hanya SuperAdmin yang dapat memberikan dispensasi'
      );
    }
    return response.internalError(req, res, err, 'Gagal memproses verifikasi SOAPIE');
  }
};

exports.batalVerifikasiSoap = async (req, res) => {
  const { no_rawat, tgl_perawatan, jam_rawat, jenis = 'ranap' } = req.body || {};
  if (!no_rawat || !tgl_perawatan || !jam_rawat) {
    return response.badRequest(res, 'Parameter no_rawat, tgl_perawatan, dan jam_rawat wajib diisi');
  }

  const user = req.user || {};
  const username = user.username || '';
  const isSuperAdmin = await isAdminUser(username);

  if (!isSuperAdmin) {
    return response.forbidden(
      res,
      'Catatan SOAPIE ini sudah diverifikasi oleh DPJP. Hanya SuperAdmin yang berwenang membatalkan verifikasi'
    );
  }

  try {
    await unverifySoap({
      noRawat: no_rawat,
      tglPerawatan: tgl_perawatan,
      jamRawat: jam_rawat,
      jenis,
      isSuperAdmin,
    });
    return response.ok(res, null, 'Verifikasi SOAPIE berhasil dibatalkan');
  } catch (err) {
    if (err.message === 'NOT_FOUND') {
      return response.notFound(res, 'Data verifikasi tidak ditemukan');
    }
    return response.internalError(req, res, err, 'Gagal membatalkan verifikasi SOAPIE');
  }
};
