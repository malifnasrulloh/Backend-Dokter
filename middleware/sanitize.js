/**
 * Input sanitization middleware for Hono.
 *
 * Strips XSS vectors (script tags, event handlers, javascript: URIs)
 * from all string values in the request body. Also prevents prototype
 * pollution by deleting __proto__, constructor, and prototype keys.
 */

const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;

  return str
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, '')
    .trim();
};

const BLACKLISTED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const sanitizeObject = (obj, depth = 0) => {
  if (depth > 10) return obj;
  if (obj === null || obj === undefined) return obj;

  // Preserve File / Blob / Buffer binary objects from being stripped into empty plain objects
  if (typeof obj.arrayBuffer === 'function' || Buffer.isBuffer(obj) || obj instanceof Uint8Array) {
    return obj;
  }

  if (typeof obj === 'string') return sanitizeString(obj);
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeObject(item, depth + 1));

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (BLACKLISTED_KEYS.has(key)) continue;
    sanitized[key] = sanitizeObject(value, depth + 1);
  }
  return sanitized;
};

/**
 * Hono middleware — sanitize all incoming string values in request body.
 * Body is expected at c.get('body') (set by hono loader's body parser).
 */
const sanitizeMiddleware = async (c, next) => {
  const body = c.get('body');
  if (body && typeof body === 'object') {
    c.set('body', sanitizeObject(body));
  }
  await next();
};

module.exports = sanitizeMiddleware;
module.exports.sanitizeString = sanitizeString;
module.exports.sanitizeObject = sanitizeObject;
