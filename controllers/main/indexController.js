const response = require('../../middleware/responseHandler');
const db = require('../../config/db');
const os = require('node:os');
const cache = require('../../utils/cache');

exports.getIndex = async (_req, res) => {
  return response.ok(res, null, 'API by RS Islam Aminah');
};

exports.postIndex = async (_req, res) => {
  return response.ok(res, null, 'API by RS Islam Aminah');
};

exports.healthCheck = async (_req, res) => {
  const startTime = Date.now();
  const checks = {
    server: 'healthy',
    database: 'unknown',
    uptime: `${Math.floor(process.uptime())}s`,
    memory: {},
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
  };

  try {
    const dbStart = Date.now();
    await db.query('SELECT 1');
    checks.database = 'healthy';
    checks.dbResponseTime = `${Date.now() - dbStart}ms`;
  } catch (err) {
    checks.database = 'unhealthy';
    checks.dbError = process.env.NODE_ENV === 'production' ? 'Connection failed' : err.message;
  }

  const memUsage = process.memoryUsage();
  checks.memory = {
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    systemFree: `${Math.round(os.freemem() / 1024 / 1024)}MB`,
    systemTotal: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
  };

  checks.cpuLoad = os.loadavg()[0].toFixed(2);
  checks.cache = cache.stats();
  checks.responseTime = `${Date.now() - startTime}ms`;

  const isHealthy = checks.database === 'healthy';
  const statusCode = isHealthy ? 200 : 503;

  return res.status(statusCode).json({
    code: statusCode,
    success: isHealthy,
    message: isHealthy ? 'All systems operational' : 'Service degraded',
    data: checks,
  });
};

exports.getPool = async (req, res) => {
  try {
    const pool = db.pool;
    const totalConnections = pool._allConnections._list.filter((conn) => conn !== undefined).length;
    const idleConnections = pool._freeConnections._list.filter((conn) => conn !== undefined).length;
    const activeConnections = totalConnections - idleConnections;
    const waitingClients = pool._connectionQueue._list.filter((conn) => conn !== undefined).length;
    const isClosed = pool._closed;

    const poolInfo = {
      totalConnections,
      idleConnections,
      activeConnections,
      waitingClients,
      isClosed,
    };

    return response.ok(res, poolInfo);
  } catch (error) {
    return response.internalError(req, res, error);
  }
};
