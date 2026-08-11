/**
 * Shared sensitive-value redaction used by the audit trail and the
 * request-body copies kept for logging. Never store these keys' values.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'oldPassword',
  'newPassword',
  'confirmPassword',
  'confPassword',
  'token',
  'authorization',
  'refresh_token',
  'refreshToken',
  'access_token',
  'accessToken',
  'secret',
  'api_key',
  'apiKey',
  'SECRETTOKEN',
  'DB_AES_KEY_USER',
  'DB_AES_KEY_PASS',
]);

function redact(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return value;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key) ? '***' : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

module.exports = { SENSITIVE_KEYS, redact };
