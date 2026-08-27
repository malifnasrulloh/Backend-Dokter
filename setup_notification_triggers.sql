-- =============================================================
-- NOTIFICATION QUEUE SETUP + ALL TRIGGERS for E-Dokter
-- =============================================================
-- Schema name is a {{DB_NAME}} token replaced at install time by
-- scripts/install_triggers.js (no hardcoded DB names).
-- Full 52-trigger event set (all sections A-G), idempotent
-- (DROP IF EXISTS before CREATE).
-- A1 additionally detects IGD via the patient's poli name so the
-- emergency_igd_consultation event keeps working now that
-- jenis_permintaan is a fixed ENUM of consultation types.
-- =============================================================

-- ──────────────────────────────────────────────────────────────
-- ALL TRIGGERS use DELIMITER for BEGIN...END consistency
-- ──────────────────────────────────────────────────────────────
DELIMITER //

-- ==============================================================
-- A. EXISTING TRIGGERS (recreated with source_table, source_pk)
-- ==============================================================

-- ──────────────────────────────────────────────────────────────
-- A1. konsultasi_medik → consultation_request / emergency_igd
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_konsultasi_medik//

CREATE TRIGGER trg_notify_konsultasi_medik
AFTER INSERT ON konsultasi_medik
FOR EACH ROW
BEGIN
  DECLARE v_title VARCHAR(255);
  DECLARE v_body TEXT;
  DECLARE v_event_type VARCHAR(50);
  DECLARE v_nm_dokter VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nm_dokter, 'System') INTO v_nm_dokter
  FROM dokter WHERE kd_dokter = NEW.kd_dokter LIMIT 1;

  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp
  LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  IF NEW.jenis_permintaan IN ('IGD','EMERGENCY')
     OR EXISTS (
       SELECT 1 FROM reg_periksa rp
       JOIN poliklinik pl ON rp.kd_poli = pl.kd_poli
       WHERE rp.no_rawat = NEW.no_rawat
         AND (UPPER(pl.nm_poli) LIKE '%IGD%' OR UPPER(pl.nm_poli) LIKE '%GAWAT DARURAT%')
     ) THEN
    SET v_event_type = 'emergency_igd_consultation';
    SET v_title = 'URGENT: KONSUL IGD';
    SET v_body = CONCAT('Permintaan konsultasi segera dari ', v_nm_dokter, ' untuk pasien ', v_nm_pasien);
  ELSE
    SET v_event_type = 'consultation_request';
    SET v_title = 'Konsultasi Baru';
    SET v_body = CONCAT('Permintaan konsultasi dari ', v_nm_dokter, ': "', COALESCE(NEW.diagnosa_kerja, ''), '"');
  END IF;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter_dikonsuli, v_event_type, v_title, v_body,
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'no_rawat', NEW.no_rawat,
                'nm_dokter_pemberi', v_nm_dokter, 'diagnosa_kerja', NEW.diagnosa_kerja,
                'uraian_konsultasi', NEW.uraian_konsultasi, 'nm_pasien', v_nm_pasien),
    NOW(3), 'konsultasi_medik', NEW.no_permintaan
  );
END//

-- ──────────────────────────────────────────────────────────────
-- A1d. konsultasi_medik → soft-delete notifications
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_del_konsultasi_medik//

CREATE TRIGGER trg_notify_del_konsultasi_medik
AFTER DELETE ON konsultasi_medik
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'konsultasi_medik'
    AND source_pk = OLD.no_permintaan
    AND deleted_at IS NULL;
END//

-- ──────────────────────────────────────────────────────────────
-- A2. konsultasi_perawat → sbar_request
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_konsultasi_perawat//

CREATE TRIGGER trg_notify_konsultasi_perawat
AFTER INSERT ON konsultasi_perawat
FOR EACH ROW
BEGIN
  DECLARE v_nama_petugas VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nama, 'Perawat') INTO v_nama_petugas
  FROM pegawai WHERE nik = NEW.nip LIMIT 1;

  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp
  LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter_dikonsuli, 'sbar_request', 'Permintaan SBAR Baru',
    CONCAT('S: ', COALESCE(NEW.situation, ''), '\nB: ', COALESCE(NEW.background, ''), '\nA: ', COALESCE(NEW.assessment, ''), '\nR: ', COALESCE(NEW.recomendation, '')),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'no_rawat', NEW.no_rawat,
                'nama_petugas', v_nama_petugas,
                'situation', NEW.situation, 'background', NEW.background,
                'assessment', NEW.assessment, 'recomendation', NEW.recomendation,
                'nm_pasien', v_nm_pasien),
    NOW(3), 'konsultasi_perawat', NEW.no_permintaan
  );
END//

-- ──────────────────────────────────────────────────────────────
-- A2d. konsultasi_perawat → soft-delete
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_del_konsultasi_perawat//

CREATE TRIGGER trg_notify_del_konsultasi_perawat
AFTER DELETE ON konsultasi_perawat
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'konsultasi_perawat'
    AND source_pk = OLD.no_permintaan
    AND deleted_at IS NULL;
END//

-- ──────────────────────────────────────────────────────────────
-- A3. jawaban_konsultasi_medik → consultation_response
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_jawaban_konsultasi_medik//

