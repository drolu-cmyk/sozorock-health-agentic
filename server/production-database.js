const fs = require('node:fs');
const { Pool } = require('pg');

function requiredEnv(env, name, max = 4096) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  if (value.length > max) throw new Error(`${name} is too long.`);
  return value;
}

function createProductionPool(env = process.env) {
  const host = requiredEnv(env, 'CB_CAP_DATABASE_HOST', 255);
  const port = Number(requiredEnv(env, 'CB_CAP_DATABASE_PORT', 8));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CB_CAP_DATABASE_PORT is invalid.');
  const database = requiredEnv(env, 'CB_CAP_DATABASE_NAME', 63);
  const user = requiredEnv(env, 'CB_CAP_DATABASE_USERNAME', 63);
  const password = requiredEnv(env, 'CB_CAP_DATABASE_PASSWORD');
  const caFile = requiredEnv(env, 'CB_CAP_DATABASE_CA_FILE', 1024);
  const ca = fs.readFileSync(caFile, 'utf8');
  if (!ca.includes('BEGIN CERTIFICATE')) throw new Error('CB_CAP_DATABASE_CA_FILE does not contain a certificate bundle.');

  return new Pool({
    host,
    port,
    database,
    user,
    password,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
    application_name: 'sozorock-cbcap-agentic',
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

async function closePool(pool) {
  if (pool && typeof pool.end === 'function') await pool.end();
}

module.exports = {
  closePool,
  createProductionPool,
  requiredEnv,
};
