/**
 * Runnable server entry point
 *
 * Run: node server/index.js
 * Or: npm start
 */

const { createApp } = require('./app');
const { getMeta: countyMeta } = require('../packages/data/national-counties');
const { getMeta: zipMeta } = require('../packages/data/zip-crosswalk');

const PORT = process.env.PORT || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`SozoRock Health Agentic v0.7.0 on http://localhost:${PORT}`);
  console.log('  runtime: governed resumable CB-CAP graph');
  console.log(`  geography: ${countyMeta().count} counties (${countyMeta().source})`);
  console.log(`  zip crosswalk: ${zipMeta().count} ZIPs (${zipMeta().source})`);
});
