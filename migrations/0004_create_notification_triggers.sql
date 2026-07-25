-- ── NOTIFICATION TRIGGERS ──────────────────────────────────────────
-- AFTER INSERT triggers on all 4 source tables.
-- Each trigger enqueues a notification row directly into notification_queue,
-- so events are captured regardless of ID recycling, timestamp gaps, or
-- missing JOIN references.
--
-- dbMonitorService.js stays as safety net (dedup prevents double-send).
-- ────────────────────────────────────────────────────────────────────

DELIMITER //

-- ═════════════════════════════════════════════════════════════════════
-- 1. konsultasi_medik → consultation_request / emergency_igd_consultation
-- ═════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_notify_konsultasi_medik//
CREATE TRIGGER trg_notify_konsultasi_medik
AFTER INSERT ON konsultasi_medik
FOR EACH ROW
BEGIN
  DECLARE v_nm_dokter VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);
  DECLARE v_event_type VARCHAR(50);
  DECLARE v_title VARCHAR(255);
  DECLARE v_body TEXT;

  -- Get dokter name (fallback if missing)
  SELECT COALESCE(nm_dokter, 'System') INTO v_nm_dokter
  FROM dokter WHERE kd_dokter = NEW.kd_dokter LIMIT 1;

  -- Get pasien name (LEFT JOIN to handle missing refs)
  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp
  LEFT JOIN pasien p ON rp.no_rkm_medis = p.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  -- Determine event type and message
  IF NEW.jenis_permintaan IN ('IGD', 'EMERGENCY') THEN
    SET v_event_type = 'emergency_igd_consultation';
    SET v_title = 'URGENT: KONSUL IGD';
    SET v_body = CONCAT('Permintaan konsultasi segera dari ', v_nm_dokter, ' untuk pasien ', v_nm_pasien);
  ELSE
    SET v_event_type = 'consultation_request';
    SET v_title = 'Konsultasi Baru';
    SET v_body = CONCAT('Permintaan konsultasi dari ', v_nm_dokter, ': "', COALESCE(NEW.diagnosa_kerja, ''), '"');
  END IF;

  INSERT INTO notification_queue (nik, event_type, title, body, payload, created_at)
  VALUES (
    NEW.kd_dokter_dikonsuli,
    v_event_type,
    v_title,
    v_body,
    JSON_OBJECT(
      'no_permintaan', NEW.no_permintaan,
      'no_rawat', NEW.no_rawat,
      'nm_dokter_pemberi', v_nm_dokter,
      'diagnosa_kerja', NEW.diagnosa_kerja,
      'uraian_konsultasi', NEW.uraian_konsultasi,
      'nm_pasien', v_nm_pasien
    ),
    NOW(3)
  );
END//

-- ═════════════════════════════════════════════════════════════════════
-- 2. konsultasi_perawat → sbar_request
-- ═════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_notify_konsultasi_perawat//
CREATE TRIGGER trg_notify_konsultasi_perawat
AFTER INSERT ON konsultasi_perawat
FOR EACH ROW
BEGIN
  DECLARE v_nama_petugas VARCHAR(100);
  DECLARE v_nm_pasien VARCHAR(100);

  -- Get pegawai name (fallback if missing)
  SELECT COALESCE(nama, 'Perawat') INTO v_nama_petugas
  FROM pegawai WHERE nik = NEW.nip LIMIT 1;

  -- Get pasien name
  SELECT COALESCE(p.nm_pasien, 'Unknown') INTO v_nm_pasien
  FROM reg_periksa rp
  LEFT JOIN pasien p ON rp.no_rkm_medis = p.no_rkm_medis
  WHERE rp.no_rawat = NEW.no_rawat LIMIT 1;

  INSERT INTO notification_queue (nik, event_type, title, body, payload, created_at)
  VALUES (
    NEW.kd_dokter_dikonsuli,
    'sbar_request',
    'Permintaan SBAR Baru',
    CONCAT('Laporan dari ', v_nama_petugas, ': "', COALESCE(NEW.situation, ''), '"'),
    JSON_OBJECT(
      'no_permintaan', NEW.no_permintaan,
      'no_rawat', NEW.no_rawat,
      'nama_petugas', v_nama_petugas,
      'situation', NEW.situation,
      'nm_pasien', v_nm_pasien
    ),
    NOW(3)
  );
END//

-- ═════════════════════════════════════════════════════════════════════
-- 3. jawaban_konsultasi_medik → consultation_response
-- ═════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_notify_jawaban_konsultasi_medik//
CREATE TRIGGER trg_notify_jawaban_konsultasi_medik
AFTER INSERT ON jawaban_konsultasi_medik
FOR EACH ROW
BEGIN
  DECLARE v_kd_peminta VARCHAR(20);
  DECLARE v_nm_dokter VARCHAR(100);

  -- Find the original consultation requester
  SELECT km.kd_dokter INTO v_kd_peminta
  FROM konsultasi_medik km
  WHERE km.no_permintaan = NEW.no_permintaan LIMIT 1;

  -- Get the doctor who responded
  SELECT COALESCE(d.nm_dokter, 'Rekan Dokter') INTO v_nm_dokter
  FROM konsultasi_medik km
  LEFT JOIN dokter d ON km.kd_dokter_dikonsuli = d.kd_dokter
  WHERE km.no_permintaan = NEW.no_permintaan LIMIT 1;

  -- Only enqueue if we found the requester
  IF v_kd_peminta IS NOT NULL THEN
    INSERT INTO notification_queue (nik, event_type, title, body, payload, created_at)
    VALUES (
      v_kd_peminta,
      'consultation_response',
      'Konsultasi Dijawab',
      CONCAT('Balasan dari ', v_nm_dokter, ' untuk permintaan ', NEW.no_permintaan),
      JSON_OBJECT(
        'no_permintaan', NEW.no_permintaan,
        'nm_dokter_dikonsuli', v_nm_dokter
      ),
      NOW(3)
    );
  END IF;
END//

-- ═════════════════════════════════════════════════════════════════════
-- 4. reg_periksa → new_admission
-- ═════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_notify_reg_periksa//
CREATE TRIGGER trg_notify_reg_periksa
AFTER INSERT ON reg_periksa
FOR EACH ROW
BEGIN
  DECLARE v_nm_pasien VARCHAR(100);

  SELECT COALESCE(nm_pasien, 'Pasien Baru') INTO v_nm_pasien
  FROM pasien WHERE no_rkm_medis = NEW.no_rkm_medis LIMIT 1;

  INSERT INTO notification_queue (nik, event_type, title, body, payload, created_at)
  VALUES (
    NEW.kd_dokter,
    'new_admission',
    'Pasien Baru Terdaftar',
    CONCAT('Anda telah didelegasikan sebagai DPJP untuk ', v_nm_pasien, ' (', NEW.no_rawat, ')'),
    JSON_OBJECT(
      'no_rawat', NEW.no_rawat,
      'nm_pasien', v_nm_pasien
    ),
    NOW(3)
  );
END//

DELIMITER ;
