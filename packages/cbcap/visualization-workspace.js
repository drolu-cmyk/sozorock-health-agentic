const { createHash } = require('node:crypto');
const { buildReviewedBarrierRegistry } = require('./barrier-registry');
const {
  authorizeBarrierVisualization,
  queryBarrierEvidence,
} = require('./barrier-intelligence');
const { selectVisualization } = require('./visualization-intelligence');

const VISUALIZATION_WORKSPACE_CONTRACT = 'cbcap.visualization-workspace.v1';
const MAX_COUNTIES = 25;
const EVALUATION_COUNTY_FIPS = Object.freeze(['36001', '36093', '36057', '42029', '48029']);
const SUPPORTED_QUESTIONS = Object.freeze([
  'spatial_pattern',
  'compare_places',
  'uncertainty',
  'time_change',
  'relationship',
  'barrier_matrix',
  'bivariate_map',
  'service_gap',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function text(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function uniqueStrings(values, label, maxItems) {
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must be a non-empty array.`);
  if (values.length > maxItems) throw new Error(`${label} exceeds the supported workspace limit.`);
  const normalized = values.map((value) => text(value, label, 240));
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} must not contain duplicates.`);
  return normalized;
}

function validateCountyFips(countyFips) {
  if (!/^\d{5}$/.test(countyFips)) throw new Error(`Invalid county FIPS ${countyFips}.`);
  return countyFips;
}

function normalizeEvidencePackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0) throw new Error('Visualization workspace requires Evidence Gateway packages.');
  if (packages.length > MAX_COUNTIES) throw new Error('Visualization workspace exceeds the county limit.');
  const counties = new Set();
  const releaseIds = new Set();
  return packages.map((evidence) => {
    if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) throw new Error('Evidence package must be an object.');
    const countyFips = validateCountyFips(text(evidence.countyFips, 'evidence.countyFips', 5));
    if (counties.has(countyFips)) throw new Error(`Duplicate county package ${countyFips}.`);
    counties.add(countyFips);
    const releaseId = text(evidence.releaseId, 'evidence.releaseId', 300);
    releaseIds.add(releaseId);
    text(evidence.releaseHash, 'evidence.releaseHash', 100);
    for (const field of ['metricSemantics', 'measures', 'sourceVersions', 'sourceCoverage']) {
      if (!Array.isArray(evidence[field])) throw new Error(`evidence.${field} must be an array.`);
    }
    return evidence;
  }).map(clone).map((evidence) => ({ ...evidence }));
}

function assertReleaseCompatibility(packages) {
  const releaseIds = new Set(packages.map((evidence) => evidence.releaseId));
  if (releaseIds.size !== 1) throw new Error('Visualization workspace cannot mix Evidence Gateway release IDs.');
  return [...releaseIds][0];
}

function semanticsForSource(evidence, sourceMeasureId) {
  const matches = evidence.metricSemantics.filter((item) => item?.source_measure_id === sourceMeasureId && item?.review_status === 'verified');
  if (matches.length !== 1) throw new Error(`Reviewed semantics for ${sourceMeasureId} are not uniquely available in county ${evidence.countyFips}.`);
  return matches[0];
}

function observationForSource(evidence, sourceMeasureId) {
  const matches = evidence.measures.filter((item) => item?.semantics?.source_measure_id === sourceMeasureId && item?.review_status === 'verified');
  if (matches.length > 1) throw new Error(`Multiple reviewed observations for ${sourceMeasureId} exist in county ${evidence.countyFips}.`);
  return matches[0] || null;
}

function allowedPermission(question, hasIntervals) {
  if (question === 'spatial_pattern') return 'choropleth';
  if (question === 'compare_places') return hasIntervals ? 'uncertainty_interval' : 'ranked_dot';
  if (question === 'uncertainty') return 'uncertainty_interval';
  if (question === 'time_change') return 'trend_line';
  if (question === 'relationship') return 'scatterplot';
  if (question === 'barrier_matrix') return 'barrier_matrix';
  if (question === 'bivariate_map') return 'bivariate_map';
  if (question === 'service_gap') return 'service_gap';
  throw new Error(`No semantic permission is defined for ${question}.`);
}

function profileFor(question, rows) {
  const observations = rows.flatMap((row) => row.values.filter((value) => value.observation));
  const hasIntervals = observations.some((value) => value.observation.confidenceLow !== null || value.observation.confidenceHigh !== null || value.observation.marginOfError !== null);
  const hasMissingValues = rows.some((row) => row.values.some((value) => value.state !== 'observed'));
  const primary = observations[0]?.observation || null;
  return {
    itemCount: rows.length,
    seriesCount: rows[0]?.values?.length || 0,
    timePointCount: 1,
    geographyKind: 'county',
    spatiallyMeaningful: true,
    hasBoundaryGeometry: true,
    hasConfidenceIntervals: hasIntervals,
    hasMissingValues,
    comparableVintages: false,
    distributionAvailable: false,
    relationshipEdgesAvailable: false,
    normalizationStatus: primary && ['count', 'people'].includes(primary.unit) ? 'missing' : 'valid',
    question,
  };
}

