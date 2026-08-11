-- ──────────────────────────────────────────────────────────────
-- 0006: App-only auxiliary table + legacy-table cleanup.
--
-- Design decision: never add columns to existing (legacy SIMRS)
-- tables. Backend-app-specific state lives in dedicated tables:
--   dokter_user_mapping — login NIK ↔ legacy kd_dokter (Dxxxx) links
--
-- Also drops the columns earlier hardening iterations (0004/0005 on
-- pre-existing databases) added to legacy tables. Safe no-op on fresh
-- installations where those columns were never created.
-- ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS dokter_user_mapping (
  kd_dokter VARCHAR(20) NOT NULL PRIMARY KEY,
  username VARCHAR(50) NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_dokter_mapping_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Cleanup: columns added to legacy tables by earlier iterations.
ALTER TABLE `user` DROP COLUMN IF EXISTS is_admin;
ALTER TABLE `user` DROP COLUMN IF EXISTS password_hash;
ALTER TABLE admin DROP COLUMN IF EXISTS password_hash;
ALTER TABLE dokter DROP COLUMN IF EXISTS username;
ALTER TABLE konsultasi_medik DROP COLUMN IF EXISTS lampiran;