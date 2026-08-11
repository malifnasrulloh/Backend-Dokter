const jose = require('jose');
const response = require('../middleware/responseHandler');

// Fail-closed, lazily: the secret is read per request, so requiring this
// module never throws (tests/CI without a .env can load routes). Missing
// SECRETTOKEN yields 503 instead of silently accepting tokens.
const getSecretKey = () => new TextEncoder().encode(process.env.SECRETTOKEN || '');

module.exports = async (c, next) => {
  const authHeader = c.req.header('authorization');

  if (!process.env.SECRETTOKEN) {
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
      { method: c.req.method, url: c.req.path, headers: c.req.header() },
      res,
      new Error('SECRETTOKEN belum dikonfigurasi'),
      'Server belum dikonfigurasi (SECRETTOKEN). Hubungi administrator.'
    );
  }

  if (!authHeader?.startsWith('Bearer ')) {
    const res = {
      status(code) {
        this._status = code;
        return this;
      },
      json(obj) {
        return c.json(obj, this._status);
      },
    };
    return response.unauthorized(res, '', 'Token tidak ditemukan');
  }

  const token = authHeader.split(' ')[1];

  try {
    const { payload } = await jose.jwtVerify(token, getSecretKey());

    c.set('user', payload.data);
    await next();
  } catch (error) {
    const res = {
      status(code) {
        this._status = code;
        return this;
      },
      json(obj) {
        return c.json(obj, this._status);
      },
    };
    return response.unauthorized(res, error, 'Unauthorized Token Invalid or Expired');
  }
};
