const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BarrierRegistry,
  authorizeBarrierForecast,
  authorizeBarrierVisualization,
  createBarrierInteraction,
  queryBarrierEvidence,
} = require('../packages/cbcap/barrier-intelligence');

const registry = new BarrierRegistry([
  {
    semanticsId: 'measure:no-vehicle',
    barrierFamily: 'transportation_and_travel',
    coverageClass: 'national_complete',
    sourceClass: 'Census ACS household vehicle availability',
    geometryRule: 'county observations remain county observations; USPS ZIP and ZCTA are never substituted',
    reviewStatus: 'verified',
  },
  {
    semanticsId: 'measure:broadband-subscription',
    barrierFamily: 'digital_access',
    coverageClass: 'national_complete',
    sourceClass: 'Census ACS household broadband subscription',
    geometryRule: 'household adoption is distinct from FCC infrastructure availability',
    reviewStatus: 'verified',
  },
  {
    semanticsId: 'measure:places-hrsn',
    barrierFamily: 'social_connection_and_support',
    coverageClass: 'partial_coverage',
    sourceClass: 'CDC PLACES health-related social needs',
    geometryRule: 'missing source coverage remains unavailable and is never synthetically filled',
    reviewStatus: 'verified',
  },
]);

function semantics(id, name, overrides = {}) {
  return {
    id,
    source_measure_id: overrides.sourceMeasureId || id.replace('measure:', '').toUpperCase(),
    name,
    description: `${name} reviewed semantic`,
    direction: overrides.direction || 'adverse',
    higher_value_meaning: overrides.higherValueMeaning || 'adverse',
    unit: overrides.unit || 'percent',
    universe: overrides.universe || 'Civilian households',
    adjustment: 'unadjusted',
    comparison_policy: 'higher_is_concern',
    trendable: overrides.trendable === true,
    forecastable: overrides.forecastable === true,
    aggregatable: false,
    allowed_geography_kinds: ['county'],
    allowed_visualizations: overrides.allowedVisualizations || ['choropleth', 'ranked_dot'],
    review_status: 'verified',
  };
}

function measure(fips, id, semantic, numericValue, sourceId, overrides = {}) {
  const sourceVersionId = `source-version:${sourceId}:2025`;
  return {
    id: `observation:${fips}:${id}`,
    semantics: semantic,
    geography: {
      id: `county:${fips}`,
      kind: 'county',
      authority: 'census',
      authority_id: fips,
      name: `County ${fips}`,
      display_name: `County ${fips}`,
      state_fips: fips.slice(0, 2),
      county_fips: fips,
      vintage: '2025',
      valid_from: null,
      valid_to: null,
      review_status: 'verified',
      caveat: null,
    },
    source_version: {
      source_id: sourceId,
      source_version_id: sourceVersionId,
      publisher: 'Authoritative source',
      title: sourceId,
      official_url: 'https://example.invalid/source',
      release_label: '2025',
      release_date: '2025-12-01',
      data_period_start: '2024-01-01',
      data_period_end: '2024-12-31',
      retrieved_at: '2026-08-20T00:00:00Z',
      stale_after: null,
      content_hash: `sha256:${'b'.repeat(64)}`,
      schema_version: 'fixture.v1',
      review_status: 'verified',
    },
    geography_level: 'county',
    value: numericValue,
    numeric_value: numericValue,
    confidence_low: overrides.confidenceLow ?? null,
    confidence_high: overrides.confidenceHigh ?? null,
    margin_of_error: overrides.marginOfError ?? null,
    data_period_start: '2024-01-01',
    data_period_end: '2024-12-31',
    source_metadata: overrides.sourceMetadata || {},
    review_status: 'verified',
  };
}

