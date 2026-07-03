const mysql = require('mysql2/promise');
const { logger } = require('../middleware/logger');

const DISABLE_QUERY_LOG = process.env.DISABLE_QUERY_LOG === 'true';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const db = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  waitForConnections: true,

  connectionLimit: Number.parseInt(
    process.env.DB_CONNECTION_LIMIT,
    10
  ),
  queueLimit: 0,
  connectTimeout: 10000,
  idleTimeout: 60000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  timezone: '+07:00',
  dateStrings: true,
  namedPlaceholders: false,
  decimalNumbers: true,
  maxPreparedStatements: 512,
  multipleStatements: false,
});

db.pool.on('error', (err) => {
  logger.error(`[DB-POOL] Pool error: ${err.code} - ${err.message}`);
});

const RETRYABLE_ERRORS = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ECONNREFUSED',
  'ER_CON_COUNT_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
]);

const originalQuery = db.query.bind(db);
const originalExecute = db.execute.bind(db);
const originalGetConnection = db.getConnection.bind(db);

db.query = async (sql, values) => runAndLog(originalQuery, sql, values);

db.execute = async (sql, values) => runAndLog(originalExecute, sql, values);

db.getConnection = async () => {
  const conn = await originalGetConnection();

  const acquireStack = new Error().stack;
  let isReleased = false;

  const timeoutId = setTimeout(() => {
    if (!isReleased) {
      logger.error(`[DB-LEAK-DETECT] KONEKSI BOCOR terdeteksi (tidak di-release > 30s)! Dibuat di:\n${acquireStack}`);
      try {
        logger.warn(`[DB-LEAK-DETECT] Memaksa destroy koneksi bocor untuk memutus koneksi idle di MySQL.`);
        conn.destroy();
      } catch (err) {
        logger.error(`[DB-LEAK-DETECT] Gagal force destroy koneksi bocor: ${err.message}`);
      }
      isReleased = true;
    }
  }, 30000);
  if (timeoutId.unref) timeoutId.unref();

  const originalConnQuery = conn.query.bind(conn);
  const originalConnExecute = conn.execute.bind(conn);
  const originalRelease = conn.release ? conn.release.bind(conn) : null;
  const originalDestroy = conn.destroy ? conn.destroy.bind(conn) : null;

  conn.query = async (sql, values) => {
    if (isReleased) {
      logger.warn(`[DB-WARN] Query dipanggil pada koneksi yang sudah di-release/destroy!\nQuery: ${sql}`);
    }
    return runAndLog(originalConnQuery, sql, values);
  };

  conn.execute = async (sql, values) => {
    if (isReleased) {
      logger.warn(`[DB-WARN] Execute dipanggil pada koneksi yang sudah di-release/destroy!\nQuery: ${sql}`);
    }
    return runAndLog(originalConnExecute, sql, values);
  };

  conn.release = () => {
    if (!isReleased) {
      clearTimeout(timeoutId);
      isReleased = true;
      if (originalRelease) originalRelease();
    }
  };

  conn.destroy = () => {
    if (!isReleased) {
      clearTimeout(timeoutId);
      isReleased = true;
      if (originalDestroy) originalDestroy();
    }
  };

  return conn;
};

const LOG_BUFFER = [];
const LOG_FLUSH_INTERVAL = 5000;
const LOG_BATCH_SIZE = 50;

let logFlushTimer = null;

function scheduleLogFlush() {
  if (logFlushTimer) return;
  logFlushTimer = setTimeout(flushLogs, LOG_FLUSH_INTERVAL);
  logFlushTimer.unref();
}

async function flushLogs() {
  logFlushTimer = null;
  if (LOG_BUFFER.length === 0) return;

  const batch = LOG_BUFFER.splice(0, LOG_BATCH_SIZE);
  if (batch.length === 0) return;

  try {
    const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
    const values = batch.flatMap((entry) => [entry.tanggal, entry.queryStr, entry.valStr]);
    await originalQuery(
      `INSERT INTO query_logs (tanggal, query_text, query_values) VALUES ${placeholders}`,
      values
    );
  } catch (logErr) {
    logger.error(`[DB] Batch insert query log error: ${logErr.message}`);
  }

  if (LOG_BUFFER.length > 0) {
    scheduleLogFlush();
  }
}