CREATE TRIGGER trg_notify_jawaban_konsultasi_medik
AFTER INSERT ON jawaban_konsultasi_medik
FOR EACH ROW
BEGIN
  DECLARE v_kd_peminta VARCHAR(20);
  DECLARE v_nm_dokter VARCHAR(100);

  SELECT kd_dokter INTO v_kd_peminta FROM konsultasi_medik WHERE no_permintaan = NEW.no_permintaan LIMIT 1;
  SELECT COALESCE(d.nm_dokter, 'Rekan Dokter') INTO v_nm_dokter
  FROM konsultasi_medik km
  LEFT JOIN dokter d ON km.kd_dokter_dikonsuli = d.kd_dokter
  WHERE km.no_permintaan = NEW.no_permintaan LIMIT 1;

  IF v_kd_peminta IS NOT NULL THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (v_kd_peminta, 'consultation_response', 'Konsultasi Dijawab',
      CONCAT('Balasan dari ', v_nm_dokter, ' untuk permintaan ', NEW.no_permintaan),
      JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'nm_dokter_dikonsuli', v_nm_dokter),
      NOW(3), 'jawaban_konsultasi_medik', NEW.no_permintaan);
  END IF;
END//

-- ──────────────────────────────────────────────────────────────
-- A3d. jawaban_konsultasi_medik → soft-delete
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_del_jawaban_konsultasi_medik//

CREATE TRIGGER trg_notify_del_jawaban_konsultasi_medik
AFTER DELETE ON jawaban_konsultasi_medik
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'jawaban_konsultasi_medik'
    AND source_pk = OLD.no_permintaan
    AND deleted_at IS NULL;
END//

-- ──────────────────────────────────────────────────────────────
-- A4. reg_periksa → new_admission
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_reg_periksa//

CREATE TRIGGER trg_notify_reg_periksa
AFTER INSERT ON reg_periksa
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(nm_pasien, 'Pasien Baru') INTO v_nm_pasien
  FROM pasien WHERE no_rkm_medis = NEW.no_rkm_medis LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (NEW.kd_dokter, 'new_admission', 'Pasien Baru Terdaftar',
    CONCAT('Anda telah didelegasikan sebagai DPJP untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien),
    NOW(3), 'reg_periksa', NEW.no_rawat);
END//

-- ──────────────────────────────────────────────────────────────
-- A4d. reg_periksa → soft-delete
-- ──────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_del_reg_periksa//

CREATE TRIGGER trg_notify_del_reg_periksa
AFTER DELETE ON reg_periksa
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'reg_periksa'
    AND source_pk = OLD.no_rawat
    AND deleted_at IS NULL;
END//

-- ==============================================================
-- B. LABORATORY REQUESTS (dokter-perujuk routed)
-- ==============================================================

-- B1. permintaan_lab → lab_request ────────────────────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_lab//

CREATE TRIGGER trg_notify_permintaan_lab
AFTER INSERT ON permintaan_lab
FOR EACH ROW
BEGIN
  DECLARE v_nm_dokter VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nm_dokter, '') INTO v_nm_dokter FROM dokter WHERE kd_dokter = NEW.dokter_perujuk LIMIT 1;
  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  SELECT
    pj.kd_dokterlab, 'lab_request', 'Permintaan Laboratorium Baru',
    CONCAT('Permintaan lab untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT('noorder', NEW.noorder, 'no_rawat', NEW.no_rawat,
                'nm_dokter', v_nm_dokter, 'nm_pasien', v_nm_pasien,
                'diagnosa_klinis', NEW.diagnosa_klinis),
    NOW(3), 'permintaan_lab', NEW.noorder
  FROM set_pjlab pj
  LIMIT 1;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_lab//

CREATE TRIGGER trg_notify_del_permintaan_lab
AFTER DELETE ON permintaan_lab
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_lab' AND source_pk = OLD.noorder AND deleted_at IS NULL;
END//

-- B2. permintaan_labpa → labpa_request ────────────────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_labpa//

CREATE TRIGGER trg_notify_permintaan_labpa
AFTER INSERT ON permintaan_labpa
FOR EACH ROW
BEGIN
  DECLARE v_nm_dokter VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nm_dokter, '') INTO v_nm_dokter FROM dokter WHERE kd_dokter = NEW.dokter_perujuk LIMIT 1;
  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  SELECT
    pj.kd_dokterlabpa, 'labpa_request', 'Permintaan PA Baru',
    CONCAT('Permintaan Patologi Anatomi untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT('noorder', NEW.noorder, 'no_rawat', NEW.no_rawat,
                'nm_dokter', v_nm_dokter, 'nm_pasien', v_nm_pasien),
    NOW(3), 'permintaan_labpa', NEW.noorder
  FROM set_pjlab pj
  LIMIT 1;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_labpa//

CREATE TRIGGER trg_notify_del_permintaan_labpa
AFTER DELETE ON permintaan_labpa
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_labpa' AND source_pk = OLD.noorder AND deleted_at IS NULL;
END//

-- B3. permintaan_labmb → labmb_request ────────────────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_labmb//

CREATE TRIGGER trg_notify_permintaan_labmb
AFTER INSERT ON permintaan_labmb
FOR EACH ROW
BEGIN
  DECLARE v_nm_dokter VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nm_dokter, '') INTO v_nm_dokter FROM dokter WHERE kd_dokter = NEW.dokter_perujuk LIMIT 1;
  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  SELECT
    pj.kd_dokterlabmb, 'labmb_request', 'Permintaan Lab MB Baru',
    CONCAT('Permintaan laboratorium molekuler untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT('noorder', NEW.noorder, 'no_rawat', NEW.no_rawat,
                'nm_dokter', v_nm_dokter, 'nm_pasien', v_nm_pasien),
    NOW(3), 'permintaan_labmb', NEW.noorder
  FROM set_pjlab pj
  LIMIT 1;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_labmb//