function evidence(fips) {
  const transport = semantics('measure:no-vehicle', 'Households without a vehicle', { trendable: true });
  const broadband = semantics('measure:broadband-subscription', 'Households without broadband subscription');
  const hrsn = semantics('measure:places-hrsn', 'PLACES social-needs indicator', { universe: 'PLACES modeled population' });
  const measures = [
    measure(fips, 'no-vehicle', transport, 8.2, 'census-acs', { marginOfError: 1.1 }),
    measure(fips, 'broadband', broadband, 12.4, 'census-acs'),
    measure(fips, 'hrsn', hrsn, 6.1, 'cdc-places'),
  ];
  const sourceVersions = [...new Map(measures.map((item) => [item.source_version.source_version_id, item.source_version])).values()];
  return {
    contract: 'sozorock.evidence-gateway.v1',
    releaseId: 'release-barrier-v1',
    releaseHash: `sha256:${'a'.repeat(64)}`,
    countyFips: fips,
    sourceVersions,
    metricSemantics: [transport, broadband, hrsn],
    measures,
    sourceCoverage: [
      {
        id: `coverage:${fips}:places-hrsn`,
        source_id: 'cdc-places',
        source_version_id: 'source-version:cdc-places:2025',
        geography_id: `county:${fips}`,
        coverage_key: 'places_hrsn',
        status: 'partial',
        records_matched: 1,
        evaluated_at: '2026-08-20T00:00:00Z',
        review_status: 'verified',
        caveat: 'Partial HRSN source coverage is preserved.',
      },
    ],
  };
}

test('barrier query preserves provenance and never emits a composite score', () => {
  const result = queryBarrierEvidence(evidence('36001'), { countyFips: '36001', registry });
  assert.equal(result.contract, 'cbcap.barrier-intelligence.v1');
  assert.equal(result.compositeScore, null);
  assert.equal(result.causalInference, false);
  assert.equal(result.privateTenantStateWrittenToEvidenceCore, false);
  assert.equal(result.observations.length, 3);
  const transport = result.observations.find((item) => item.semanticsId === 'measure:no-vehicle');
  assert.equal(transport.barrierFamily, 'transportation_and_travel');
  assert.equal(transport.marginOfError, 1.1);
  assert.equal(transport.sourceVersion.source_id, 'census-acs');
});

test('partial PLACES coverage remains machine-readable rather than becoming zero or complete', () => {
  const result = queryBarrierEvidence(evidence('36001'), {
    countyFips: '36001',
    registry,
    semanticsIds: ['measure:places-hrsn'],
  });
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].coverageClass, 'partial_coverage');
  assert.equal(result.observations[0].sourceCoverage[0].status, 'partial');
});

test('transparent interactions retain component evidence IDs and refuse causal claims', () => {
  const result = queryBarrierEvidence(evidence('36001'), { countyFips: '36001', registry });
  const interaction = createBarrierInteraction({
    id: 'interaction:transport-digital',
    label: 'Transportation and digital access evidence appear together',
    observations: result.observations.slice(0, 2),
  });
  assert.deepEqual(interaction.componentEvidenceIds, [
    'observation:36001:no-vehicle',
    'observation:36001:broadband',
  ]);
  assert.equal(interaction.causalClaim, false);
  assert.equal(interaction.score, null);
});

test('all five evaluation counties use the same governed barrier contract', () => {
  for (const fips of ['36001', '36093', '36057', '42029', '48029']) {
    const result = queryBarrierEvidence(evidence(fips), { countyFips: fips, registry });
    assert.equal(result.contract, 'cbcap.barrier-intelligence.v1');
    assert.equal(result.countyFips, fips);
    assert.equal(result.observations.length, 3);
  }
});

test('visualization and forecast permissions fail closed for unregistered or unapproved metrics', () => {
  const approved = evidence('36001').metricSemantics[0];
  assert.equal(authorizeBarrierVisualization(registry, approved.id, 'ranked_dot', approved), true);
  assert.throws(() => authorizeBarrierVisualization(registry, approved.id, 'line_chart', approved), /not approved/);
  assert.throws(() => authorizeBarrierVisualization(registry, 'measure:unknown', 'ranked_dot', approved), /not registered/);
  assert.throws(() => authorizeBarrierForecast(registry, approved.id, approved), /Forecasting is not approved/);
});

test('explicit requests for unregistered metrics fail closed', () => {
  const package_ = evidence('36001');
  package_.metricSemantics.push(semantics('measure:unregistered', 'Unregistered measure'));
  package_.measures.push(measure('36001', 'unregistered', package_.metricSemantics.at(-1), 4, 'other-source'));
  package_.sourceVersions.push(package_.measures.at(-1).source_version);
  assert.throws(
    () => queryBarrierEvidence(package_, { countyFips: '36001', registry, semanticsIds: ['measure:unregistered'] }),
    /not registered/,
  );
});