function coverageState(evidence, sourceMeasureId) {
  const sourceVersionIds = new Set(
    evidence.sourceVersions
      .filter((item) => item?.source_id && item?.source_version_id)
      .map((item) => item.source_version_id),
  );
  const assertions = evidence.sourceCoverage.filter((item) => sourceVersionIds.has(item?.source_version_id));
  if (assertions.some((item) => item?.status === 'partial')) return 'unavailable_partial_coverage';
  if (assertions.some((item) => item?.status === 'unavailable')) return 'unavailable';
  if (assertions.some((item) => item?.status === 'stale')) return 'stale';
  if (assertions.some((item) => item?.status === 'complete_no_records')) return 'complete_no_records';
  return `unavailable_${sourceMeasureId}`;
}

function buildRows(packages, sourceMeasureIds) {
  return packages.map((evidence) => {
    const values = sourceMeasureIds.map((sourceMeasureId) => {
      const semantics = semanticsForSource(evidence, sourceMeasureId);
      const registry = buildReviewedBarrierRegistry(evidence.metricSemantics);
      const observation = observationForSource(evidence, sourceMeasureId);
      if (!observation) {
        registry.require(semantics.id);
        return {
          sourceMeasureId,
          semanticsId: semantics.id,
          state: coverageState(evidence, sourceMeasureId),
          value: null,
          numericValue: null,
          observation: null,
        };
      }
      const barrierResult = queryBarrierEvidence(evidence, {
        countyFips: evidence.countyFips,
        registry,
        semanticsIds: [semantics.id],
      });
      const normalized = barrierResult.observations[0];
      if (!normalized) throw new Error(`Registered barrier observation ${sourceMeasureId} was not returned for ${evidence.countyFips}.`);
      return {
        sourceMeasureId,
        semanticsId: semantics.id,
        state: normalized.value === null ? 'missing' : 'observed',
        value: clone(normalized.value),
        numericValue: normalized.numericValue,
        observation: normalized,
      };
    });
    const geography = values.find((value) => value.observation)?.observation?.geography || null;
    return { countyFips: evidence.countyFips, geography: clone(geography), values };
  });
}

function authorizeWorkspace(packages, sourceMeasureIds, question, hasIntervals) {
  const permission = allowedPermission(question, hasIntervals);
  for (const evidence of packages) {
    const registry = buildReviewedBarrierRegistry(evidence.metricSemantics);
    for (const sourceMeasureId of sourceMeasureIds) {
      const semantics = semanticsForSource(evidence, sourceMeasureId);
      authorizeBarrierVisualization(registry, semantics.id, permission, semantics);
      if (question === 'time_change' && semantics.trendable !== true) {
        throw new Error(`Trend visualization is not approved for ${sourceMeasureId}.`);
      }
    }
  }
  return permission;
}

function primaryMeasure(rows) {
  const observation = rows.flatMap((row) => row.values).find((value) => value.observation)?.observation;
  if (!observation) return null;
  return {
    id: observation.semanticsId,
    name: observation.name,
    unit: observation.unit,
    direction: observation.direction,
    comparisonPolicy: observation.comparisonPolicy,
  };
}

function buildBivariatePlan(profile, rows) {
  const observed = rows.flatMap((row) => row.values).filter((value) => value.observation);
  const names = [...new Set(observed.map((value) => value.observation.name))];
  if (names.length !== 2) throw new Error('Bivariate map requires exactly two reviewed measures.');
  return {
    contract: 'cbcap.visualization.v1',
    status: 'renderable',
    question: 'bivariate_map',
    insightTitle: `Where do ${names[0]} and ${names[1]} appear together across the selected counties?`,
    artifactFamily: 'bivariate_choropleth',
    primaryRoute: 'two_measure_bivariate_county_map',
    fallbackRoute: 'paired_value_table_with_bivariate_class',
    renderer: 'MapLibre_vector_tiles',
    dataProfile: clone(profile),
    encodings: ['county -> geometry', 'measure A quantile -> bivariate axis A', 'measure B quantile -> bivariate axis B', 'missing -> non-quantitative missing pattern'],
    legend: { type: 'bivariate_matrix', dimensions: [3, 3], directAxisLabels: true, exactlyTwoMeasures: true },
    interaction: { essentialValuesVisibleWithoutHover: true, selectedAreaInspector: true, resetRequired: true },
    mobile: { primaryEvidenceBeforeControls: true, tapAndStepThroughSelection: true, preserveClaimAcrossPortrait: true },
    accessibility: { nonvisualTableRequired: true, redundantEncodingRequired: true, grayscaleMeaningRequired: true },
    export: { staticImage: true, dataTable: true, sourceNotes: true, selectionAndFilterState: true },
    requiredDisclosures: ['source and release identity', 'both measure definitions', 'bivariate class thresholds', 'geography definition', ...(profile.hasMissingValues ? ['missingness is visibly distinct from zero'] : [])],
    guardrails: ['exactly two reviewed measures', 'no causal claim from geographic co-location', 'no composite barrier score', 'legend must be decodable without hover'],
  };
}