CREATE TRIGGER trg_notify_del_permintaan_labmb
AFTER DELETE ON permintaan_labmb
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_labmb' AND source_pk = OLD.noorder AND deleted_at IS NULL;
END//

-- ==============================================================
-- C. RADIOLOGY REQUESTS
-- ==============================================================

-- C1. permintaan_radiologi → radiology_request ────────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_radiologi//

CREATE TRIGGER trg_notify_permintaan_radiologi
AFTER INSERT ON permintaan_radiologi
FOR EACH ROW
BEGIN
  DECLARE v_nm_dokter VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nm_dokter, '') INTO v_nm_dokter FROM dokter WHERE kd_dokter = NEW.dokter_perujuk LIMIT 1;
  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  SELECT
    pj.kd_dokterrad, 'radiology_request', 'Permintaan Radiologi Baru',
    CONCAT('Permintaan radiologi untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT('noorder', NEW.noorder, 'no_rawat', NEW.no_rawat,
                'nm_dokter', v_nm_dokter, 'nm_pasien', v_nm_pasien,
                'diagnosa_klinis', NEW.diagnosa_klinis),
    NOW(3), 'permintaan_radiologi', NEW.noorder
  FROM set_pjlab pj
  LIMIT 1;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_radiologi//

CREATE TRIGGER trg_notify_del_permintaan_radiologi
AFTER DELETE ON permintaan_radiologi
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_radiologi' AND source_pk = OLD.noorder AND deleted_at IS NULL;
END//

-- ==============================================================
-- D. PRESCRIPTION & MEDICATION
-- ==============================================================

-- D1. permintaan_resep_pulang → discharge_prescription ────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_resep_pulang//

CREATE TRIGGER trg_notify_permintaan_resep_pulang
AFTER INSERT ON permintaan_resep_pulang
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter, 'discharge_prescription', 'Resep Pulang Baru',
    CONCAT('Resep pulang untuk ', v_nm_pasien, ' (', NEW.no_permintaan, ')'),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'no_rawat', NEW.no_rawat,
                'nm_pasien', v_nm_pasien, 'status', NEW.status),
    NOW(3), 'permintaan_resep_pulang', NEW.no_permintaan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_upd_permintaan_resep_pulang//

CREATE TRIGGER trg_notify_upd_permintaan_resep_pulang
AFTER UPDATE ON permintaan_resep_pulang
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (
      NEW.kd_dokter,
      CASE WHEN NEW.status = 'Sudah' THEN 'prescription_dispensed' ELSE 'prescription_updated' END,
      CASE WHEN NEW.status = 'Sudah' THEN 'Resep Telah Dilayani' ELSE 'Status Resep Berubah' END,
      CONCAT('Resep pulang ', NEW.no_permintaan, ': ', NEW.status),
      JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'status', NEW.status),
      NOW(3), 'permintaan_resep_pulang', NEW.no_permintaan
    );
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_resep_pulang//

CREATE TRIGGER trg_notify_del_permintaan_resep_pulang
AFTER DELETE ON permintaan_resep_pulang
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_resep_pulang' AND source_pk = OLD.no_permintaan AND deleted_at IS NULL;
END//

-- D2. permintaan_stok_obat_pasien → medication_stock_request ──
DROP TRIGGER IF EXISTS trg_notify_permintaan_stok_obat_pasien//

CREATE TRIGGER trg_notify_permintaan_stok_obat_pasien
AFTER INSERT ON permintaan_stok_obat_pasien
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter, 'medication_stock_request', 'Stok Obat Pasien',
    CONCAT('Permintaan stok obat untuk ', v_nm_pasien, ' (', NEW.no_permintaan, ')'),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'no_rawat', NEW.no_rawat,
                'nm_pasien', v_nm_pasien, 'status', NEW.status),
    NOW(3), 'permintaan_stok_obat_pasien', NEW.no_permintaan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_upd_permintaan_stok_obat_pasien//

CREATE TRIGGER trg_notify_upd_permintaan_stok_obat_pasien
AFTER UPDATE ON permintaan_stok_obat_pasien
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (
      NEW.kd_dokter,
      CASE WHEN NEW.status = 'Sudah' THEN 'medication_dispensed' ELSE 'medication_stock_updated' END,
      CASE WHEN NEW.status = 'Sudah' THEN 'Stok Obat Tersedia' ELSE 'Status Stok Obat Berubah' END,
      CONCAT('Stok obat ', NEW.no_permintaan, ': ', NEW.status),
      JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'status', NEW.status),
      NOW(3), 'permintaan_stok_obat_pasien', NEW.no_permintaan
    );
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_stok_obat_pasien//

CREATE TRIGGER trg_notify_del_permintaan_stok_obat_pasien
AFTER DELETE ON permintaan_stok_obat_pasien
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_stok_obat_pasien' AND source_pk = OLD.no_permintaan AND deleted_at IS NULL;
END//

-- ==============================================================
-- E. PATIENT SERVICE REQUESTS
-- ==============================================================

-- E1. permintaan_binrohtal → spiritual_guidance_request ───────
DROP TRIGGER IF EXISTS trg_notify_permintaan_binrohtal//

CREATE TRIGGER trg_notify_permintaan_binrohtal
AFTER INSERT ON permintaan_binrohtal
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter, 'spiritual_guidance_request', 'Bimbingan Rohani',
    CONCAT('Bimbingan rohani untuk ', v_nm_pasien, ' (', NEW.no_rawat, ') — ', COALESCE(NEW.jns_pelayanan, '')),
    JSON_OBJECT('no_surat', NEW.no_surat, 'no_rawat', NEW.no_rawat,
                'nm_pasien', v_nm_pasien, 'jns_pelayanan', NEW.jns_pelayanan,
                'nip_petugas', NEW.nip),
    NOW(3), 'permintaan_binrohtal', NEW.no_surat
  );
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_binrohtal//

