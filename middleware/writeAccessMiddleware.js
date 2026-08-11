const response = require('./responseHandler');

/**
 * Write-access policy (single source of truth, decision D8 — hospital
 * default is READ-ONLY, ALLOW_MOBILE_WRITE=false).
 *
 * Previously /konsultasi, /dpjp-ranap and /pemeriksaan/validasi were
 * exempted while SOAP/resep/diagnosa were blocked — inconsistent.
 * Now every clinical write route follows the same flag.
 */
const WRITE_GATED_PREFIXES = [
  '/dpjp-ranap',
  '/pemeriksaan',
  '/soap',
  '/konsultasi',
  '/resep',
  '/diagnosa-prosedur',
];

function writeAccessEnabled() {
  // Explicit opt-in only: unset/anything-but-true = read-only (fail-safe).
  return process.env.ALLOW_MOBILE_WRITE === 'true';
}

/**
 * Hono middleware to reject write/modify requests when ALLOW_MOBILE_WRITE is set to false.
 */
const writeAccessMiddleware = () => {
  return async (c, next) => {
    const allowWrite = writeAccessEnabled();
    const method = c.req.method;

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && !allowWrite) {
      const res = {
        _status: 403,
        status(code) {
          this._status = code;
          return this;
        },
        json(obj) {
          return c.json(obj, this._status);
        },
      };

      return response.forbidden(
        res,
        'Penyimpanan data hanya diperbolehkan melalui SIMRS Khanza Desktop (Java)'
      );
    }

    await next();
  };
};

module.exports = writeAccessMiddleware;
module.exports.writeAccessEnabled = writeAccessEnabled;
module.exports.WRITE_GATED_PREFIXES = WRITE_GATED_PREFIXES;
