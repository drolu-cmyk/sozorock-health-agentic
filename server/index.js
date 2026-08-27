/**
 * Runnable server entry point
 *
 * Run: node server/index.js
 * Or: npm start
 *
 * This default entry point intentionally does not activate the institutional
 * gateway. Production composition must inject authenticated Cognito/PostgreSQL
 * dependencies and pass the controlled production readiness gate first.
 */

const { createApp } = require('./app');
const { getMeta: countyMeta } = require('../packages/data/national-counties');
const { getMeta: zipMeta } = require('../packages/data/zip-crosswalk');

const PORT = process.env.PORT || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`SozoRock Health Agentic v0.10.0 on http://localhost:${PORT}`);
  console.log('  runtime: governed control plane; institutional routes fail closed by default');
  console.log(`  geography: ${countyMeta().count} counties (${countyMeta().source})`);
  console.log(`  postal geography: ${zipMeta().count} records via ${zipMeta().method} (${zipMeta().source})`);
});
