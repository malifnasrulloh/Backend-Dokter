-- ──────────────────────────────────────────────────────────────
-- 0004: Hardening — sequence-uniqueness key + performance indexes.
-- Per project decision: NO columns are ever added to existing
-- (legacy SIMRS) tables; auxiliary state lives in separate tables
-- (see 0006). Indexes/keys are non-invasive (no data-shape change).
-- Fully idempotent for MariaDB (ADD INDEX IF NOT EXISTS).
-- ──────────────────────────────────────────────────────────────

-- 1. Resep number collision guard.
--    no_resep is generated as YYYYMMDD + max(right(4)) + 1 in a
--    transaction without locking; a unique key makes a race fail
--    loudly instead of silently overwriting (backend retries).
ALTER TABLE resep_obat
  ADD UNIQUE INDEX IF NOT EXISTS uk_no_resep (no_resep);

-- 2. Performance indexes for the heaviest endpoints:
--    - list-pasien-ranap: reg_periksa by (doctor, status, date)
--    - perkiraan-biaya: kamar_inap by pulang-status + tanggal keluar
--    - lab hasil lists: detail_periksa_lab by no_rawat
ALTER TABLE reg_periksa
  ADD INDEX IF NOT EXISTS idx_reg_periksa_dokter_status (kd_dokter, status_lanjut, tgl_registrasi);
ALTER TABLE kamar_inap
  ADD INDEX IF NOT EXISTS idx_kamar_inap_status (stts_pulang, tgl_keluar);
ALTER TABLE detail_periksa_lab
  ADD INDEX IF NOT EXISTS idx_detail_lab_rawat (no_rawat);