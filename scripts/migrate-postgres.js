#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const { PROTECTED_TABLES } = require('../server/production-readiness');

const RUNTIME_ROLE = 'cbcap_runtime';

function requiredEnv(env, name, max = 4096) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`${name} is required.`);
  if (value.length > max) throw new Error(`${name} is too long.`);
  return value;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function migrationFiles(root) {
  return fs.readdirSync(root)
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort()
    .map((name) => ({
      name,
      path: path.join(root, name),
    }));
}

async function ensureRuntimeRole(client, runtimePassword, databaseName) {
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [RUNTIME_ROLE]);
  if (!exists.rowCount) await client.query(`CREATE ROLE ${RUNTIME_ROLE} LOGIN`);
  const passwordSql = await client.query('SELECT format($1, $2) AS statement', [
    `ALTER ROLE ${RUNTIME_ROLE} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS LOGIN PASSWORD %L`,
    runtimePassword,
  ]);
  await client.query(passwordSql.rows[0].statement);

  await client.query(`REVOKE ALL ON DATABASE ${quoteIdentifier(databaseName)} FROM ${RUNTIME_ROLE}`);
  await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${RUNTIME_ROLE}`);
  await client.query(`REVOKE ALL ON SCHEMA public FROM ${RUNTIME_ROLE}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${RUNTIME_ROLE}`);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${RUNTIME_ROLE}`);
  await client.query(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${RUNTIME_ROLE}`);

  for (const table of PROTECTED_TABLES) {
    const privileges = table.privileges.join(', ');
    await client.query(`GRANT ${privileges} ON TABLE ${quoteIdentifier(table.name)} TO ${RUNTIME_ROLE}`);
  }
}

async function runMigrations(env = process.env) {
  const host = requiredEnv(env, 'CB_CAP_DATABASE_HOST', 255);
  const port = Number(requiredEnv(env, 'CB_CAP_DATABASE_PORT', 8));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CB_CAP_DATABASE_PORT is invalid.');
  const database = requiredEnv(env, 'CB_CAP_DATABASE_NAME', 63);
  const user = requiredEnv(env, 'CB_CAP_MIGRATION_DATABASE_USERNAME', 63);
  const password = requiredEnv(env, 'CB_CAP_MIGRATION_DATABASE_PASSWORD');
  const runtimePassword = requiredEnv(env, 'CB_CAP_DATABASE_PASSWORD');
  const caFile = requiredEnv(env, 'CB_CAP_DATABASE_CA_FILE', 1024);
  const root = path.resolve(env.CB_CAP_MIGRATION_ROOT || path.join(__dirname, '..', 'infrastructure', 'postgres'));
  const ca = fs.readFileSync(caFile, 'utf8');
  const files = migrationFiles(root);
  if (!files.length) throw new Error('No governed PostgreSQL migrations were found.');

  const client = new Client({
    host,
    port,
    database,
    user,
    password,
    ssl: { ca, rejectUnauthorized: true },
    application_name: 'sozorock-cbcap-migration',
    connectionTimeoutMillis: 10000,
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS cbcap_schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL CHECK (sha256 ~ '^sha256:[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const file of files) {
      const sql = fs.readFileSync(file.path, 'utf8');
      const hash = `sha256:${crypto.createHash('sha256').update(sql).digest('hex')}`;
      const existing = await client.query('SELECT sha256 FROM cbcap_schema_migrations WHERE name = $1', [file.name]);
      if (existing.rowCount) {
        if (existing.rows[0].sha256 !== hash) throw new Error(`Applied migration content changed: ${file.name}`);
        continue;
      }
      await client.query(sql);
      await client.query('INSERT INTO cbcap_schema_migrations (name, sha256) VALUES ($1, $2)', [file.name, hash]);
    }

    await ensureRuntimeRole(client, runtimePassword, database);
    const role = await client.query(`SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = $1`, [RUNTIME_ROLE]);
    if (!role.rowCount) throw new Error('Runtime database role was not created.');
    const unsafe = Object.values(role.rows[0]).some(Boolean);
    if (unsafe) throw new Error('Runtime database role retained an unsafe PostgreSQL privilege.');
    return { migrations: files.length, runtimeRole: RUNTIME_ROLE };
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  runMigrations().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error) => {
    console.error(error?.message || 'CB-CAP migration failed.');
    process.exitCode = 1;
  });
}

module.exports = {
  ensureRuntimeRole,
  migrationFiles,
  quoteIdentifier,
  runMigrations,
};
