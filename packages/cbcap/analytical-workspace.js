const crypto = require('node:crypto');
const { selectVisualization } = require('./visualization-intelligence');

const WORKSPACE_CONTRACT = 'cbcap.analytical-workspace.v1';
const VALUE_STATES = new Set(['observed', 'modeled', 'derived', 'forecast', 'scenario', 'unavailable']);
const SPECIAL_QUESTIONS = new Set(['bivariate_spatial', 'service_gap']);

function requiredText(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function validateSemantics(semantics) {
  if (!semantics || typeof semantics !== 'object' || Array.isArray(semantics)) throw new Error('Reviewed metric semantics are required.');
  const normalized = {
    id: requiredText(semantics.id, 'semantics.id', 240),
    sourceMeasureId: requiredText(semantics.source_measure_id ?? semantics.sourceMeasureId, 'semantics.source_measure_id', 240),
    name: requiredText(semantics.name, 'semantics.name', 500),
    unit: requiredText(semantics.unit, 'semantics.unit', 120),
    universe: requiredText(semantics.universe, 'semantics.universe', 500),
    direction: requiredText(semantics.direction, 'semantics.direction', 80),
    comparisonPolicy: requiredText(semantics.comparison_policy ?? semantics.comparisonPolicy, 'semantics.comparison_policy', 120),
    trendable: semantics.trendable === true,
    forecastable: semantics.forecastable === true,
    aggregatable: semantics.aggregatable === true,
    allowedGeographyKinds: clone(semantics.allowed_geography_kinds ?? semantics.allowedGeographyKinds ?? []),
    allowedVisualizations: clone(semantics.allowed_visualizations ?? semantics.allowedVisualizations ?? []),
    reviewStatus: semantics.review_status ?? semantics.reviewStatus,
  };
  if (normalized.reviewStatus !== 'verified') throw new Error(`Metric ${normalized.id} is not verified.`);
  if (!Array.isArray(normalized.allowedGeographyKinds) || !Array.isArray(normalized.allowedVisualizations)) {
    throw new Error(`Metric ${normalized.id} is missing reviewed visualization permissions.`);
  }
  return normalized;
}

function validateSourceVersion(sourceVersion) {
  if (!sourceVersion || typeof sourceVersion !== 'object' || Array.isArray(sourceVersion)) throw new Error('sourceVersion is required.');
  const normalized = {
    sourceId: requiredText(sourceVersion.source_id ?? sourceVersion.sourceId, 'sourceVersion.sourceId', 240),
    sourceVersionId: requiredText(sourceVersion.source_version_id ?? sourceVersion.sourceVersionId, 'sourceVersion.sourceVersionId', 300),
    title: requiredText(sourceVersion.title, 'sourceVersion.title', 500),
    releaseLabel: requiredText(sourceVersion.release_label ?? sourceVersion.releaseLabel, 'sourceVersion.releaseLabel', 300),
    releaseDate: sourceVersion.release_date ?? sourceVersion.releaseDate ?? null,
    dataPeriodStart: sourceVersion.data_period_start ?? sourceVersion.dataPeriodStart ?? null,
    dataPeriodEnd: sourceVersion.data_period_end ?? sourceVersion.dataPeriodEnd ?? null,
    officialUrl: sourceVersion.official_url ?? sourceVersion.officialUrl ?? null,
    reviewStatus: sourceVersion.review_status ?? sourceVersion.reviewStatus,
  };
  if (normalized.reviewStatus !== 'verified') throw new Error(`Source version ${normalized.sourceVersionId} is not verified.`);
  return normalized;
}

function validateMeasure(measure) {
  if (!measure || typeof measure !== 'object' || Array.isArray(measure)) throw new Error('measure must be an object.');
  return {
    id: requiredText(measure.id, 'measure.id', 300),
    semantics: validateSemantics(measure.semantics),
    sourceVersion: validateSourceVersion(measure.sourceVersion ?? measure.source_version),
  };
}

function validateGeography(geography) {
  if (!geography || typeof geography !== 'object' || Array.isArray(geography)) throw new Error('geography must be an object.');
  const normalized = {
    id: requiredText(geography.id, 'geography.id', 240),
    kind: requiredText(geography.kind, 'geography.kind', 80),
    name: requiredText(geography.display_name ?? geography.displayName ?? geography.name, 'geography.name', 500),
    vintage: requiredText(geography.vintage, 'geography.vintage', 80),
    reviewStatus: geography.review_status ?? geography.reviewStatus,
  };
  if (normalized.reviewStatus !== 'verified') throw new Error(`Geography ${normalized.id} is not verified.`);
  return normalized;
}

function validateObservation(observation, measureIds, geographyIds) {
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw new Error('observation must be an object.');
  const measureId = requiredText(observation.measureId, 'observation.measureId', 300);
  const geographyId = requiredText(observation.geographyId, 'observation.geographyId', 240);
  if (!measureIds.has(measureId)) throw new Error(`Observation references unknown measure ${measureId}.`);
  if (!geographyIds.has(geographyId)) throw new Error(`Observation references unknown geography ${geographyId}.`);
  const valueState = requiredText(observation.valueState, 'observation.valueState', 40);
  if (!VALUE_STATES.has(valueState)) throw new Error(`Unsupported value state ${valueState}.`);
  const numericValue = observation.numericValue == null ? null : Number(observation.numericValue);
  if (numericValue !== null && !Number.isFinite(numericValue)) throw new Error('observation.numericValue must be finite or null.');
  if (valueState === 'unavailable' && numericValue !== null) throw new Error('Unavailable observations cannot carry a numeric value.');
  return {
    id: requiredText(observation.id, 'observation.id', 300),
    measureId,
    geographyId,
    value: observation.value ?? numericValue,
    numericValue,
    valueState,
    confidenceLow: observation.confidenceLow ?? null,
    confidenceHigh: observation.confidenceHigh ?? null,
    marginOfError: observation.marginOfError ?? null,
    sourceCoverageStatus: observation.sourceCoverageStatus ?? null,
    componentEvidenceIds: clone(observation.componentEvidenceIds ?? []),
    note: observation.note ?? null,
  };
}

function validateVisualizationRequest(input = {}) {
  const requestId = requiredText(input.requestId, 'requestId', 240);
  const question = requiredText(input.question, 'question', 80);
  const scope = requiredText(input.scope, 'scope', 40);
  if (!['tenant_private', 'public'].includes(scope)) throw new Error('scope must be tenant_private or public.');
  const measures = (input.measures ?? []).map(validateMeasure);
  if (!measures.length) throw new Error('At least one reviewed measure is required.');
  if (measures.length > 12) throw new Error('A workspace request may include at most 12 measures.');
  const geographies = (input.geographies ?? []).map(validateGeography);
  if (!geographies.length) throw new Error('At least one reviewed geography is required.');
  if (geographies.length > 200) throw new Error('A workspace request may include at most 200 geographies.');
  const measureIds = new Set(measures.map((item) => item.id));
  const geographyIds = new Set(geographies.map((item) => item.id));
  if (measureIds.size !== measures.length) throw new Error('Duplicate measure IDs are not allowed.');
  if (geographyIds.size !== geographies.length) throw new Error('Duplicate geography IDs are not allowed.');
  const observations = (input.observations ?? []).map((item) => validateObservation(item, measureIds, geographyIds));
  if (!observations.length) throw new Error('At least one observation is required.');

  const containsTenantPrivate = input.containsTenantPrivate === true;
  if (scope === 'public' && containsTenantPrivate && input.approvedPublicTransformation !== true) {
    throw new Error('Tenant-private layers cannot enter a public visualization without an approved transformation.');
  }

  return {
    contract: 'cbcap.visualization-request.v1',
    requestId,
    question,
    scope,
    containsTenantPrivate,
    approvedPublicTransformation: input.approvedPublicTransformation === true,
    releaseId: requiredText(input.releaseId, 'releaseId', 300),
    releaseHash: requiredText(input.releaseHash, 'releaseHash', 100),
    measures,
    geographies,
    observations,
    spatiallyMeaningful: input.spatiallyMeaningful === true,
    hasBoundaryGeometry: input.hasBoundaryGeometry === true,
    comparableVintages: input.comparableVintages !== false,
    distributionAvailable: input.distributionAvailable === true,
    relationshipEdgesAvailable: input.relationshipEdgesAvailable === true,
    normalizationStatus: input.normalizationStatus ?? 'valid',
    selectedGeographyId: input.selectedGeographyId ?? geographies[0].id,
  };
}

function measurePermission(measure, visualization) {
  if (!measure.semantics.allowedVisualizations.includes(visualization)) {
    throw new Error(`Visualization ${visualization} is not reviewed for metric ${measure.semantics.id}.`);
  }
  return true;
}

function selectBivariatePlan(request) {
  if (request.measures.length !== 2) throw new Error('A bivariate map requires exactly two reviewed measures.');
  for (const measure of request.measures) measurePermission(measure, 'bivariate_map');
  if (!request.spatiallyMeaningful || !request.hasBoundaryGeometry) throw new Error('A bivariate map requires analytically meaningful reviewed boundary geometry.');
  return {
    status: 'renderable',
    question: request.question,
    insightTitle: 'Where do the two reviewed measures appear together across the selected geographies?',
    artifactFamily: 'bivariate_map',
    primaryRoute: 'MapLibre_bivariate_county_map',
    fallbackRoute: 'two_measure_ranked_table',
    renderer: 'MapLibre_vector_tiles',
    requiredVisualizationPermissions: ['bivariate_map', 'bivariate_map'],
    legend: {
      type: 'bivariate_3x3',
      cells: [
        ['low/low', 'mid/low', 'high/low'],
        ['low/mid', 'mid/mid', 'high/mid'],
        ['low/high', 'mid/high', 'high/high'],
      ],
      decodableWithoutColor: true,
    },
    guardrails: ['exactly two reviewed measures', 'no causal interpretation', 'missing geographies use a distinct unavailable state'],
  };
}

function selectServiceGapPlan(request) {
  if (!request.spatiallyMeaningful || !request.hasBoundaryGeometry) throw new Error('A service-gap map requires reviewed geography.');
  if (!request.measures.length) throw new Error('A service-gap map requires source measures.');
  for (const measure of request.measures) measurePermission(measure, 'choropleth');
  const derived = request.observations.filter((item) => item.valueState === 'derived');
  if (!derived.length || derived.some((item) => !item.componentEvidenceIds.length)) {
    throw new Error('Service-gap logic must identify its observed component evidence IDs.');
  }
  return {
    status: 'renderable',
    question: request.question,
    insightTitle: 'Where does reviewed observed evidence indicate a service gap under the documented derived rule?',
    artifactFamily: 'service_gap_map',
    primaryRoute: 'MapLibre_observed_layers_plus_derived_gap',
    fallbackRoute: 'service_gap_evidence_table',
    renderer: 'MapLibre_vector_tiles',
    requiredVisualizationPermissions: request.measures.map(() => 'choropleth'),
    layerLedger: {
      observed: request.observations.filter((item) => ['observed', 'modeled'].includes(item.valueState)).map((item) => item.id),
      derived: derived.map((item) => ({ id: item.id, componentEvidenceIds: item.componentEvidenceIds })),
    },
    guardrails: ['derived gap logic is visibly distinct from observed source layers', 'derived is not observed', 'no causal claim'],
  };
}

function permissionForSelectedSpec(spec) {
  const map = {
    choropleth: 'choropleth',
    dot_plot: 'ranked_dot',
    interval_dot_plot: 'ranked_dot',
    distribution_plot: 'distribution',
    uncertainty_interval_plot: 'uncertainty_interval',
    scatterplot: 'scatterplot',
    bivariate_map: 'bivariate_map',
    small_multiple_line_chart: 'trend_line',
    line_chart: 'trend_line',
  };
  return map[spec.artifactFamily] ?? null;
}

function selectPlan(request) {
  if (request.question === 'bivariate_spatial') return selectBivariatePlan(request);
  if (request.question === 'service_gap') return selectServiceGapPlan(request);
  if (SPECIAL_QUESTIONS.has(request.question)) throw new Error('Unhandled special visualization question.');

  const first = request.measures[0];
  if (request.question === 'time_change' && first.semantics.trendable !== true) {
    throw new Error(`Metric ${first.semantics.id} is not reviewed for trend analysis.`);
  }
  const hasIntervals = request.observations.some((item) => item.confidenceLow != null || item.confidenceHigh != null || item.marginOfError != null);
  const spec = selectVisualization({
    question: request.question,
    measure: {
      id: first.semantics.id,
      name: first.semantics.name,
      unit: first.semantics.unit,
      direction: first.semantics.direction,
      comparisonPolicy: first.semantics.comparisonPolicy,
    },
    itemCount: request.geographies.length,
    seriesCount: request.measures.length,
    timePointCount: new Set(request.observations.map((item) => item.note).filter(Boolean)).size,
    geographyKind: request.geographies[0].kind,
    spatiallyMeaningful: request.spatiallyMeaningful,
    hasBoundaryGeometry: request.hasBoundaryGeometry,
    hasConfidenceIntervals: hasIntervals,
    hasMissingValues: request.observations.some((item) => item.valueState === 'unavailable'),
    comparableVintages: request.comparableVintages,
    distributionAvailable: request.distributionAvailable,
    relationshipEdgesAvailable: request.relationshipEdgesAvailable,
    normalizationStatus: request.normalizationStatus,
  });
  if (spec.status === 'blocked') return spec;
  const requiredPermission = permissionForSelectedSpec(spec);
  if (requiredPermission) measurePermission(first, requiredPermission);
  return { ...spec, requiredVisualizationPermissions: requiredPermission ? [requiredPermission] : [] };
}

function sourceLedger(request) {
  const byId = new Map();
  for (const measure of request.measures) {
    const source = measure.sourceVersion;
    byId.set(source.sourceVersionId, {
      sourceVersionId: source.sourceVersionId,
      sourceId: source.sourceId,
      title: source.title,
      releaseLabel: source.releaseLabel,
      releaseDate: source.releaseDate,
      dataPeriodStart: source.dataPeriodStart,
      dataPeriodEnd: source.dataPeriodEnd,
      officialUrl: source.officialUrl,
      metricIds: [],
    });
  }
  for (const measure of request.measures) byId.get(measure.sourceVersion.sourceVersionId).metricIds.push(measure.id);
  return [...byId.values()];
}

function rowForObservation(request, observation) {
  const geography = request.geographies.find((item) => item.id === observation.geographyId);
  const measure = request.measures.find((item) => item.id === observation.measureId);
  return {
    observationId: observation.id,
    geographyId: geography.id,
    geographyName: geography.name,
    geographyVintage: geography.vintage,
    measureId: measure.id,
    measureName: measure.semantics.name,
    unit: measure.semantics.unit,
    value: observation.value,
    numericValue: observation.numericValue,
    valueState: observation.valueState,
    displayValue: observation.valueState === 'unavailable'
      ? 'Unavailable'
      : `${observation.value ?? observation.numericValue}${measure.semantics.unit === 'percent' ? '%' : ''}`,
    confidenceLow: observation.confidenceLow,
    confidenceHigh: observation.confidenceHigh,
    marginOfError: observation.marginOfError,
    sourceCoverageStatus: observation.sourceCoverageStatus,
    sourceVersionId: measure.sourceVersion.sourceVersionId,
    componentEvidenceIds: clone(observation.componentEvidenceIds),
  };
}

function buildAnalyticalWorkspace(input) {
  const request = validateVisualizationRequest(input);
  const plan = selectPlan(request);
  const rows = request.observations.map((item) => rowForObservation(request, item));
  const ledger = sourceLedger(request);
  const dataFingerprint = fingerprint(rows);
  const selectedGeographyId = request.geographies.some((item) => item.id === request.selectedGeographyId)
    ? request.selectedGeographyId
    : request.geographies[0].id;
  const inspectorRows = rows.filter((item) => item.geographyId === selectedGeographyId);

  const claim = plan.insightTitle || 'Reviewed analytical evidence for the selected planning question.';
  return {
    contract: WORKSPACE_CONTRACT,
    request,
    plan: {
      contract: 'cbcap.visualization-plan.v1',
      ...clone(plan),
      sourceLedger: ledger,
      claim,
      dataFingerprint,
    },
    linkedState: {
      selectedGeographyId,
      selectedMeasureIds: request.measures.map((item) => item.id),
      primaryViewSelection: selectedGeographyId,
      comparisonSelection: selectedGeographyId,
      inspectorSelection: selectedGeographyId,
      urlState: `?geo=${encodeURIComponent(selectedGeographyId)}&measures=${encodeURIComponent(request.measures.map((item) => item.id).join(','))}`,
    },
    panels: {
      primary: {
        role: 'primary_evidence',
        renderer: plan.renderer,
        artifactFamily: plan.artifactFamily,
        rows,
      },
      comparison: {
        role: 'linked_comparison',
        renderer: plan.artifactFamily.includes('map') ? 'svg_ranked_dot' : plan.renderer,
        rows,
      },
      inspector: {
        role: 'source_and_method_inspector',
        rows: inspectorRows,
        sourceLedger: ledger,
      },
    },
    accessibleFallback: {
      type: 'table',
      caption: claim,
      rows,
      essentialValuesVisibleWithoutHover: true,
      missingValueLabel: 'Unavailable',
      uncertaintyIncluded: rows.some((row) => row.marginOfError != null || row.confidenceLow != null || row.confidenceHigh != null),
    },
    mobile: {
      readingOrder: ['primary', 'comparison', 'inspector', 'controls'],
      hoverRequired: false,
      tapOrKeyboardSelection: true,
      controlsBeforePrimaryEvidence: false,
    },
    export: {
      contract: 'cbcap.visualization-export.v1',
      claim,
      artifactFamily: plan.artifactFamily,
      rows: clone(rows),
      sourceLedger: clone(ledger),
      dataFingerprint,
      interactiveAndStaticClaimMatch: true,
    },
  };
}

function selectWorkspaceGeography(workspace, geographyId) {
  if (!workspace || workspace.contract !== WORKSPACE_CONTRACT) throw new Error('A governed analytical workspace is required.');
  if (!workspace.request.geographies.some((item) => item.id === geographyId)) throw new Error(`Unknown geography ${geographyId}.`);
  const next = clone(workspace);
  next.linkedState.selectedGeographyId = geographyId;
  next.linkedState.primaryViewSelection = geographyId;
  next.linkedState.comparisonSelection = geographyId;
  next.linkedState.inspectorSelection = geographyId;
  next.linkedState.urlState = `?geo=${encodeURIComponent(geographyId)}&measures=${encodeURIComponent(next.linkedState.selectedMeasureIds.join(','))}`;
  next.panels.inspector.rows = next.accessibleFallback.rows.filter((row) => row.geographyId === geographyId);
  return next;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function renderAccessibleWorkspaceHtml(workspace) {
  if (!workspace || workspace.contract !== WORKSPACE_CONTRACT) throw new Error('A governed analytical workspace is required.');
  const header = '<tr><th scope="col">Place</th><th scope="col">Measure</th><th scope="col">Value</th><th scope="col">State</th><th scope="col">Uncertainty</th><th scope="col">Source release</th></tr>';
  const rows = workspace.accessibleFallback.rows.map((row) => {
    const uncertainty = row.marginOfError != null
      ? `MOE ±${row.marginOfError}`
      : row.confidenceLow != null || row.confidenceHigh != null
        ? `${row.confidenceLow ?? '?'} to ${row.confidenceHigh ?? '?'}`
        : 'Not reported';
    return `<tr data-geography="${escapeHtml(row.geographyId)}"><th scope="row">${escapeHtml(row.geographyName)}</th><td>${escapeHtml(row.measureName)}</td><td>${escapeHtml(row.displayValue)}</td><td>${escapeHtml(row.valueState)}</td><td>${escapeHtml(uncertainty)}</td><td>${escapeHtml(row.sourceVersionId)}</td></tr>`;
  }).join('');
  const sources = workspace.plan.sourceLedger.map((source) => `<li><strong>${escapeHtml(source.title)}</strong> ${escapeHtml(source.releaseLabel)}${source.releaseDate ? `, ${escapeHtml(source.releaseDate)}` : ''}</li>`).join('');
  return `<section aria-labelledby="workspace-title"><h1 id="workspace-title">${escapeHtml(workspace.plan.claim)}</h1><p>Visualization: ${escapeHtml(workspace.plan.artifactFamily)}. Essential values are listed below and do not require hover or color.</p><table><caption>${escapeHtml(workspace.accessibleFallback.caption)}</caption><thead>${header}</thead><tbody>${rows}</tbody></table><h2>Sources and vintages</h2><ul>${sources}</ul></section>`;
}

module.exports = {
  VALUE_STATES,
  WORKSPACE_CONTRACT,
  buildAnalyticalWorkspace,
  fingerprint,
  renderAccessibleWorkspaceHtml,
  selectWorkspaceGeography,
  validateVisualizationRequest,
};
