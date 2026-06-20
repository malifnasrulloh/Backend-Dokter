const fs = require('fs');
const path = require('path');
const db = require('./db');
const { logger } = require('../middleware/logger');

async function runMigrations() {
  logger.info('[MIGRATIONS] Memulai proses migrasi database...');

  try {
    // 1. Buat tabel migrations jika belum ada
    await db.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // 2. Baca migrasi yang sudah dieksekusi
    const [rows] = await db.query('SELECT name FROM migrations');
    const executedMigrations = new Set(rows.map((row) => row.name));

    // 3. Scan folder migrations/
    const migrationsDir = path.join(__dirname, '../migrations');
    if (!fs.existsSync(migrationsDir)) {
      fs.mkdirSync(migrationsDir, { recursive: true });
    }

    const files = fs.readdirSync(migrationsDir)
      .filter((file) => file.endsWith('.sql'))
      .sort();

    // 4. Jalankan migrasi baru
    for (const file of files) {
      if (!executedMigrations.has(file)) {
        logger.info(`[MIGRATIONS] Mengeksekusi file migrasi: ${file}`);
        const filePath = path.join(migrationsDir, file);
        const sqlContent = fs.readFileSync(filePath, 'utf8');

        // Pisahkan query berdasarkan titik koma ';' lalu eksekusi satu per satu.
        const statements = sqlContent
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        const conn = await db.getConnection();
        try {
          await conn.query('START TRANSACTION');
          for (const statement of statements) {
            await conn.query(statement);
          }
          await conn.query('INSERT INTO migrations (name) VALUES (?)', [file]);
          await conn.query('COMMIT');
          logger.info(`[MIGRATIONS] Berhasil menerapkan migrasi: ${file}`);
        } catch (err) {
          await conn.query('ROLLBACK');
          logger.error(`[MIGRATIONS] GAGAL menerapkan migrasi ${file}: ${err.message}`);
          throw err;
        } finally {
          conn.release();
        }
      }
    }

    logger.info('[MIGRATIONS] Semua migrasi database telah selesai diterapkan.');
  } catch (err) {
    logger.error(`[MIGRATIONS] Error kritis selama proses migrasi: ${err.message}`);
    throw err;
  }
}

module.exports = { runMigrations };
