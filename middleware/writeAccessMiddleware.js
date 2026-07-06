const response = require('./responseHandler');

/**
 * Hono middleware to reject write/modify requests when ALLOW_MOBILE_WRITE is set to false.
 */
const writeAccessMiddleware = () => {
  return async (c, next) => {
    const allowWrite = process.env.ALLOW_MOBILE_WRITE !== 'false';
    const method = c.req.method;
    const path = c.req.path;
    const isExempted = path.endsWith('/pemeriksaan/validasi') || path.includes('/konsultasi') || path.includes('/dpjp-ranap');

    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) && !allowWrite && !isExempted) {
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
