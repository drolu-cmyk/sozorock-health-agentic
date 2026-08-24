const PATHWAY_BARRIERS = Object.freeze({
  'ACCESS2:Crude': { key: 'insurance', label: 'Adults without health insurance' },
  'LACKTRPT:Crude': { key: 'transportation', label: 'Lack of reliable transportation' },
  'FOODINSECU:Crude': { key: 'food_insecurity', label: 'Food insecurity' },
  'HOUSINSECU:Crude': { key: 'housing_insecurity', label: 'Housing insecurity' },
  'SHUTUTILITY:Crude': { key: 'utility_insecurity', label: 'Utility shutoff or threat' },
  'LONELINESS:Crude': { key: 'loneliness', label: 'Loneliness' },
});

const ACCESSIBILITY_CONTEXT = Object.freeze({
  'DISABILITY:Crude': { key: 'disability', label: 'Any disability' },
});

const PLANNED_CAPACITY_DOMAINS = Object.freeze([
  {
    key: 'digital_connectivity',
    label: 'Digital connectivity',
    status: 'planned_governed_feed',
    note: 'No governed digital-connectivity value is displayed by this runtime yet.',
  },
  {
    key: 'workforce_service_capacity',
    label: 'Workforce and service capacity',
    status: 'planned_governed_feed',
    note: 'No governed workforce or service-capacity value is displayed by this runtime yet.',
  },
  {
    key: 'rural_geographic_context',
    label: 'Rural and geographic context',
    status: 'planned_governed_feed',
    note: 'No governed rural-context value is displayed by this runtime yet.',
  },
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isVerifiedCountyMeasure(measure, expectedSourceMeasureId, kind) {
  if (!measure || typeof measure !== 'object') return false;
  const semantics = measure.semantics;
  const geography = measure.geography;
  const sourceVersion = measure.source_version;
  if (!semantics || !geography || !sourceVersion) return false;
  if (semantics.source_measure_id !== expectedSourceMeasureId) return false;
  if (measure.review_status !== 'verified') return false;
  if (semantics.review_status !== 'verified') return false;
  if (geography.review_status !== 'verified') return false;
  if (sourceVersion.review_status !== 'verified') return false;
  if (geography.kind !== 'county') return false;
  if (!Array.isArray(semantics.allowed_geography_kinds) || !semantics.allowed_geography_kinds.includes('county')) return false;
  if (!finite(measure.numeric_value)) return false;

  if (kind === 'pathway_barrier') {
    return semantics.direction === 'adverse'
      && semantics.higher_value_meaning === 'adverse'
      && semantics.comparison_policy === 'higher_is_concern';
  }
  if (kind === 'accessibility_context') {
    return semantics.direction === 'contextual'
      && semantics.comparison_policy === 'context_only';
  }
  return false;
}

function confidenceInterval(measure) {
  if (!finite(measure.confidence_low) || !finite(measure.confidence_high)) return null;
  if (measure.confidence_low > measure.confidence_high) return null;
  return { low: measure.confidence_low, high: measure.confidence_high };
}

function publishedEstimate(definition, measure) {
  return {
    key: definition.key,
    label: definition.label,
    status: 'published_public_estimate',
    value: measure.numeric_value,
    unit: measure.semantics.unit,
    universe: measure.semantics.universe,
    confidenceInterval: confidenceInterval(measure),
    dataPeriod: {
      start: measure.data_period_start || null,
      end: measure.data_period_end || null,
    },
    measure: {
      definitionId: measure.semantics.id,
      sourceMeasureId: measure.semantics.source_measure_id,
      name: measure.semantics.name,
    },
    source: {
      sourceId: measure.source_version.source_id,
      sourceVersionId: measure.source_version.source_version_id,
      publisher: measure.source_version.publisher,
      title: measure.source_version.title,
      officialUrl: measure.source_version.official_url,
      releaseLabel: measure.source_version.release_label,
      releaseDate: measure.source_version.release_date,
    },
  };
}

function unavailableEstimate(definition, reason = 'No single verified compatible county estimate is available in this release.') {
  return {
    key: definition.key,
    label: definition.label,
    status: 'no_verified_data',
    value: null,
    unit: null,
    universe: null,
    confidenceInterval: null,
    reason,
  };
}

function extractDomain(measures, sourceMeasureId, definition, kind) {
  const candidates = measures.filter((measure) => isVerifiedCountyMeasure(measure, sourceMeasureId, kind));
  if (candidates.length !== 1) {
    const reason = candidates.length > 1
      ? 'Multiple verified compatible estimates were present, so the runtime did not choose one automatically.'
      : undefined;
    return unavailableEstimate(definition, reason);
  }
  return publishedEstimate(definition, candidates[0]);
}

function buildBarrierProfile(evidence) {
  const measures = Array.isArray(evidence?.package?.measures) ? evidence.package.measures : [];
  const pathwayBarriers = {};
  for (const [sourceMeasureId, definition] of Object.entries(PATHWAY_BARRIERS)) {
    pathwayBarriers[definition.key] = extractDomain(
      measures,
      sourceMeasureId,
      definition,
      'pathway_barrier',
    );
  }

  const accessibilityContext = {};
  for (const [sourceMeasureId, definition] of Object.entries(ACCESSIBILITY_CONTEXT)) {
    accessibilityContext[definition.key] = extractDomain(
      measures,
      sourceMeasureId,
      definition,
      'accessibility_context',
    );
  }

  return {
    pathwayBarriers,
    accessibilityContext,
    capacityContext: clone(PLANNED_CAPACITY_DOMAINS),
    composite: null,
    ranking: null,
    methodology: {
      version: 'cbcap-governed-barrier-profile-v1',
      rule: 'Display only reviewed county measures authorized by the governed Evidence Gateway semantic policy. Missing or unreviewed domains remain unavailable.',
      compositeScoreProduced: false,
      automaticPriorityRankingProduced: false,
    },
  };
}

function buildPlanningWorkspace(evidence, barriers) {
  const geography = evidence.package.geographies[0];
  return {
    kind: 'cbcap_county_planning_workspace_v1',
    geography: {
      id: geography.id,
      countyFips: geography.county_fips,
      name: geography.name,
      displayName: geography.display_name,
      stateFips: geography.state_fips,
      vintage: geography.vintage,
    },
    evidenceRelease: {
      contract: evidence.contract,
      releaseId: evidence.releaseId,
      releaseHash: evidence.releaseHash,
    },
    pathwayBarriers: clone(barriers.pathwayBarriers),
    accessibilityContext: clone(barriers.accessibilityContext),
    capacityContext: clone(barriers.capacityContext),
    sourceCoverage: clone(evidence.package.source_coverage || []),
    localEvidence: {
      status: 'required_for_official_planning',
      requiredCategories: [
        'community and lived-experience evidence',
        'local administrative records',
        'asset and resource inventory',
        'workforce and service-capacity evidence',
        'partner and implementation context',
      ],
    },
    chaChipWorkspace: {
      status: 'draft_evidence_organization',
      workflow: ['assess', 'validate', 'prioritize', 'act', 'measure_and_learn'],
      humanAuthorityRequiredFor: ['priority_setting', 'action_selection', 'ownership', 'approval', 'evaluation'],
      replacesOfficialChaChip: false,
    },
    fundingIntelligence: {
      status: 'not_evaluated',
      allocationDecision: 'human_only',
      note: 'This planning draft does not determine grant eligibility, award likelihood, or funding allocation.',
    },
  };
}

function buildPlanningBrief(state) {
  const pathway = Object.values(state.barriers.pathwayBarriers || {});
  const available = pathway.filter((item) => item.status === 'published_public_estimate');
  const unavailable = pathway.filter((item) => item.status !== 'published_public_estimate');

  return {
    kind: 'cbcap_county_planning_draft_v1',
    status: 'draft_requires_human_review',
    geography: clone(state.planning.geography),
    evidenceRelease: clone(state.planning.evidenceRelease),
    observedPathwayEvidence: available.map((item) => clone(item)),
    unavailablePathwayEvidence: unavailable.map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status,
      reason: item.reason || null,
    })),
    accessibilityContext: clone(state.planning.accessibilityContext),
    capacityContext: clone(state.planning.capacityContext),
    planningQuestions: [
      'Which local records and community experience confirm, qualify, or challenge these public estimates?',
      'Which assets, workforce constraints, service-capacity limits, and partner roles are still missing from the evidence record?',
      'Which issues should people and accountable institutions prioritize after reviewing the complete local evidence?',
      'What owner, measure, safeguard, and review date should accompany any human-approved action?',
    ],
    boundaries: {
      diagnosis: false,
      triage: false,
      treatmentRecommendation: false,
      individualRiskPrediction: false,
      automatedPriorityDecision: false,
      automatedFundingDecision: false,
      replacesOfficialChaChip: false,
    },
  };
}

module.exports = {
  ACCESSIBILITY_CONTEXT,
  PATHWAY_BARRIERS,
  PLANNED_CAPACITY_DOMAINS,
  buildBarrierProfile,
  buildPlanningBrief,
  buildPlanningWorkspace,
};
