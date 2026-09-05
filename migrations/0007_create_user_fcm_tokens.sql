-- ── user_fcm_tokens ─────────────────────────────────────────────────
-- Multi-device FCM token registry for E-Dokter mobile application.
-- Supports multiple active devices per doctor (e.g. phone + tablet).
CREATE TABLE IF NOT EXISTS user_fcm_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nik VARCHAR(20) NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  fcm_token TEXT NOT NULL,
  platform VARCHAR(20) DEFAULT 'android',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_nik_device (nik, device_id),
  INDEX idx_nik (nik)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