CREATE TRIGGER trg_notify_del_permintaan_binrohtal
AFTER DELETE ON permintaan_binrohtal
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_binrohtal' AND source_pk = OLD.no_surat AND deleted_at IS NULL;
END//

-- E2. surat_permintaan_second_opinion → second_opinion_request ─
DROP TRIGGER IF EXISTS trg_notify_surat_permintaan_second_opinion//

CREATE TRIGGER trg_notify_surat_permintaan_second_opinion
AFTER INSERT ON surat_permintaan_second_opinion
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter, 'second_opinion_request', 'Second Opinion',
    CONCAT('Second opinion untuk ', v_nm_pasien, ' oleh ', COALESCE(NEW.pembuat_pernyataan, '')),
    JSON_OBJECT('no_pernyataan', NEW.no_pernyataan, 'no_rawat', NEW.no_rawat,
                'nm_pasien', v_nm_pasien, 'pembuat_pernyataan', NEW.pembuat_pernyataan),
    NOW(3), 'surat_permintaan_second_opinion', NEW.no_pernyataan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_del_surat_permintaan_second_opinion//

CREATE TRIGGER trg_notify_del_surat_permintaan_second_opinion
AFTER DELETE ON surat_permintaan_second_opinion
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'surat_permintaan_second_opinion' AND source_pk = OLD.no_pernyataan AND deleted_at IS NULL;
END//

-- E3. booking_operasi → surgery_booking ────────────────────────
DROP TRIGGER IF EXISTS trg_notify_booking_operasi//

CREATE TRIGGER trg_notify_booking_operasi
AFTER INSERT ON booking_operasi
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter, 'surgery_booking', 'Booking Operasi Baru',
    CONCAT('Booking operasi untuk ', v_nm_pasien, ' pada ', COALESCE(NEW.tanggal, '')),
    JSON_OBJECT('no_rawat', NEW.no_rawat, 'kode_paket', NEW.kode_paket,
                'tanggal', NEW.tanggal, 'jam_mulai', NEW.jam_mulai,
                'kd_ruang_ok', NEW.kd_ruang_ok, 'nm_pasien', v_nm_pasien),
    NOW(3), 'booking_operasi', CONCAT(NEW.no_rawat, '-', NEW.kode_paket, '-', COALESCE(NEW.tanggal, ''))
  );
END//

DROP TRIGGER IF EXISTS trg_notify_del_booking_operasi//

CREATE TRIGGER trg_notify_del_booking_operasi
AFTER DELETE ON booking_operasi
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'booking_operasi'
    AND source_pk = CONCAT(OLD.no_rawat, '-', OLD.kode_paket, '-', COALESCE(OLD.tanggal, ''))
    AND deleted_at IS NULL;
END//

-- E4. permintaan_ranap → bed_request ───────────────────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_ranap//

CREATE TRIGGER trg_notify_permintaan_ranap
AFTER INSERT ON permintaan_ranap
FOR EACH ROW
BEGIN
  DECLARE v_kd_dokter VARCHAR(20);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT rp.kd_dokter, COALESCE(p.nm_pasien, 'Pasien')
    INTO v_kd_dokter, v_nm_pasien
  FROM reg_periksa rp
  LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  IF v_kd_dokter IS NOT NULL THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (v_kd_dokter, 'bed_request', 'Permintaan Rawat Inap',
      CONCAT('Permintaan ranap untuk ', v_nm_pasien, ' (', NEW.no_rawat, ') — ', COALESCE(NEW.diagnosa, '')),
      JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien,
                  'kd_kamar', NEW.kd_kamar, 'diagnosa', NEW.diagnosa),
      NOW(3), 'permintaan_ranap', NEW.no_rawat);
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_ranap//

CREATE TRIGGER trg_notify_del_permintaan_ranap
AFTER DELETE ON permintaan_ranap
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_ranap' AND source_pk = OLD.no_rawat AND deleted_at IS NULL;
END//

-- E5. permintaan_obat → medication_request ─────────────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_obat//

CREATE TRIGGER trg_notify_permintaan_obat
AFTER INSERT ON permintaan_obat
FOR EACH ROW
BEGIN
  DECLARE v_kd_dokter VARCHAR(20);
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT rp.kd_dokter, COALESCE(p.nm_pasien, 'Pasien')
    INTO v_kd_dokter, v_nm_pasien
  FROM reg_periksa rp
  LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  IF v_kd_dokter IS NOT NULL THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (v_kd_dokter, 'medication_request', 'Permintaan Obat',
      CONCAT('Permintaan obat untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
      JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien,
                  'kode_brng', NEW.kode_brng),
      NOW(3), 'permintaan_obat', CONCAT(NEW.tanggal, '-', NEW.jam, '-', NEW.no_rawat, '-', NEW.kode_brng));
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_obat//

CREATE TRIGGER trg_notify_del_permintaan_obat
AFTER DELETE ON permintaan_obat
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_obat'
    AND source_pk = CONCAT(OLD.tanggal, '-', OLD.jam, '-', OLD.no_rawat, '-', OLD.kode_brng)
    AND deleted_at IS NULL;
END//

-- ==============================================================
-- F. EMPLOYEE / SUPPLY REQUESTS (nip/nik routed)
-- ==============================================================

