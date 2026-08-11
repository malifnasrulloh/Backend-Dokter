const pool = require('../config/db');
const { logger } = require('../middleware/logger');
const { redact } = require('./sensitive');

const UAParser = require('ua-parser-js');

const parser = new UAParser();

const UA_CACHE = new Map();
const UA_CACHE_MAX = 200;

function parseUserAgent(uaString) {
  if (!uaString) return 'Unknown Browser on Unknown OS';

  const cached = UA_CACHE.get(uaString);
  if (cached) return cached;

  parser.setUA(uaString);
  const result = parser.getResult();
  const browserName = result.browser?.name || 'Unknown Browser';
  const osName = result.os?.name || 'Unknown OS';
  const deviceInfo = `${browserName} on ${osName}`;

  if (UA_CACHE.size >= UA_CACHE_MAX) {
    const firstKey = UA_CACHE.keys().next().value;
    UA_CACHE.delete(firstKey);
  }
  UA_CACHE.set(uaString, deviceInfo);

  return deviceInfo;
}

const auditTrail = (moduleName) => {
  return async (c, next) => {
    const methodsToLog = ['POST', 'PUT', 'DELETE'];
    const method = c.req.method;

    await next();

    if (!methodsToLog.includes(method)) return;

    setImmediate(async () => {
      let user = 'Unknown User';
      try {
        const body = c.get('body') || {};
        const payload = JSON.stringify(redact(body));
        const trustProxy = process.env.TRUST_PROXY === 'true';
        const rawIp = c.req.raw?.socket?.remoteAddress || '0.0.0.0';
        const ip = trustProxy ? c.req.header('x-forwarded-for') || rawIp : rawIp;
        const route = c.req.path;
        const deviceInfo = parseUserAgent(c.req.header('user-agent'));

        const userData = c.get('user') || {};
        user = userData.username;
        if (!user && route.includes('/login')) {
          user = body.username || body.nip || 'Login Attempt';
        }
        user = user || 'Unknown User';

        const status = c.res.status;
        const statusCode = status.toString();
        const success = status < 400;

        const auditMessage = `[AUDIT] User: ${user} | Action: ${method} | Module: ${moduleName} | Route: ${route} | IP: ${ip} | Status: ${statusCode}`;
        logger.info(auditMessage);

        await pool.execute(
          `INSERT INTO \`audit_trails_server\`
            (\`user\`, \`action\`, \`module\`, \`route\`, \`payload\`, \`ip_address\`, \`status_code\`, \`success\`, \`device_info\`)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [user, method, moduleName, route, payload, ip, statusCode, success, deviceInfo]
        );
      } catch (err) {
        logger.error(
          `Gagal menyimpan audit trail: ${err.message} | Route: ${c.req.path} | User: ${user}`
        );
      }
    });
  };
};

module.exports = auditTrail;
