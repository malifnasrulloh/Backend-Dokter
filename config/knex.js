const knex = require('knex');

const knexInstance = knex({
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    timezone: '+07:00',
    dateStrings: true,
  },
  pool: {
    min: 2,
    max: Number.parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  },
});

module.exports = knexInstance;