-- F1. permintaan_dapur → kitchen_request (INSERT) ──────────────
DROP TRIGGER IF EXISTS trg_notify_permintaan_dapur//

CREATE TRIGGER trg_notify_permintaan_dapur
AFTER INSERT ON permintaan_dapur
FOR EACH ROW
BEGIN
  DECLARE v_nama VARCHAR(100);
  SELECT COALESCE(nama, 'Pegawai') INTO v_nama FROM pegawai WHERE nik = NEW.nip LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.nip, 'kitchen_request', 'Permintaan Dapur Baru',
    CONCAT('Permintaan dapur oleh ', v_nama, ' (', NEW.no_permintaan, ')'),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'nama_pegawai', v_nama,
                'status', NEW.status),
    NOW(3), 'permintaan_dapur', NEW.no_permintaan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_upd_permintaan_dapur//

CREATE TRIGGER trg_notify_upd_permintaan_dapur
AFTER UPDATE ON permintaan_dapur
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    SELECT
      NEW.nip,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'kitchen_approved'
        WHEN NEW.status = 'Tidak Disetujui' THEN 'kitchen_rejected'
        ELSE 'kitchen_updated'
      END,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'Permintaan Dapur Disetujui'
        WHEN NEW.status = 'Tidak Disetujui' THEN 'Permintaan Dapur Ditolak'
        ELSE 'Status Dapur Berubah'
      END,
      CONCAT('Permintaan dapur ', NEW.no_permintaan, ': ', NEW.status),
      JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'status', NEW.status),
      NOW(3), 'permintaan_dapur', NEW.no_permintaan
    FROM pegawai pw WHERE pw.nik = NEW.nip;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_dapur//

CREATE TRIGGER trg_notify_del_permintaan_dapur
AFTER DELETE ON permintaan_dapur
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_dapur' AND source_pk = OLD.no_permintaan AND deleted_at IS NULL;
END//

-- F2. permintaan_medis → medical_supply_request (INSERT) ──────
DROP TRIGGER IF EXISTS trg_notify_permintaan_medis//

CREATE TRIGGER trg_notify_permintaan_medis
AFTER INSERT ON permintaan_medis
FOR EACH ROW
BEGIN
  DECLARE v_nama VARCHAR(100);
  SELECT COALESCE(nama, 'Pegawai') INTO v_nama FROM pegawai WHERE nik = NEW.nip LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.nip, 'medical_supply_request', 'Barang Medis',
    CONCAT('Permintaan barang medis oleh ', v_nama, ' (', NEW.no_permintaan, ')'),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'nama_pegawai', v_nama,
                'status', NEW.status),
    NOW(3), 'permintaan_medis', NEW.no_permintaan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_upd_permintaan_medis//

CREATE TRIGGER trg_notify_upd_permintaan_medis
AFTER UPDATE ON permintaan_medis
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    SELECT
      NEW.nip,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'medical_supply_approved'
        WHEN NEW.status = 'Tidak Disetujui' THEN 'medical_supply_rejected'
        ELSE 'medical_supply_updated'
      END,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'Barang Medis Disetujui'
        WHEN NEW.status = 'Tidak Disetujui' THEN 'Barang Medis Ditolak'
        ELSE 'Status Barang Medis Berubah'
      END,
      CONCAT('Permintaan barang medis ', NEW.no_permintaan, ': ', NEW.status),
      JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'status', NEW.status),
      NOW(3), 'permintaan_medis', NEW.no_permintaan
    FROM pegawai pw WHERE pw.nik = NEW.nip;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_medis//

CREATE TRIGGER trg_notify_del_permintaan_medis
AFTER DELETE ON permintaan_medis
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_medis' AND source_pk = OLD.no_permintaan AND deleted_at IS NULL;
END//

-- F3. permintaan_non_medis → non_medical_request (INSERT) ─────
DROP TRIGGER IF EXISTS trg_notify_permintaan_non_medis//

CREATE TRIGGER trg_notify_permintaan_non_medis
AFTER INSERT ON permintaan_non_medis
FOR EACH ROW
BEGIN
  DECLARE v_nama VARCHAR(100);
  SELECT COALESCE(nama, 'Pegawai') INTO v_nama FROM pegawai WHERE nik = NEW.nip LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.nip, 'non_medical_request', 'Non Medis',
    CONCAT('Permintaan non medis oleh ', v_nama, ' (', NEW.no_permintaan, ')'),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'nama_pegawai', v_nama,
                'status', NEW.status),
    NOW(3), 'permintaan_non_medis', NEW.no_permintaan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_upd_permintaan_non_medis//

CREATE TRIGGER trg_notify_upd_permintaan_non_medis
AFTER UPDATE ON permintaan_non_medis
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    SELECT
      NEW.nip,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'non_medical_approved'
        WHEN NEW.status = 'Tidak Disetujui' THEN 'non_medical_rejected'
        ELSE 'non_medical_updated'
      END,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'Non Medis Disetujui'
        WHEN NEW.status = 'Tidak Disetujui' THEN 'Non Medis Ditolak'
        ELSE 'Status Non Medis Berubah'
      END,
      CONCAT('Permintaan non medis ', NEW.no_permintaan, ': ', NEW.status),
      JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'status', NEW.status),
      NOW(3), 'permintaan_non_medis', NEW.no_permintaan
    FROM pegawai pw WHERE pw.nik = NEW.nip;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_non_medis//

CREATE TRIGGER trg_notify_del_permintaan_non_medis
AFTER DELETE ON permintaan_non_medis
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_non_medis' AND source_pk = OLD.no_permintaan AND deleted_at IS NULL;
END//