function buildServiceGapPlan(profile, rows) {
  const observed = rows.flatMap((row) => row.values).filter((value) => value.observation);
  const names = [...new Set(observed.map((value) => value.observation.name))];
  if (names.length !== 2) throw new Error('Service-gap view requires exactly two reviewed evidence layers.');
  return {
    contract: 'cbcap.visualization.v1',
    status: 'renderable',
    question: 'service_gap',
    insightTitle: `Where does reviewed ${names[0]} evidence overlap with ${names[1]} context?`,
    artifactFamily: 'service_gap_map',
    primaryRoute: 'observed_layers_plus_rule_based_gap_overlay',
    fallbackRoute: 'county_service_gap_evidence_table',
    renderer: 'MapLibre_vector_tiles',
    dataProfile: clone(profile),
    layers: {
      observed: names.map((name) => ({ name, evidenceType: 'observed_or_official_designation' })),
      derived: { evidenceType: 'derived_rule', score: null, causal: false, sourceObservationsRequired: true },
    },
    encodings: ['county -> geometry', 'observed source layer -> direct symbol or ordered fill', 'derived service-gap rule -> outlined overlay', 'missing -> non-quantitative missing pattern'],
    interaction: { essentialValuesVisibleWithoutHover: true, selectedAreaInspector: true, resetRequired: true },
    mobile: { primaryEvidenceBeforeControls: true, tapAndStepThroughSelection: true, preserveClaimAcrossPortrait: true },
    accessibility: { nonvisualTableRequired: true, redundantEncodingRequired: true, grayscaleMeaningRequired: true },
    export: { staticImage: true, dataTable: true, sourceNotes: true, selectionAndFilterState: true },
    requiredDisclosures: ['observed and derived layers are visibly distinct', 'source and release identity', 'derivation rule', 'geography definition'],
    guardrails: ['derived service-gap overlay must never be presented as observed source data', 'no causal claim', 'no universal gap score', 'missing is never zero'],
  };
}

function buildPlan(question, rows, profile) {
  if (question === 'bivariate_map') return buildBivariatePlan(profile, rows);
  if (question === 'service_gap') return buildServiceGapPlan(profile, rows);
  return selectVisualization({
    question,
    measure: primaryMeasure(rows),
    itemCount: profile.itemCount,
    seriesCount: profile.seriesCount,
    timePointCount: profile.timePointCount,
    geographyKind: profile.geographyKind,
    spatiallyMeaningful: profile.spatiallyMeaningful,
    hasBoundaryGeometry: profile.hasBoundaryGeometry,
    hasConfidenceIntervals: profile.hasConfidenceIntervals,
    hasMissingValues: profile.hasMissingValues,
    comparableVintages: profile.comparableVintages,
    distributionAvailable: profile.distributionAvailable,
    relationshipEdgesAvailable: profile.relationshipEdgesAvailable,
    normalizationStatus: profile.normalizationStatus,
  });
}

function sourceLedger(packages, rows) {
  const sources = new Map();
  const semantics = new Map();
  const observations = [];
  for (const evidence of packages) {
    for (const source of evidence.sourceVersions) {
      if (!source?.source_version_id) continue;
      sources.set(source.source_version_id, clone(source));
    }
    for (const semantic of evidence.metricSemantics) {
      if (!semantic?.id) continue;
      semantics.set(semantic.id, clone(semantic));
    }
  }
  for (const row of rows) {
    for (const value of row.values) {
      if (!value.observation) continue;
      observations.push({
        countyFips: row.countyFips,
        observationId: value.observation.observationId,
        semanticsId: value.observation.semanticsId,
        sourceMeasureId: value.observation.sourceMeasureId,
        sourceVersionId: value.observation.sourceVersion?.source_version_id || null,
        dataPeriodStart: value.observation.dataPeriodStart,
        dataPeriodEnd: value.observation.dataPeriodEnd,
        reviewStatus: value.observation.reviewStatus,
      });
    }
  }
  return {
    packages: packages.map((evidence) => ({ countyFips: evidence.countyFips, releaseId: evidence.releaseId, releaseHash: evidence.releaseHash })),
    sourceVersions: [...sources.values()],
    metricSemantics: [...semantics.values()],
    observations,
  };
}

