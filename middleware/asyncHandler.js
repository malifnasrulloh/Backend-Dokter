const response = require('./responseHandler');
const { logMessage } = require('./logger');

const asyncHandler = (fn) => {
  return async (c) => {
    const query = c.req.query();
    const params = c.req.param();
    const headers = c.req.header();
    const body = c.get('body') || {};

    const req = {
      query,
      params,
      body,
      headers,
      get: (headerName) => c.req.header(headerName),
      ip: c.req.header('x-forwarded-for') || '127.0.0.1',
      method: c.req.method,
      url: c.req.url,
      originalUrl: c.req.path,
      set: (key, val) => c.set(key, val),
      getVal: (key) => c.get(key),
    };

    Object.defineProperty(req, 'user', {
      get: () => c.get('user') || null,
      set: (val) => c.set('user', val),
      configurable: true,
      enumerable: true,
    });

    const res = {
      _status: 200,
      headersSent: false,
      _honoResponse: null,

      status(statusCode) {
        this._status = statusCode;
        return this;
      },
      json(obj) {
        this.headersSent = true;
        this._honoResponse = c.json(obj, this._status);
        return this._honoResponse;
      },
      send(data) {
        this.headersSent = true;
        this._honoResponse = c.text(data, this._status);
        return this._honoResponse;
      },
      end() {
        this.headersSent = true;
        this._honoResponse = c.body(null, this._status);
        return this._honoResponse;
      },
      clearCookie(name, options) {
        // No-op or cookie clearing for Hono
        return this;
      },
    };

    try {
      const result = await fn(req, res, () => {});

      if (res.headersSent) {
        return res._honoResponse;
      }
      return result;
    } catch (error) {
      const ip = req.ip || '-';
      const method = req.method;
      const url = req.url;
      const requestId = c.get('requestId') || '-';

      if (error.isOperational) {
        if (error.statusCode === 400) return response.badRequest(req, res, error.message);
        if (error.statusCode === 401) return response.unauthorized(res, error, error.message);
        if (error.statusCode === 403) return response.forbidden(res, error.message);
        if (error.statusCode === 404) return response.notFound(res, error.message);
        if (error.statusCode === 409) return response.conflict(res, error.message);
        if (error.statusCode === 429) {
          return res.status(429).json({
            code: 429,
            success: false,
            message: error.message,
          });
        }
      }

      // Handle Axios errors from external APIs (BPJS VClaim, SatuSehat, etc.)
      if ((error.isAxiosError || error.config) && error.response) {
        const status = error.response.status;
        const data = error.response.data;

        if (data && typeof data === 'object') {
          // 1. BPJS VClaim / Antrean / Apotek metadata format
          if (data.metaData?.message) {
            logMessage(
              'warning',
              `[${requestId}] ${method} ${url} from ${ip} — AxiosError (BPJS API ${status}): ${data.metaData.message}`
            );
            return response.badRequest(req, res, data.metaData.message);
          }

          // 2. SatuSehat FHIR OperationOutcome format
          if (
            data.resourceType === 'OperationOutcome' &&
            Array.isArray(data.issue) &&
            data.issue.length > 0
          ) {
            const issue = data.issue[0];
            const issueDetails =
              issue.diagnostics ||
              issue.details?.text ||
              issue.expression?.join(', ') ||
              'Unknown FHIR Error';
            logMessage(
              'warning',
              `[${requestId}] ${method} ${url} from ${ip} — AxiosError (SatuSehat API ${status}): ${issueDetails}`
            );
            return response.badRequest(req, res, `SatuSehat: ${issueDetails}`);
          }

          // 3. General JSON error formats containing message
          if (data.message) {
            logMessage(
              'warning',
              `[${requestId}] ${method} ${url} from ${ip} — AxiosError (API ${status}): ${data.message}`
            );
            return response.badRequest(req, res, data.message);
          }
        }
      }

      // Handle MySQL / Database errors with user-friendly messages
      if (error.code && error.errno) {
        const mysqlErrorMap = {
          ER_DATA_TOO_LONG: () => {
            const match = error.message.match(/column '(\w+)'/i);
            const col = match ? match[1] : 'field';
            return `Data terlalu panjang untuk kolom '${col}'. Periksa kembali isian Anda.`;
          },
          ER_DUP_ENTRY: () => {
            return 'Data sudah ada (duplikat). Tidak dapat menyimpan data yang sama.';
          },
          ER_TRUNCATED_WRONG_VALUE: () => {
            return 'Format data tidak sesuai. Periksa kembali format tanggal atau angka yang diisi.';
          },
          ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: () => {
            const match = error.message.match(/column '(\w+)'/i);
            const col = match ? match[1] : 'field';
            return `Nilai tidak valid untuk kolom '${col}'. Periksa kembali data yang diinput.`;
          },
          ER_NO_REFERENCED_ROW_2: () => {
            return 'Data referensi tidak ditemukan. Pastikan data terkait sudah tersedia.';
          },
          ER_NO_REFERENCED_ROW: () => {
            return 'Data referensi tidak ditemukan. Pastikan data terkait sudah tersedia.';
          },
          ER_BAD_NULL_ERROR: () => {
            const match = error.message.match(/column '(\w+)'/i);
            const col = match ? match[1] : 'field';
            return `Kolom '${col}' wajib diisi dan tidak boleh kosong.`;
          },
          WARN_DATA_TRUNCATED: () => {
            const match = error.message.match(/column '(\w+)'/i);
            const col = match ? match[1] : 'field';
            return `Data terpotong untuk kolom '${col}'. Periksa kembali nilai yang diinput.`;
          },
        };

        const handler = mysqlErrorMap[error.code];
        if (handler) {
          const userMessage = handler();
          logMessage(
            'warning',
            `[${requestId}] ${method} ${url} from ${ip} — MySQL ${error.code}: ${error.message}`
          );
          return response.badRequest(req, res, userMessage);
        }
      }

      logMessage(
        'error',
        `[${requestId}] ${method} ${url} from ${ip} — ${error.message}\n${error.stack}`
      );

      return response.internalError(req, res, error);
    }
  };
};

module.exports = asyncHandler;
