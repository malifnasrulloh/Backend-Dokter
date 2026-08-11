/**
 * Installs the notification-queue triggers (setup_notification_triggers.sql)
 * into the database configured via .env (DB_NAME).
 *
 * Idempotent: every trigger is DROP IF EXISTS first; rerunning is safe.
 * Skips a trigger (with a warning) if its source table does not exist.
 *
 * Usage: bun scripts/install_triggers.js  (or: node scripts/install_triggers.js)
 */
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const SCRIPT_PATH = path.join(__dirname, '..', 'setup_notification_triggers.sql');

function parseDelimiterSql(sqlContent) {
  const statements = [];
  let statement = '';
  let delimiter = ';';
  const lines = sqlContent.split('\n');

  for (const line of lines) {
    const delimiterMatch = line.match(/^\s*DELIMITER\s+(\S+)\s*$/);
    if (delimiterMatch) {
      if (statement.trim()) statements.push(statement.trim());
      statement = '';
      delimiter = delimiterMatch[1];
      continue;
    }
    statement += `${line}\n`;

    const trimmed = statement.trim();
    if (trimmed.endsWith(delimiter) && !trimmed.endsWith(`\\${delimiter}`)) {
      statements.push(trimmed.slice(0, -delimiter.length).trim());
      statement = '';
    }
  }
  if (statement.trim()) statements.push(statement.trim());

  // Strip full-line comments so statements that begin with section
  // header comments (e.g. `-- ---\nDROP TRIGGER ...`) are NOT dropped.
  return statements
    .map((s) =>
      s
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('--'))
        .join('\n')
    )
    .filter((s) => s.length > 0);
}

(async () => {
  const { DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME } = process.env;
  if (!DB_HOST || !DB_USER || !DB_NAME) {
    console.error('[TRIGGERS] Missing DB_HOST/DB_USER/DB_NAME in .env');
    process.exit(1);
  }

  let sqlContent;
  try {
    sqlContent = fs.readFileSync(SCRIPT_PATH, 'utf8');
  } catch (err) {
    console.error(`[TRIGGERS] Cannot read ${SCRIPT_PATH}: ${err.message}`);
    process.exit(1);
  }

  sqlContent = sqlContent.replaceAll('{{DB_NAME}}', DB_NAME);
  const statements = parseDelimiterSql(sqlContent);

  const pool = mysql.createPool({
    host: DB_HOST,
    port: Number.parseInt(DB_PORT, 10) || 3306,
    user: DB_USER,
    password: DB_PASS,
    database: DB_NAME,
    multipleStatements: false,
  });

  let created = 0;
  let skipped = 0;
  try {
    for (const statement of statements) {
      if (/^CREATE TRIGGER/i.test(statement)) {
        const tableMatch = statement.match(/AFTER (?:INSERT|UPDATE|DELETE) ON\s+`?([a-z0-9_]+)`?/i);
        if (tableMatch) {
          const [rows] = await pool.query(
            `SELECT COUNT(*) AS c FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
            [DB_NAME, tableMatch[1]]
          );
          if (rows[0].c === 0) {
            console.warn(
              `[TRIGGERS] SKIP ${tableMatch[1]}: source table does not exist in ${DB_NAME}`
            );
            skipped++;
            continue;
          }
        }
      }
      await pool.query(statement);
      if (/^CREATE TRIGGER/i.test(statement)) {
        const nameMatch = statement.match(/CREATE TRIGGER\s+`?([a-z0-9_]+)`?/i);
        console.log(`[TRIGGERS] OK ${nameMatch ? nameMatch[1] : statement.substring(0, 60)}`);
        created++;
      }
    }
    const [countRows] = await pool.query('SHOW TRIGGERS');
    console.log(
      `[TRIGGERS] Done: ${created} created/replaced, ${skipped} skipped. Total triggers in ${DB_NAME}: ${countRows.length}`
    );
  } catch (err) {
    console.error(`[TRIGGERS] FAILED: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
