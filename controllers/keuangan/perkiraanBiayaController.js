const db = require('../../config/db');
const response = require('../../middleware/responseHandler');
const cache = require('../../utils/cache');

exports.getPerkiraanBiaya = async (req, res) => {
  try {
    let {
      page = 1,
      limit = 10,
      status_pulang = 'belum', // 'belum', 'pulang', or 'semua'
      tgl_keluar_start,
      tgl_keluar_end,
      kd_dokter,
      nm_bangsal,
      search,
    } = req.query;

    page = Number.parseInt(page, 10) || 1;
    limit = Number.parseInt(limit, 10) || 10;
    const offset = (page - 1) * limit;

    const conditions = ["reg_periksa.kd_pj = 'BPJ'"];
    const params = [];

    let joinDpjp = '';
    if (kd_dokter) {
      joinDpjp = ' INNER JOIN dpjp_ranap ON kamar_inap.no_rawat = dpjp_ranap.no_rawat';
      conditions.push('dpjp_ranap.kd_dokter = ?');
      params.push(kd_dokter);
    }

    if (status_pulang === 'belum') {
      conditions.push("kamar_inap.stts_pulang = '-'");
    } else if (status_pulang === 'pulang') {
      conditions.push("kamar_inap.stts_pulang <> '-'");
      if (tgl_keluar_start && tgl_keluar_end) {
        conditions.push('kamar_inap.tgl_keluar BETWEEN ? AND ?');
        params.push(tgl_keluar_start, tgl_keluar_end);
      }
    }

    if (nm_bangsal) {
      conditions.push('bangsal.nm_bangsal LIKE ?');
      params.push(`%${nm_bangsal}%`);
    }

    if (search) {
      conditions.push(`(
        kamar_inap.no_rawat LIKE ? OR 
        reg_periksa.no_rkm_medis LIKE ? OR 
        pasien.nm_pasien LIKE ?
      )`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(DISTINCT kamar_inap.no_rawat) AS total
      FROM kamar_inap
      INNER JOIN reg_periksa ON kamar_inap.no_rawat = reg_periksa.no_rawat
      INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
      INNER JOIN kamar ON kamar_inap.kd_kamar = kamar.kd_kamar
      INNER JOIN bangsal ON kamar.kd_bangsal = bangsal.kd_bangsal
      INNER JOIN penjab ON reg_periksa.kd_pj = penjab.kd_pj
      INNER JOIN dokter ON reg_periksa.kd_dokter = dokter.kd_dokter
      ${joinDpjp}
      ${whereClause}
    `;

    const [[{ total }]] = await db.query(countQuery, params);

    if (total === 0) {
      return response.noContent(res, 'Tidak ada data perkiraan biaya pasien');
    }

    const selectQuery = `
      SELECT DISTINCT
        kamar_inap.no_rawat,
        reg_periksa.no_rkm_medis,
        pasien.nm_pasien,
        bangsal.nm_bangsal,
        kamar.kd_kamar,
        reg_periksa.biaya_reg,
        kamar_inap.diagnosa_awal,
        kamar.kelas,
        penjab.png_jawab,
        penjab.kd_pj,
        dokter.nm_dokter AS dokter_reg,
        kamar_inap.tgl_keluar
      FROM kamar_inap
      INNER JOIN reg_periksa ON kamar_inap.no_rawat = reg_periksa.no_rawat
      INNER JOIN pasien ON reg_periksa.no_rkm_medis = pasien.no_rkm_medis
      INNER JOIN kamar ON kamar_inap.kd_kamar = kamar.kd_kamar
      INNER JOIN bangsal ON kamar.kd_bangsal = bangsal.kd_bangsal
      INNER JOIN penjab ON reg_periksa.kd_pj = penjab.kd_pj
      INNER JOIN dokter ON reg_periksa.kd_dokter = dokter.kd_dokter
      ${joinDpjp}
      ${whereClause}
      ORDER BY bangsal.nm_bangsal ASC
      LIMIT ? OFFSET ?
    `;

    const selectParams = [...params, limit, offset];
    const cacheKey = `perkiraan_biaya_bpjs_${JSON.stringify(req.query)}_${page}_${limit}`;

    const cachedResult = await cache.remember(
      cacheKey,
      async () => {
        const [rows] = await db.query(selectQuery, selectParams);
        if (rows.length === 0) return null;

        const noRawatList = rows.map((r) => r.no_rawat);

        // Fetch DPJP doctors and clinical ICD-10 diagnoses for all patients on the current page in one query
        const [[dpjps], [diagnosaPasien]] = await Promise.all([
          db.query(
            `
            SELECT dr.no_rawat, d.nm_dokter 
            FROM dpjp_ranap dr 
            INNER JOIN dokter d ON dr.kd_dokter = d.kd_dokter 
            WHERE dr.no_rawat IN (?)
          `,
            [noRawatList]
          ),
          db.query(
            `
            SELECT dp.no_rawat, dp.kd_penyakit, p.nm_penyakit
            FROM diagnosa_pasien dp
            INNER JOIN penyakit p ON dp.kd_penyakit = p.kd_penyakit
            WHERE dp.no_rawat IN (?)
            ORDER BY dp.prioritas ASC
          `,
            [noRawatList]
          )
        ]);

        const dpjpMap = {};
        for (const item of dpjps) {
          if (!dpjpMap[item.no_rawat]) {
            dpjpMap[item.no_rawat] = [];
          }
          dpjpMap[item.no_rawat].push(item.nm_dokter);
        }

        const diagnosaPasienMap = {};
        for (const item of diagnosaPasien) {
          if (!diagnosaPasienMap[item.no_rawat]) {
            diagnosaPasienMap[item.no_rawat] = [];
          }
          diagnosaPasienMap[item.no_rawat].push(`${item.kd_penyakit} - ${item.nm_penyakit}`);
        }

        const detailPromises = rows.map(async (row) => {
          const detailQuery = `
            SELECT 
              -- BHP
              (
                SELECT COALESCE(SUM(bhp), 0) FROM rawat_jl_pr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(bhp), 0) FROM rawat_jl_dr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(bhp), 0) FROM rawat_jl_drpr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(bhp), 0) FROM rawat_inap_pr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(bhp), 0) FROM rawat_inap_dr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(bhp), 0) FROM rawat_inap_drpr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya LIKE '%OKSIGEN%'
              ) AS bhp,

              -- Kamar & Harian
              (
                SELECT COALESCE(SUM(ttl_biaya), 0) FROM kamar_inap WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(biaya_sekali.besar_biaya), 0) 
                FROM biaya_sekali 
                INNER JOIN kamar_inap ON kamar_inap.kd_kamar = biaya_sekali.kd_kamar 
                WHERE kamar_inap.no_rawat = ?
              ) AS kamar,

              (
                SELECT COALESCE(SUM(biaya_harian.jml * biaya_harian.besar_biaya * kamar_inap.lama), 0) 
                FROM kamar_inap 
                INNER JOIN biaya_harian ON kamar_inap.kd_kamar = biaya_harian.kd_kamar 
                WHERE kamar_inap.no_rawat = ?
              ) AS harian,

              -- Rumah Sakit
              (
                SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_jl_pr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_jl_dr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_jl_drpr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_inap_pr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_inap_dr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(material + menejemen), 0) FROM rawat_inap_drpr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(biayaalat + biayasewaok + akomodasi + bagian_rs + biayasarpras), 0) FROM operasi WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya NOT LIKE '%OKSIGEN%' AND nama_biaya NOT LIKE '%LAB%' AND nama_biaya NOT LIKE '%RAD%'
              ) AS rumahsakit,

              -- Jasa
              (
                SELECT COALESCE(SUM(tarif_tindakanpr), 0) FROM rawat_jl_pr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(tarif_tindakandr), 0) FROM rawat_jl_dr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(tarif_tindakanpr + tarif_tindakandr), 0) FROM rawat_jl_drpr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(tarif_tindakanpr), 0) FROM rawat_inap_pr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(tarif_tindakandr), 0) FROM rawat_inap_dr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(tarif_tindakanpr + tarif_tindakandr), 0) FROM rawat_inap_drpr WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(biayaoperator1 + biayaoperator2 + biayaoperator3 + biayaasisten_operator1 + biayaasisten_operator2 + biayaasisten_operator3 + biayainstrumen + biayadokter_anak + biayaperawaat_resusitas + biayadokter_anestesi + biayaasisten_anestesi + biayaasisten_anestesi2 + biayabidan + biayabidan2 + biayabidan3 + biayaperawat_luar + biaya_omloop + biaya_omloop2 + biaya_omloop3 + biaya_omloop4 + biaya_omloop5 + biaya_dokter_pjanak + biaya_dokter_umum), 0) FROM operasi WHERE no_rawat = ?
              ) AS jasa,

              -- Laborat
              (
                SELECT COALESCE(SUM(biaya), 0) FROM periksa_lab WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(biaya_item), 0) FROM detail_periksa_lab WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya LIKE '%LAB%'
              ) AS laborat,

              -- Radiologi
              (
                SELECT COALESCE(SUM(biaya), 0) FROM periksa_radiologi WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(besar_biaya), 0) FROM tambahan_biaya WHERE no_rawat = ? AND nama_biaya LIKE '%RAD%'
              ) AS radiologi,

              -- Obat
              (
                SELECT COALESCE(SUM(total), 0) FROM detail_pemberian_obat WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(besar_tagihan), 0) FROM tagihan_obat_langsung WHERE no_rawat = ?
              ) + (
                SELECT COALESCE(SUM(hargasatuan * jumlah), 0) FROM beri_obat_operasi WHERE no_rawat = ?
              ) AS obat,

              -- Retur Obat
              (
                SELECT COALESCE(SUM(subtotal), 0) FROM detreturjual WHERE no_retur_jual LIKE CONCAT('%', ?, '%')
              ) AS retur_obat,

              -- Resep Pulang
              (
                SELECT COALESCE(SUM(total), 0) FROM resep_pulang WHERE no_rawat = ?
              ) AS resep_pulang,

              -- Potongan
              (
                SELECT COALESCE(SUM(besar_pengurangan), 0) FROM pengurangan_biaya WHERE no_rawat = ?
              ) AS potongan,

              -- Perkiraan Biaya (Tarif & Penyakit)
              (
                SELECT COALESCE(MAX(tarif), 0) FROM perkiraan_biaya_ranap WHERE no_rawat = ?
              ) AS perkiraan_tarif,

              (
                SELECT GROUP_CONCAT(kd_penyakit SEPARATOR ', ') FROM perkiraan_biaya_ranap WHERE no_rawat = ?
              ) AS kd_penyakit,

              (
                SELECT GROUP_CONCAT(p.nm_penyakit SEPARATOR ', ') 
                FROM perkiraan_biaya_ranap pbr
                INNER JOIN penyakit p ON pbr.kd_penyakit = p.kd_penyakit
                WHERE pbr.no_rawat = ?
              ) AS nm_penyakit_ina
          `;

          const detailParams = Array(39).fill(row.no_rawat);
          const [detailRows] = await db.query(detailQuery, detailParams);
          const detail = detailRows[0] || {};

          const bhp = Number(detail.bhp) || 0;
          const registrasi = Number(row.biaya_reg) || 0;
          const kamar = Number(detail.kamar) || 0;
          const harian = Number(detail.harian) || 0;
          const rumahsakit = Number(detail.rumahsakit) || 0;
          const jasa = Number(detail.jasa) || 0;

          const laborat = Number(detail.laborat) || 0;
          const radiologi = Number(detail.radiologi) || 0;
          const obat = Number(detail.obat) || 0;
          const retur_obat = Number(detail.retur_obat) || 0;
          const resep_pulang = Number(detail.resep_pulang) || 0;
          const potongan = Number(detail.potongan) || 0;
          const perkiraan_tarif = Number(detail.perkiraan_tarif) || 0;
          const kd_penyakit = detail.kd_penyakit || '';
          const nm_penyakit_ina = detail.nm_penyakit_ina || '';

          const jumlah_rs = bhp + registrasi + kamar + harian + rumahsakit;
          const jumlah_penunjang = laborat + radiologi + obat + resep_pulang - retur_obat;
          const total_biaya = jumlah_rs + jasa + jumlah_penunjang + potongan;

          let persentase = 0;
          let persentase_rs = 0;
          let persentase_jasa = 0;
          let persentase_penunjang = 0;

          if (perkiraan_tarif > 0) {
            persentase = ((perkiraan_tarif - total_biaya) / perkiraan_tarif) * 100;
            persentase_rs = (jumlah_rs / perkiraan_tarif) * 100;
            persentase_jasa = (jasa / perkiraan_tarif) * 100;
            persentase_penunjang = (jumlah_penunjang / perkiraan_tarif) * 100;
          }

          const status_keamanan = (perkiraan_tarif > 0 && perkiraan_tarif <= total_biaya) ? 'Tidak Aman' : 'Aman';

          const list_dpjp = dpjpMap[row.no_rawat] || [];
          const all_doctors = [row.dokter_reg, ...list_dpjp].filter(Boolean);
          const dokter_ranap = [...new Set(all_doctors)].join(', ');

          return {
            no_rawat: row.no_rawat,
            no_rkm_medis: row.no_rkm_medis,
            nm_pasien: row.nm_pasien,
            nm_bangsal: row.nm_bangsal,
            kd_kamar: row.kd_kamar,
            kelas: row.kelas,
            tgl_keluar: row.tgl_keluar,
            png_jawab: row.png_jawab,
            kd_pj: row.kd_pj,
            dokter_ranap,
            diagnosa_icd: diagnosaPasienMap[row.no_rawat] || [],
            diagnosa_ina: kd_penyakit ? `${kd_penyakit} - ${nm_penyakit_ina}` : '',
            cost_details: {
              bhp,
              registrasi,
              kamar,
              harian,
              rumahsakit,
              jasa,
              laborat,
              radiologi,
              obat,
              retur_obat,
              resep_pulang,
              potongan,
              jumlah_rs,
              jumlah_penunjang,
              total_biaya,
              perkiraan_tarif,
              kd_penyakit,
              selisih: perkiraan_tarif - total_biaya,
              status_keamanan,
              persentase: Number(persentase.toFixed(2)),
              persentase_rs: Number(persentase_rs.toFixed(2)),
              persentase_jasa: Number(persentase_jasa.toFixed(2)),
              persentase_penunjang: Number(persentase_penunjang.toFixed(2)),
            }
          };
        });

        return await Promise.all(detailPromises);
      },
      5
    );

    if (!cachedResult || cachedResult.length === 0) {
      return response.noContent(res, 'Tidak ada data perkiraan biaya pasien');
    }

    // Calculate Summary/Total for the current page
    let total_bhp = 0;
    let total_registrasi_kamar_harian_rs = 0;
    let total_jasa = 0;
    let total_penunjang = 0;
    let total_potongan = 0;
    let total_rs = 0;
    let total_all = 0;
    let total_perkiraan = 0;
    let total_selisih = 0;

    let sum_persentasers = 0;
    let sum_persentasejasa = 0;
    let sum_persentasepenunjang = 0;

    for (const item of cachedResult) {
      total_bhp += item.cost_details.bhp;
      total_registrasi_kamar_harian_rs += item.cost_details.registrasi + item.cost_details.kamar + item.cost_details.harian + item.cost_details.rumahsakit;
      total_jasa += item.cost_details.jasa;
      total_penunjang += item.cost_details.jumlah_penunjang;
      total_potongan += item.cost_details.potongan;
      total_rs += item.cost_details.jumlah_rs;
      total_all += item.cost_details.total_biaya;
      total_perkiraan += item.cost_details.perkiraan_tarif;
      total_selisih += item.cost_details.selisih;

      sum_persentasers += item.cost_details.persentase_rs;
      sum_persentasejasa += item.cost_details.persentase_jasa;
      sum_persentasepenunjang += item.cost_details.persentase_penunjang;
    }

    const n = cachedResult.length || 1;
    const summary = {
      total_bhp,
      total_registrasi_kamar_harian_rs,
      total_jasa,
      total_penunjang,
      total_potongan,
      total_rs,
      total_all,
      total_perkiraan,
      total_selisih,
      avg_persentase_rs: Number((sum_persentasers / n).toFixed(2)),
      avg_persentase_jasa: Number((sum_persentasejasa / n).toFixed(2)),
      avg_persentase_penunjang: Number((sum_persentasepenunjang / n).toFixed(2)),
    };

    const pagination = {
      currentPage: page,
      perPage: limit,
      total,
      lastPage: Math.ceil(total / limit),
    };

    return response.okPagination(res, cachedResult, pagination, 'Berhasil menampilkan perkiraan biaya pasien', { summary });
  } catch (error) {
    return response.internalError(req, res, error, 'Gagal menampilkan perkiraan biaya pasien');
  }
};
