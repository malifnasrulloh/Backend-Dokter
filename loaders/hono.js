const { cors } = require('hono/cors');
const { secureHeaders } = require('hono/secure-headers');
const { compress } = require('hono/compress');

const customHttpLogger = require('../middleware/customHttpLogger');
const response = require('../middleware/responseHandler');
const { logger } = require('../middleware/logger');
const { trackerMiddleware } = require('../middleware/tracker');
const requestIdMiddleware = require('../middleware/requestId');
const apiRoutes = require('../routes/main/indexRoute');
const validateTokenJWT = require('../middleware/validateTokenJwt');

const redisClient = require('../config/redis');
const setupSwagger = require('../utils/swagger');

// In-memory fallback limiter saat Redis tidak tersedia
const memoryLimiter = new Map();
const MEMORY_LIMIT = 200; // lebih ketat saat fallback
const MEMORY_WINDOW_MS = 15 * 60 * 1000;

const honoLimiter = async (c, next) => {
  const ip = c.req.header('x-forwarded-for') || '127.0.0.1';

  const isLocal =
    ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.') || ip.startsWith('10.100.0.');

  // For local IPs (Docker), use per-user key from JWT instead of bypassing
  let rateLimitKey;
  const rateLimitMax = 5000;
  if (isLocal) {
    const userData = c.get('user');
    if (userData?.username) {
      rateLimitKey = `user:${userData.username}`;
    } else {
      // Non-authenticated local requests (health, login) — skip limiter
      return await next();
    }
  } else {
    rateLimitKey = `ip:${ip}`;
  }
  try {
    if (redisClient.status !== 'ready') {
      // Fallback ke in-memory limiter — tidak bypass
      const now = Date.now();
      const entry = memoryLimiter.get(rateLimitKey) || { count: 0, resetAt: now + MEMORY_WINDOW_MS };
      if (now > entry.resetAt) {
        entry.count = 0;
        entry.resetAt = now + MEMORY_WINDOW_MS;
      }
      entry.count++;
      memoryLimiter.set(rateLimitKey, entry);

      if (entry.count > MEMORY_LIMIT) {
        logger.warn(`[MemLimiter] Key ${rateLimitKey} diblokir (Redis offline fallback): ${entry.count} req`);
        return c.json({ status: 429, message: 'Terlalu banyak permintaan, silakan coba lagi nanti.' }, 429);
      }
      return await next();
    }

    const count = await redisClient.incr(rateLimitKey);
    if (count === 1) {
      await redisClient.expire(rateLimitKey, 900);
    }

    if (count > rateLimitMax) {
      return c.json(
        {
          status: 429,
          message: 'Terlalu banyak permintaan, silakan coba lagi nanti.',
        },
        429
      );
    }
  } catch (err) {
    logger.error(`[Hono-Limiter] Redis Error: ${err.message}`);
  }

  await next();
};

module.exports = (app, _corsOptions) => {
  // Compression: SSE endpoints excluded (kept for Sse backward compat during migration)
  app.use('*', async (c, next) => {
    // SSE streams must not be compressed
    if (c.req.path === '/api/notifications' && c.req.header('accept') === 'text/event-stream') {
      return await next();
    }
    const compressMiddleware = compress({ threshold: 1024 });
    return await compressMiddleware(c, next);
  });

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(
    '*',
    cors({
      origin: (origin) => origin || '*',
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      credentials: true,
    })
  );

  // Body size limit (10MB max)
  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
      const contentLength = parseInt(c.req.header('content-length') || '0', 10);
      const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
      if (contentLength > MAX_BODY_SIZE) {
        c.status(413);
        return c.json({ code: 413, success: false, message: 'Request body too large (max 10MB)' });
      }
    }
    await next();
  });

  app.use('*', requestIdMiddleware);

  app.use('*', customHttpLogger);

  app.use('*', async (c, next) => {
    const method = c.req.method;
    if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
      const contentType = c.req.header('content-type') || '';
      try {
        if (contentType.includes('application/json')) {
          const body = await c.req.json();
          c.set('body', body);
        } else if (
          contentType.includes('application/x-www-form-urlencoded') ||
          contentType.includes('multipart/form-data')
        ) {
          const body = await c.req.parseBody();
          c.set('body', body);
        }
      } catch (err) {
        logger.warn(`[Body] Failed to parse body from ${c.req.path}: ${err.message}`);
        c.set('body', {});
      }
    }
    await next();
  });

  // Input sanitization on request body
  const { sanitizeMiddleware } = require('../middleware/sanitize');
  app.use('*', sanitizeMiddleware);

  setupSwagger(app);

  app.use('/api/*', honoLimiter);
  app.route('/api', apiRoutes);

  // /api/unblock-ip — wajib JWT admin, jangan bisa diakses publik
  app.post('/api/unblock-ip', validateTokenJWT, async (c) => {
    const body = c.get('body') || {};
    const ip = body.ip;
    if (!ip) {
      const res = {
        status(code) {
          this._status = code;
          return this;
        },
        json(obj) {
          return c.json(obj, this._status);
        },
      };
      return response.badRequest(res, 'Parameter IP wajib diisi');
    }
    try {
      const redisKey = `ip:${ip}`;
      const result = await redisClient.del(redisKey);
      if (result === 1) {
        return c.json({ success: true, message: `IP ${ip} berhasil di-unblock.` });
      }
      return c.json({ success: true, message: `IP ${ip} tidak sedang diblokir.` });
    } catch (err) {
      logger.error(`[Redis-Unblock] Gagal unblock IP ${ip}: ${err.message}`);
      const res = {
        status(code) {
          this._status = code;
          return this;
        },
        json(obj) {
          return c.json(obj, this._status);
        },
      };
      return response.internalError(
        { method: 'POST', url: '/api/unblock-ip', headers: c.req.header() },
        res,
        err,
        'Gagal memproses unblock IP di Redis'
      );
    }
  });

  app.notFound((c) => {
    const res = {
      status(code) {
        this._status = code;
        return this;
      },
      json(obj) {
        return c.json(obj, this._status);
      },
    };
    return response.notFound(res);
  });
};
