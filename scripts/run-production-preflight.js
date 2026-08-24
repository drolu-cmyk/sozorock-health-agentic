#!/usr/bin/env node

const path = require('node:path');
const { runProductionReadiness } = require('../server/production-readiness');

async function main() {
  const adapterPath = String(process.env.CB_CAP_PRODUCTION_READINESS_ADAPTER || '').trim();
  if (!adapterPath) {
    console.error('CB_CAP_PRODUCTION_READINESS_ADAPTER is required.');
    process.exitCode = 2;
    return;
  }

  const resolved = path.resolve(adapterPath);
  let adapter;
  try {
    adapter = require(resolved);
  } catch {
    console.error('Production readiness adapter could not be loaded.');
    process.exitCode = 2;
    return;
  }
  if (!adapter || typeof adapter.createReadinessOptions !== 'function') {
    console.error('Production readiness adapter must export createReadinessOptions().');
    process.exitCode = 2;
    return;
  }

  let options;
  try {
    options = await adapter.createReadinessOptions();
  } catch {
    console.error('Production readiness adapter initialization failed.');
    process.exitCode = 2;
    return;
  }

  try {
    const report = await runProductionReadiness({ ...options, env: process.env });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ready ? 0 : 1;
  } finally {
    if (typeof options.cleanup === 'function') {
      await options.cleanup();
    }
  }
}

main().catch(() => {
  console.error('Production readiness preflight failed.');
  process.exitCode = 2;
});