-- F4. permintaan_perbaikan_inventaris → inventory_repair_request ─
DROP TRIGGER IF EXISTS trg_notify_permintaan_perbaikan_inventaris//

CREATE TRIGGER trg_notify_permintaan_perbaikan_inventaris
AFTER INSERT ON permintaan_perbaikan_inventaris
FOR EACH ROW
BEGIN
  DECLARE v_nama VARCHAR(100);
  SELECT COALESCE(nama, 'Pegawai') INTO v_nama FROM pegawai WHERE nik = NEW.nik LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.nik, 'inventory_repair_request', 'Perbaikan Inventaris',
    CONCAT('Permintaan perbaikan ', COALESCE(NEW.no_inventaris, ''), ': ', COALESCE(NEW.deskripsi_kerusakan, '')),
    JSON_OBJECT('no_permintaan', NEW.no_permintaan, 'no_inventaris', NEW.no_inventaris,
                'nama_pegawai', v_nama, 'deskripsi_kerusakan', NEW.deskripsi_kerusakan),
    NOW(3), 'permintaan_perbaikan_inventaris', NEW.no_permintaan
  );
END//

DROP TRIGGER IF EXISTS trg_notify_del_permintaan_perbaikan_inventaris//

CREATE TRIGGER trg_notify_del_permintaan_perbaikan_inventaris
AFTER DELETE ON permintaan_perbaikan_inventaris
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'permintaan_perbaikan_inventaris' AND source_pk = OLD.no_permintaan AND deleted_at IS NULL;
END//

-- F5. surat_perlindungan_dari_kekerasan → violence_protection_letter ─
DROP TRIGGER IF EXISTS trg_notify_surat_perlindungan_kekerasan//

CREATE TRIGGER trg_notify_surat_perlindungan_kekerasan
AFTER INSERT ON surat_perlindungan_dari_kekerasan
FOR EACH ROW
BEGIN
  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.nip, 'violence_protection_letter', 'Perlindungan Kekerasan',
    CONCAT('Surat perlindungan untuk ', COALESCE(NEW.no_rawat, '')),
    JSON_OBJECT('no_surat', NEW.no_surat, 'no_rawat', NEW.no_rawat),
    NOW(3), 'surat_perlindungan_dari_kekerasan', NEW.no_surat
  );
END//

DROP TRIGGER IF EXISTS trg_notify_del_surat_perlindungan_kekerasan//

CREATE TRIGGER trg_notify_del_surat_perlindungan_kekerasan
AFTER DELETE ON surat_perlindungan_dari_kekerasan
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'surat_perlindungan_dari_kekerasan' AND source_pk = OLD.no_surat AND deleted_at IS NULL;
END//

-- ==============================================================
-- G. HR & ADMIN APPLICATIONS (dual-notify creator + approver)
-- ==============================================================

-- G1. pengajuan_cuti → leave_application (INSERT - notify only nik_pj) ──
DROP TRIGGER IF EXISTS trg_notify_pengajuan_cuti//

CREATE TRIGGER trg_notify_pengajuan_cuti
AFTER INSERT ON pengajuan_cuti
FOR EACH ROW
BEGIN
  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  SELECT
    NEW.nik_pj,
    'leave_application',
    'Pengajuan Cuti Baru',
    CONCAT(COALESCE(pw.nama, 'Pegawai'), ' mengajukan cuti'),
    JSON_OBJECT('no_pengajuan', NEW.no_pengajuan, 'nama_pegawai', COALESCE(pw.nama, ''),
                'status', NEW.status, 'tanggal_awal', NEW.tanggal_awal, 'tanggal_akhir', NEW.tanggal_akhir),
    NOW(3), 'pengajuan_cuti', NEW.no_pengajuan
  FROM pegawai pw
  WHERE pw.nik = NEW.nik
  LIMIT 1;
END//

DROP TRIGGER IF EXISTS trg_notify_upd_pengajuan_cuti//

CREATE TRIGGER trg_notify_upd_pengajuan_cuti
AFTER UPDATE ON pengajuan_cuti
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    SELECT
      NEW.nik,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'leave_approved'
        WHEN NEW.status = 'Ditolak' THEN 'leave_rejected'
        ELSE 'leave_updated'
      END,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'Cuti Disetujui'
        WHEN NEW.status = 'Ditolak' THEN 'Cuti Ditolak'
        ELSE 'Status Cuti Berubah'
      END,
      CONCAT('Pengajuan cuti ', NEW.no_pengajuan, ': ', NEW.status),
      JSON_OBJECT('no_pengajuan', NEW.no_pengajuan, 'status', NEW.status),
      NOW(3), 'pengajuan_cuti', NEW.no_pengajuan
    FROM (SELECT 1) dummy;
  END IF;
END//

-- ── G1m. pengajuan_cuti status_manajemen → HR approval ─────────
DROP TRIGGER IF EXISTS trg_notify_upd_pengajuan_cuti_manajemen//

