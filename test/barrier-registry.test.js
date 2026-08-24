const test = require('node:test');
const assert = require('node:assert/strict');
const {
  REVIEWED_SOURCE_MEASURES,
  buildReviewedBarrierRegistry,
} = require('../packages/cbcap/barrier-registry');

function semantic(sourceMeasureId, overrides = {}) {
  return {
    id: overrides.id || `definition:${sourceMeasureId}`,
    source_measure_id: sourceMeasureId,
    review_status: overrides.reviewStatus || 'verified',
  };
}

test('reviewed public barrier measures map to explicit families without a score', () => {
  const registry = buildReviewedBarrierRegistry([
    semantic('ACCESS2:Crude'),
    semantic('LACKTRPT:Crude'),
    semantic('FOODINSECU:Crude'),
    semantic('HOUSINSECU:Crude'),
    semantic('SHUTUTILITY:Crude'),
    semantic('LONELINESS:Crude'),
  ]);
  assert.equal(registry.list().length, 6);
  assert.equal(registry.require('definition:LACKTRPT:Crude').barrierFamily, 'transportation_and_travel');
  assert.equal(registry.require('definition:FOODINSECU:Crude').barrierFamily, 'food_security_and_food_access');
});

test('HRSA designations retain scope-specific barrier meaning rather than becoming a county score', () => {
  const registry = buildReviewedBarrierRegistry([
    semantic('HPSA_DESIGNATION'),
    semantic('MUA_P_DESIGNATION'),
  ]);
  assert.equal(registry.require('definition:HPSA_DESIGNATION').barrierFamily, 'workforce');
  assert.match(registry.require('definition:HPSA_DESIGNATION').geometryRule, /whole-county/);
  assert.equal(registry.require('definition:MUA_P_DESIGNATION').barrierFamily, 'care_availability');
});

test('contextual demographic and unknown measures are not silently turned into barriers', () => {
  const registry = buildReviewedBarrierRegistry([
    semantic('DISABILITY:Crude'),
    semantic('NEW_UNREVIEWED:Crude'),
  ]);
  assert.deepEqual(registry.list(), []);
});

test('unverified semantics cannot enter the reviewed barrier registry', () => {
  const registry = buildReviewedBarrierRegistry([
    semantic('LACKTRPT:Crude', { reviewStatus: 'draft' }),
  ]);
  assert.deepEqual(registry.list(), []);
});

test('reviewed source registry remains a small explicit allowlist', () => {
  assert.deepEqual(Object.keys(REVIEWED_SOURCE_MEASURES).sort(), [
    'ACCESS2:Crude',
    'FOODINSECU:Crude',
    'HOUSINSECU:Crude',
    'HPSA_DESIGNATION',
    'LACKTRPT:Crude',
    'LONELINESS:Crude',
    'MUA_P_DESIGNATION',
    'SHUTUTILITY:Crude',
  ]);
});
