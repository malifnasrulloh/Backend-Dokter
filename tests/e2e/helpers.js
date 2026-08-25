const { Hono } = require('hono');
const { serve } = require('@hono/node-server');

const DOCTOR_USER = { username: '123456', password: '123456' };
const ADMIN_USER = { username: 'spv', password: 'server' };

const RANAP_NO_RAWAT = '2026/08/24/000002';
const RALAN_NO_RAWAT = '2026/08/26/000002';
const TODAY = new Date().toISOString().slice(0, 10);

let _server;
let _baseUrl = '';

async function startServer() {
  if (_server) return _baseUrl;

  process.env.DB_NAME = 'sik_temps';
  process.env.NODE_ENV = 'test';
  process.env.REDIS_ENABLED = 'false';
  process.env.DISABLE_QUERY_LOG = 'true';
  process.env.ALLOW_MOBILE_WRITE = 'true';

  delete require.cache[require.resolve('../../config/db')];
  delete require.cache[require.resolve('../../config/knex')];

  const honoLoader = require('../../loaders/hono');
  const app = new Hono();
  honoLoader(app);

  await new Promise((resolve) => {
    // Port 0 lets the OS pick an available open port
    _server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      _baseUrl = `http://localhost:${info.port}`;
      resolve();
    });
  });

  return _baseUrl;
}

async function stopServer() {
  if (_server && typeof _server.close === 'function') {
    await new Promise((resolve) => _server.close(resolve));
    _server = null;
    _baseUrl = '';
  }
}

function getBaseUrl() {
  return _baseUrl;
}

async function login(creds = DOCTOR_USER) {
  const res = await fetch(`${_baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(creds),
  });
  const data = await res.json();
  return { res, data, token: data.token };
}

function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function api(method, path, token, body) {
  const opts = { method, headers: authHeaders(token) };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${_baseUrl}${path}`, opts);
  const data = await res.json().catch(() => null);
  return { res, data };
}

module.exports = {
  get BASE_URL() {
    return _baseUrl;
  },
  getBaseUrl,
  DOCTOR_USER,
  ADMIN_USER,
  RANAP_NO_RAWAT,
  RALAN_NO_RAWAT,
  TODAY,
  startServer,
  stopServer,
  login,
  authHeaders,
  api,
};