CREATE TRIGGER trg_notify_upd_pengajuan_cuti_manajemen
AFTER UPDATE ON pengajuan_cuti
FOR EACH ROW
BEGIN
  IF NEW.status_manajemen <> OLD.status_manajemen THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    SELECT
      NEW.nik,
      CASE
        WHEN NEW.status_manajemen = 'Disetujui' THEN 'leave_approved_manajemen'
        WHEN NEW.status_manajemen = 'Ditolak' THEN 'leave_rejected_manajemen'
        ELSE 'leave_manajemen_updated'
      END,
      CASE
        WHEN NEW.status_manajemen = 'Disetujui' THEN 'Cuti Disetujui (Manajemen)'
        WHEN NEW.status_manajemen = 'Ditolak' THEN 'Cuti Ditolak (Manajemen)'
        ELSE 'Status Manajemen Berubah'
      END,
      CONCAT('Pengajuan cuti ', NEW.no_pengajuan, ' (manajemen): ', NEW.status_manajemen),
      JSON_OBJECT('no_pengajuan', NEW.no_pengajuan, 'status_manajemen', NEW.status_manajemen),
      NOW(3), 'pengajuan_cuti', NEW.no_pengajuan
    FROM (SELECT 1) dummy;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_pengajuan_cuti//

CREATE TRIGGER trg_notify_del_pengajuan_cuti
AFTER DELETE ON pengajuan_cuti
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'pengajuan_cuti' AND source_pk = OLD.no_pengajuan AND deleted_at IS NULL;
END//

-- G2. pengajuan_inventaris → inventory_application (INSERT - notify only nik_pj) ──
DROP TRIGGER IF EXISTS trg_notify_pengajuan_inventaris//

CREATE TRIGGER trg_notify_pengajuan_inventaris
AFTER INSERT ON pengajuan_inventaris
FOR EACH ROW
BEGIN
  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  SELECT
    NEW.nik_pj,
    'inventory_application',
    'Pengajuan Inventaris Baru',
    CONCAT('Pengajuan inventaris oleh ', COALESCE(pw.nama, 'Pegawai')),
    JSON_OBJECT('no_pengajuan', NEW.no_pengajuan, 'nama_pegawai', COALESCE(pw.nama, ''),
                'status', NEW.status),
    NOW(3), 'pengajuan_inventaris', NEW.no_pengajuan
  FROM pegawai pw
  WHERE pw.nik = NEW.nik
  LIMIT 1;
END//

DROP TRIGGER IF EXISTS trg_notify_upd_pengajuan_inventaris//

CREATE TRIGGER trg_notify_upd_pengajuan_inventaris
AFTER UPDATE ON pengajuan_inventaris
FOR EACH ROW
BEGIN
  IF NEW.status <> OLD.status THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    SELECT
      NEW.nik,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'inventory_approved'
        WHEN NEW.status = 'Ditolak' THEN 'inventory_rejected'
        ELSE 'inventory_updated'
      END,
      CASE
        WHEN NEW.status = 'Disetujui' THEN 'Inventaris Disetujui'
        WHEN NEW.status = 'Ditolak' THEN 'Inventaris Ditolak'
        ELSE 'Status Inventaris Berubah'
      END,
      CONCAT('Pengajuan inventaris ', NEW.no_pengajuan, ': ', NEW.status),
      JSON_OBJECT('no_pengajuan', NEW.no_pengajuan, 'status', NEW.status),
      NOW(3), 'pengajuan_inventaris', NEW.no_pengajuan
    FROM (SELECT 1) dummy;
  END IF;
END//

DROP TRIGGER IF EXISTS trg_notify_del_pengajuan_inventaris//

CREATE TRIGGER trg_notify_del_pengajuan_inventaris
AFTER DELETE ON pengajuan_inventaris
FOR EACH ROW
BEGIN
  UPDATE {{DB_NAME}}.notification_queue
  SET deleted_at = NOW(3)
  WHERE source_table = 'pengajuan_inventaris' AND source_pk = OLD.no_pengajuan AND deleted_at IS NULL;
END//

-- ==============================================================
-- F. DPJP RANAP (Inpatient Primary Doctor Assignments)
-- ==============================================================

-- F1. dpjp_ranap → dpjp_assigned / dpjp_removed ────────────────
DROP TRIGGER IF EXISTS trg_notify_dpjp_ranap_insert//

CREATE TRIGGER trg_notify_dpjp_ranap_insert
AFTER INSERT ON dpjp_ranap
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    NEW.kd_dokter, 'dpjp_assigned', 'Penugasan DPJP Ranap',
    CONCAT('Anda ditugaskan sebagai DPJP untuk pasien ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien, 'kd_dokter', NEW.kd_dokter),
    NOW(3), 'dpjp_ranap', CONCAT(NEW.no_rawat, ':', NEW.kd_dokter)
  );
END//

DROP TRIGGER IF EXISTS trg_notify_del_dpjp_ranap//

CREATE TRIGGER trg_notify_del_dpjp_ranap
AFTER DELETE ON dpjp_ranap
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  SELECT COALESCE(p.nm_pasien, 'Pasien') INTO v_nm_pasien
  FROM reg_periksa rp LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = OLD.no_rawat LIMIT 1;

  INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
  VALUES (
    OLD.kd_dokter, 'dpjp_removed', 'Pencabutan DPJP Ranap',
    CONCAT('Penugasan DPJP Anda untuk pasien ', v_nm_pasien, ' (', OLD.no_rawat, ') telah dicabut'),
    JSON_OBJECT('no_rawat', OLD.no_rawat, 'nm_pasien', v_nm_pasien, 'kd_dokter', OLD.kd_dokter),
    NOW(3), 'dpjp_ranap', CONCAT(OLD.no_rawat, ':', OLD.kd_dokter)
  );
END//

-- ==============================================================
-- G. PERKIRAAN BIAYA RANAP (INA-CBG Tariff Estimates)
-- ==============================================================

-- G1. perkiraan_biaya_ranap → cbg_estimate_updated (INSERT) ──
DROP TRIGGER IF EXISTS trg_notify_perkiraan_biaya_ranap_insert//