async function drainLogs() {
  if (logFlushTimer) {
    clearTimeout(logFlushTimer);
    logFlushTimer = null;
  }
  while (LOG_BUFFER.length > 0) {
    const batch = LOG_BUFFER.splice(0, LOG_BATCH_SIZE);
    if (batch.length === 0) break;
    try {
      const placeholders = batch.map(() => '(?, ?, ?)').join(', ');
      const values = batch.flatMap((entry) => [entry.tanggal, entry.queryStr, entry.valStr]);
      await originalQuery(
        `INSERT INTO query_logs (tanggal, query_text, query_values) VALUES ${placeholders}`,
        values
      );
    } catch (logErr) {
      logger.error(`[DB] Drain query log error: ${logErr.message}`);
      break;
    }
  }
}

const skipLogRegex =
  /^(?:select|insert\s+(?:ignore\s+|low_priority\s+|high_priority\s+|delayed\s+)?into\s+(?:audit_trails_server|audit_trails|query_logs|log_taskid|trackersql|satu_sehat_log|log_aplicares_detail|log_aplicares))\b/i;
const mutationRegex = /^(?:insert|update|delete|replace)/i;
const sensitiveQueryRegex = /password|aes_decrypt|auth\/login|encryption/i;

function processLogBackground(queryStr, values, _duration) {
  try {
    const trimmedQuery = queryStr.trimStart();
    const normalizedQuery = trimmedQuery.toLowerCase().replace(/\s+/g, ' ').replace(/`/g, '');

    if (skipLogRegex.test(normalizedQuery)) return;

    let valStr = '';
    if (values !== undefined && values !== null) {
      const isSensitive = sensitiveQueryRegex.test(queryStr);
      valStr = isSensitive
        ? '[REDACTED]'
        : Array.isArray(values) || typeof values === 'object'
          ? JSON.stringify(values)
          : String(values);
    }

    const tanggal = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Jakarta' });
    LOG_BUFFER.push({ tanggal, queryStr, valStr });

    if (mutationRegex.test(trimmedQuery)) {
      const logMessage = `[SQL-TRACKER] ${trimmedQuery.substring(0, 200)} | Values: ${valStr}`;
      logger.info(logMessage);
    }

    if (LOG_BUFFER.length >= LOG_BATCH_SIZE) {
      flushLogs();
    } else {
      scheduleLogFlush();
    }
  } catch (err) {
    logger.error(`[DB] Background log processing error: ${err.message}`);
  }
}

async function runAndLog(fn, sql, values, retryCount = 0) {
  const start = Date.now();

  try {
    const [results, fields] = await fn(sql, values);

    const duration = Date.now() - start;

    if (!DISABLE_QUERY_LOG) {
      const queryStr = typeof sql === 'string' ? sql : sql.sql;

      if (duration > 1000) {
        logger.warn(`SLOW QUERY (${duration}ms): ${queryStr}`, { duration, values });
      }

      setImmediate(() => processLogBackground(queryStr, values, duration));
    }

    return [results, fields];
  } catch (err) {
    if (retryCount < 1 && RETRYABLE_ERRORS.has(err.code)) {
      const queryStr = typeof sql === 'string' ? sql : sql.sql;
      logger.warn(
        `[DB-RETRY] ${err.code} pada query, retry ke-${retryCount + 1}: ${queryStr.substring(0, 150)}`
      );

      await new Promise((r) => setTimeout(r, 200));
      return runAndLog(fn, sql, values, retryCount + 1);
    }
    throw err;
  }
}

process.on('beforeExit', () => {
  if (LOG_BUFFER.length > 0) {
    flushLogs();
  }
});

db.drainLogs = drainLogs;

module.exports = db;