function claimId(input) {
  const canonical = JSON.stringify(input);
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function buildVisualizationWorkspace(input = {}) {
  const question = text(input.question, 'question', 80);
  if (!SUPPORTED_QUESTIONS.includes(question)) throw new Error(`Unsupported visualization workspace question ${question}.`);
  const packages = normalizeEvidencePackages(input.evidencePackages);
  const releaseId = assertReleaseCompatibility(packages);
  const sourceMeasureIds = uniqueStrings(input.sourceMeasureIds, 'sourceMeasureIds', 8);
  if (['relationship', 'bivariate_map', 'service_gap'].includes(question) && sourceMeasureIds.length !== 2) {
    throw new Error(`${question} requires exactly two reviewed source measures.`);
  }
  if (!['relationship', 'bivariate_map', 'service_gap', 'barrier_matrix'].includes(question) && sourceMeasureIds.length !== 1) {
    throw new Error(`${question} requires exactly one reviewed source measure.`);
  }
  const rows = buildRows(packages, sourceMeasureIds);
  const profile = profileFor(question, rows);
  const permission = authorizeWorkspace(packages, sourceMeasureIds, question, profile.hasConfidenceIntervals);
  const plan = buildPlan(question, rows, profile);
  if (plan.status === 'blocked') throw new Error(`Visualization plan is blocked: ${plan.insightTitle}`);
  const countyFips = rows.map((row) => row.countyFips);
  const selectedCountyFips = input.selectedCountyFips
    ? validateCountyFips(text(input.selectedCountyFips, 'selectedCountyFips', 5))
    : countyFips[0];
  if (!countyFips.includes(selectedCountyFips)) throw new Error('selectedCountyFips must be part of the workspace county set.');
  const ledger = sourceLedger(packages, rows);
  const stableClaim = {
    contract: VISUALIZATION_WORKSPACE_CONTRACT,
    releaseId,
    question,
    sourceMeasureIds,
    countyFips,
    rows: rows.map((row) => ({
      countyFips: row.countyFips,
      values: row.values.map((value) => ({
        sourceMeasureId: value.sourceMeasureId,
        state: value.state,
        value: value.value,
        numericValue: value.numericValue,
        observationId: value.observation?.observationId || null,
      })),
    })),
  };
  const artifactClaimId = claimId(stableClaim);

  return {
    contract: VISUALIZATION_WORKSPACE_CONTRACT,
    releaseId,
    permission,
    question,
    sourceMeasureIds,
    countyFips,
    plan,
    data: rows,
    ledger,
    linkedState: {
      selectedCountyFips,
      selectedSourceMeasureId: sourceMeasureIds[0],
      comparisonCountyFips: countyFips.filter((item) => item !== selectedCountyFips),
      inspector: { countyFips: selectedCountyFips, sourceMeasureId: sourceMeasureIds[0] },
      clearSelection: { selectedCountyFips: null, inspector: null },
      urlBackedKeys: ['question', 'counties', 'measure', 'measure2', 'selected'],
      pushStateKeys: ['selected', 'measure', 'measure2'],
      replaceStateKeys: ['map_bounds', 'hover_preview'],
    },
    mobile: {
      portraitOrder: ['insight_title', 'primary_visual', 'active_state_summary', 'details_sheet'],
      controls: 'sheet_or_drawer',
      hoverRequired: false,
      keyboardMayCoverPrimaryVisual: false,
      landscapeSupportedForWideMaps: ['spatial_pattern', 'bivariate_map', 'service_gap'].includes(question),
    },
    accessibility: {
      tableFallbackRequired: true,
      essentialValuesVisibleWithoutHover: true,
      keyboardInspectionRequired: true,
      colorAloneNeverCarriesState: true,
    },
    export: {
      claimId: artifactClaimId,
      staticFallback: plan.fallbackRoute,
      preserveSelectionAndFilterState: true,
      includeSourceLedger: true,
      includeDataTable: true,
      sameAnalyticalClaimRequired: true,
    },
    claimId: artifactClaimId,
    compositeScore: null,
    causalInference: false,
    privateTenantStateWrittenToEvidenceCore: false,
  };
}

module.exports = {
  EVALUATION_COUNTY_FIPS,
  MAX_COUNTIES,
  SUPPORTED_QUESTIONS,
  VISUALIZATION_WORKSPACE_CONTRACT,
  buildVisualizationWorkspace,
};
