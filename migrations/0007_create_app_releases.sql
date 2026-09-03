-- ── app_releases ────────────────────────────────────────────────────────
-- Tracks published mobile application builds, checksums, and version policies
CREATE TABLE IF NOT EXISTS app_releases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  app_name VARCHAR(100) NOT NULL DEFAULT 'E-Dokter',
  version_name VARCHAR(50) NOT NULL,
  version_code INT NOT NULL,
  min_supported_version VARCHAR(50) NOT NULL,
  release_notes TEXT,
  file_name VARCHAR(255) NOT NULL,
  file_size BIGINT NOT NULL DEFAULT 0,
  sha256_checksum VARCHAR(64) NOT NULL,
  download_url VARCHAR(500) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_app_version (app_name, is_active, version_code DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
