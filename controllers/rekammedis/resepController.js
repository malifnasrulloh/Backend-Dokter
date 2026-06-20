const knex = require('../../config/knex');
const response = require('../../middleware/responseHandler');
const validateParams = require('../../middleware/validateParams');
const dayjs = require('dayjs');
const { logger } = require('../../middleware/logger');

// ── GET MEDICINE LIST (WITH STOCK) ───────────────────────────────────────────

exports.getMedicineList = async (req, res) => {
  const { keyword, page = 1, limit = 20 } = req.query;

  const pageNum = Number.parseInt(page, 10) || 1;
  const limitNum = Number.parseInt(limit, 10) || 20;
  const offset = (pageNum - 1) * limitNum;

  try {
    let query = knex('databarang as db')
      .leftJoin('kodesatuan as ks', 'db.kode_sat', 'ks.kode_sat')
      .leftJoin('gudangbarang as gb', 'db.kode_brng', 'gb.kode_brng')
      .select(
        'db.kode_brng',
        'db.nama_brng',
        'ks.satuan',
        'db.ralan as harga',
        knex.raw('COALESCE(SUM(gb.stok), 0) as total_stok')
      )
      .where('db.status', '1');

    if (keyword && keyword.trim() !== '') {
      const searchPattern = `%${keyword.trim()}%`;
      query = query.andWhere((builder) => {
        builder.where('db.nama_brng', 'like', searchPattern)
               .orWhere('db.kode_brng', 'like', searchPattern);
      });
    }

    query = query.groupBy('db.kode_brng', 'db.nama_brng', 'ks.satuan', 'db.ralan');

    // Run total count query
    const totalQuery = knex.select(knex.raw('count(distinct db.kode_brng) as total'))
      .from('databarang as db')
      .where('db.status', '1');

    if (keyword && keyword.trim() !== '') {
      const searchPattern = `%${keyword.trim()}%`;
      totalQuery.andWhere((builder) => {
        builder.where('db.nama_brng', 'like', searchPattern)
                  .orWhere('db.kode_brng', 'like', searchPattern);
      });
    }

    const [totalRecord, list] = await Promise.all([
      totalQuery.first(),
      query.orderBy('db.nama_brng', 'asc').limit(limitNum).offset(offset)
    ]);

    const totalCount = totalRecord?.total || 0;
    const totalPages = Math.ceil(totalCount / limitNum);

    return response.ok(res, {
      list,
      pagination: {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        total_pages: totalPages
      }
    });
  } catch (error) {
    logger.error('Get Medicine List Error:', error);
    return response.internalError(req, res, error, 'Gagal mengambil daftar obat');
  }
};

// ── CREATE PRESCRIPTION (TRANSACTIONAL) ──────────────────────────────────────

exports.createPrescription = async (req, res) => {
  const { no_rawat, status, items } = req.body;
  const doctorNik = req.user?.username;

  if (!doctorNik) {
    return response.unauthorized(res, null, 'User tidak terautentikasi');
  }

  const queryParams = { no_rawat, status };
  const validateErrors = validateParams(req, res, queryParams);
  if (validateErrors) return;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return response.failedSave(res, 'Item resep tidak boleh kosong');
  }

  const trx = await knex.transaction();

  try {
    const today = dayjs().format('YYYY-MM-DD');
    const todayStr = dayjs().format('YYYYMMDD');
    const timeNow = dayjs().format('HH:mm:ss');

    // Generate no_resep matching format: YYYYMMDDXXXX
    const maxRecord = await trx('resep_obat')
      .where('tgl_perawatan', today)
      .orWhere('tgl_peresepan', today)
      .select(trx.raw('COALESCE(MAX(CONVERT(RIGHT(no_resep, 4), SIGNED)), 0) as max_val'))
      .first();

    const nextSeq = (maxRecord?.max_val || 0) + 1;
    const paddedSeq = String(nextSeq).padStart(4, '0');
    const no_resep = `${todayStr}${paddedSeq}`;

    // Insert to resep_obat
    const resepObatData = {
      no_resep,
      tgl_perawatan: today,
      jam: timeNow,
      no_rawat,
      kd_dokter: doctorNik,
      tgl_peresepan: today,
      jam_peresepan: timeNow,
      status,
      tgl_penyerahan: '0000-00-00',
      jam_penyerahan: '00:00:00'
    };

    await trx('resep_obat').insert(resepObatData);

    // Insert to resep_dokter
    const resepDokterRows = items.map((item) => ({
      no_resep,
      kode_brng: item.kode_brng,
      jml: Number.parseFloat(item.jml) || 0,
      aturan_pakai: item.aturan_pakai || '-'
    }));

    await trx('resep_dokter').insert(resepDokterRows);

    await trx.commit();

    return response.created(res, {
      no_resep,
      ...resepObatData,
      items: resepDokterRows
    });
  } catch (error) {
    await trx.rollback();
    logger.error('Create Prescription Error:', error);
    return response.internalError(req, res, error, 'Gagal menyimpan resep obat');
  }
};

// ── DELETE PRESCRIPTION ──────────────────────────────────────────────────────

exports.deletePrescription = async (req, res) => {
  const { no_resep } = req.params;

  if (!no_resep) {
    return response.failedDelete(res, 'No Resep harus disertakan');
  }

  const trx = await knex.transaction();

  try {
    // Check if resep exists and whether it has been processed/dispensed
    const prescription = await trx('resep_obat')
      .where({ no_resep })
      .first();

    if (!prescription) {
      await trx.rollback();
      return response.failedDelete(res, 'Resep obat tidak ditemukan');
    }

    if (prescription.tgl_penyerahan !== '0000-00-00' && prescription.tgl_penyerahan !== null) {
      await trx.rollback();
      return response.failedDelete(res, 'Resep sudah diproses/diserahkan oleh apotik dan tidak bisa dihapus');
    }

    // Delete details first
    await trx('resep_dokter').where({ no_resep }).del();
    
    // Delete master
    await trx('resep_obat').where({ no_resep }).del();

    await trx.commit();
    return response.ok(res, { no_resep, message: 'Resep obat berhasil dihapus' });
  } catch (error) {
    await trx.rollback();
    logger.error('Delete Prescription Error:', error);
    return response.internalError(req, res, error, 'Gagal menghapus resep obat');
  }
};