CREATE TRIGGER trg_notify_perkiraan_biaya_ranap_insert
AFTER INSERT ON perkiraan_biaya_ranap
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  DECLARE v_kd_dokter VARCHAR(20);
  DECLARE done INT DEFAULT FALSE;
  DECLARE cur_dpjp CURSOR FOR SELECT kd_dokter FROM dpjp_ranap WHERE no_rawat = NEW.no_rawat;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  SELECT COALESCE(p.nm_pasien, 'Pasien'), rp.kd_dokter 
  INTO v_nm_pasien, v_kd_dokter
  FROM reg_periksa rp 
  LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  OPEN cur_dpjp;
  dpjp_loop: LOOP
    FETCH cur_dpjp INTO v_kd_dokter;
    IF done THEN
      LEAVE dpjp_loop;
    END IF;
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (
      v_kd_dokter, 'cbg_estimate_updated', 'Estimasi Tarif INA-CBG Diperbarui',
      CONCAT('Estimasi tarif INA-CBG untuk pasien ', v_nm_pasien, ' (', NEW.no_rawat, ') telah ditetapkan sebesar Rp ', FORMAT(NEW.tarif, 0, 'de_DE')),
      JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien, 'tarif', NEW.tarif, 'kd_penyakit', NEW.kd_penyakit),
      NOW(3), 'perkiraan_biaya_ranap', CONCAT(NEW.no_rawat, ':', NEW.kd_penyakit)
    );
  END LOOP;
  CLOSE cur_dpjp;

  -- Fallback to registration doctor if no DPJP assigned
  IF done AND NOT EXISTS (SELECT 1 FROM dpjp_ranap WHERE no_rawat = NEW.no_rawat) AND v_kd_dokter IS NOT NULL THEN
    INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
    VALUES (
      v_kd_dokter, 'cbg_estimate_updated', 'Estimasi Tarif INA-CBG Diperbarui',
      CONCAT('Estimasi tarif INA-CBG untuk pasien ', v_nm_pasien, ' (', NEW.no_rawat, ') telah ditetapkan sebesar Rp ', FORMAT(NEW.tarif, 0, 'de_DE')),
      JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien, 'tarif', NEW.tarif, 'kd_penyakit', NEW.kd_penyakit),
      NOW(3), 'perkiraan_biaya_ranap', CONCAT(NEW.no_rawat, ':', NEW.kd_penyakit)
    );
  END IF;
END//

-- G2. perkiraan_biaya_ranap → cbg_estimate_updated (UPDATE) ──
DROP TRIGGER IF EXISTS trg_notify_perkiraan_biaya_ranap_update//

CREATE TRIGGER trg_notify_perkiraan_biaya_ranap_update
AFTER UPDATE ON perkiraan_biaya_ranap
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);
  DECLARE v_kd_dokter VARCHAR(20);
  DECLARE done INT DEFAULT FALSE;
  DECLARE cur_dpjp CURSOR FOR SELECT kd_dokter FROM dpjp_ranap WHERE no_rawat = NEW.no_rawat;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;

  IF NEW.tarif <> OLD.tarif OR NEW.kd_penyakit <> OLD.kd_penyakit THEN
    SELECT COALESCE(p.nm_pasien, 'Pasien'), rp.kd_dokter 
    INTO v_nm_pasien, v_kd_dokter
    FROM reg_periksa rp 
    LEFT JOIN pasien p ON p.no_rkm_medis = rp.no_rkm_medis
    WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

    OPEN cur_dpjp;
    dpjp_loop: LOOP
      FETCH cur_dpjp INTO v_kd_dokter;
      IF done THEN
        LEAVE dpjp_loop;
      END IF;
      INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
      VALUES (
        v_kd_dokter, 'cbg_estimate_updated', 'Estimasi Tarif INA-CBG Diperbarui',
        CONCAT('Estimasi tarif INA-CBG untuk pasien ', v_nm_pasien, ' (', NEW.no_rawat, ') telah diubah menjadi Rp ', FORMAT(NEW.tarif, 0, 'de_DE')),
        JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien, 'tarif', NEW.tarif, 'kd_penyakit', NEW.kd_penyakit),
        NOW(3), 'perkiraan_biaya_ranap', CONCAT(NEW.no_rawat, ':', NEW.kd_penyakit)
      );
    END LOOP;
    CLOSE cur_dpjp;

    IF done AND NOT EXISTS (SELECT 1 FROM dpjp_ranap WHERE no_rawat = NEW.no_rawat) AND v_kd_dokter IS NOT NULL THEN
      INSERT INTO {{DB_NAME}}.notification_queue (nik, event_type, title, body, payload, created_at, source_table, source_pk)
      VALUES (
        v_kd_dokter, 'cbg_estimate_updated', 'Estimasi Tarif INA-CBG Diperbarui',
        CONCAT('Estimasi tarif INA-CBG untuk pasien ', v_nm_pasien, ' (', NEW.no_rawat, ') telah diubah menjadi Rp ', FORMAT(NEW.tarif, 0, 'de_DE')),
        JSON_OBJECT('no_rawat', NEW.no_rawat, 'nm_pasien', v_nm_pasien, 'tarif', NEW.tarif, 'kd_penyakit', NEW.kd_penyakit),
        NOW(3), 'perkiraan_biaya_ranap', CONCAT(NEW.no_rawat, ':', NEW.kd_penyakit)
      );
    END IF;
  END IF;
END//

-- ==============================================================
-- RESET DELIMITER
-- ==============================================================
DELIMITER ;
