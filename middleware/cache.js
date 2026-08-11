const cache = require('../utils/cache');

const cacheMiddleware = (duration) => {
  return async (c, next) => {
    const method = c.req.method;
    if (method !== 'GET') {
      return await next();
    }

    const key = `api_cache:${c.req.url}`;

    try {
      const cachedData = await cache.get(key);
      if (cachedData) {
        const responseData = { ...cachedData };
        responseData.cached = true;
        responseData.source = cache.stats().type;
        return c.json(responseData, 200);
      }

      await next();

      if (c.res && c.res.status === 200) {
        try {
          const clone = c.res.clone();
          const body = await clone.json();
          if (body?.success) {
            await cache.set(key, body, duration);
          }
        } catch (err) {
          console.error('[Cache] Intercept Error:', err.message);
        }
      }
    } catch (err) {
      console.error('[Cache] Middleware Error:', err.message);
      await next();
    }
  };
};

const clearCache = async (pattern) => {
  try {
    await cache.delByPrefix(`api_cache:${pattern}`);
  } catch (err) {
    console.error('[Cache] Clear Error:', err.message);
  }
};

module.exports = { cacheMiddleware, clearCache };
