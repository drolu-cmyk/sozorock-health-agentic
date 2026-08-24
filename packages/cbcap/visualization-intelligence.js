const QUESTIONS = Object.freeze([
  'spatial_pattern',
  'compare_places',
  'uncertainty',
  'time_change',
  'distribution',
  'relationship',
  'barrier_matrix',
  'planning_alignment',
  'funding_fit',
  'evidence_relationships',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function string(value, label, max = 300) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function integer(value, label, fallback = 0) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function bool(value, fallback = false) {
  return value === undefined ? fallback : value === true;
}

function base(input) {
  const question = string(input?.question, 'question', 80);
  if (!QUESTIONS.includes(question)) throw new Error('question is not a supported visualization job.');
  const measure = input?.measure && typeof input.measure === 'object' && !Array.isArray(input.measure)
    ? {
        id: string(input.measure.id, 'measure.id', 240),
        name: string(input.measure.name, 'measure.name', 500),
        unit: input.measure.unit ? string(input.measure.unit, 'measure.unit', 120) : null,
        direction: input.measure.direction ? string(input.measure.direction, 'measure.direction', 80) : null,
        comparisonPolicy: input.measure.comparisonPolicy ? string(input.measure.comparisonPolicy, 'measure.comparisonPolicy', 120) : null,
      }
    : null;
  const profile = {
    itemCount: integer(input?.itemCount, 'itemCount'),
    seriesCount: integer(input?.seriesCount, 'seriesCount'),
    timePointCount: integer(input?.timePointCount, 'timePointCount'),
    geographyKind: input?.geographyKind ? string(input.geographyKind, 'geographyKind', 80) : null,
    spatiallyMeaningful: bool(input?.spatiallyMeaningful),
    hasBoundaryGeometry: bool(input?.hasBoundaryGeometry),
    hasConfidenceIntervals: bool(input?.hasConfidenceIntervals),
    hasMissingValues: bool(input?.hasMissingValues),
    comparableVintages: bool(input?.comparableVintages),
    distributionAvailable: bool(input?.distributionAvailable),
    relationshipEdgesAvailable: bool(input?.relationshipEdgesAvailable),
    normalizationStatus: input?.normalizationStatus
      ? string(input.normalizationStatus, 'normalizationStatus', 40)
      : 'not_required',
  };
  if (!['valid', 'not_required', 'missing', 'invalid'].includes(profile.normalizationStatus)) {
    throw new Error('normalizationStatus is unsupported.');
  }
  return { question, measure, profile };
}

function shared(spec, context) {
  return {
    contract: 'cbcap.visualization.v1',
    status: spec.status || 'renderable',
    question: context.question,
    insightTitle: spec.insightTitle,
    artifactFamily: spec.artifactFamily,
    primaryRoute: spec.primaryRoute,
    fallbackRoute: spec.fallbackRoute,
    renderer: spec.renderer,
    dataProfile: clone(context.profile),
    measure: clone(context.measure),
    encodings: spec.encodings || [],
    requiredDisclosures: [
      'source and release identity',
      'data period or as-of date',
      'geography definition',
      ...(context.profile.hasMissingValues ? ['missingness is visibly distinct from zero'] : []),
      ...(context.profile.hasConfidenceIntervals ? ['confidence interval or uncertainty definition'] : []),
      ...(spec.requiredDisclosures || []),
    ],
    interaction: {
      essentialValuesVisibleWithoutHover: true,
      hoverRole: 'preview_only',
      selectionRole: 'committed_detail',
      resetRequired: true,
      urlState: ['geography', 'measure', 'comparison', 'time_range', 'selection'],
      ...(spec.interaction || {}),
    },
    mobile: {
      primaryEvidenceBeforeControls: true,
      touchTargetInspection: true,
      hoverOnlyEvidenceAllowed: false,
      filtersUseSheetOrDrawer: true,
      preserveClaimAcrossPortrait: true,
      ...(spec.mobile || {}),
    },
    accessibility: {
      nonvisualTableRequired: true,
      directLabelsPreferred: true,
      redundantEncodingRequired: true,
      keyboardInspectionRequired: true,
      grayscaleMeaningRequired: true,
      ...(spec.accessibility || {}),
    },
    export: {
      staticImage: true,
      dataTable: true,
      sourceNotes: true,
      selectionAndFilterState: true,
    },
    guardrails: [
      'no 3D perspective for ordinary quantitative comparison',
      'no rainbow magnitude scale',
      'no dual axis unless independently reviewed for a specific analytical need',
      'no decorative animation or ambient particles',
      'no missing value converted to zero',
      'no essential value available only on hover',
      ...(spec.guardrails || []),
    ],
  };
}

function comparisonRankingAllowed(measure) {
  return Boolean(measure) && measure.comparisonPolicy !== 'context_only';
}

function selectVisualization(input) {
  const context = base(input);
  const { question, measure, profile } = context;

  if (question === 'spatial_pattern') {
    if (!profile.spatiallyMeaningful || !profile.hasBoundaryGeometry) {
      return shared({
        status: 'fallback_required',
        insightTitle: 'Compare places directly; geography does not add enough analytical meaning for a map.',
        artifactFamily: 'dot_plot',
        primaryRoute: 'sorted_dot_plot',
        fallbackRoute: 'accessible_value_table',
        renderer: 'svg_or_declarative_chart',
        encodings: ['place -> y position', 'value -> x position', 'missing -> explicit missing marker'],
        guardrails: ['do not use a map merely because records have place names'],
      }, context);
    }
    if (profile.normalizationStatus === 'missing' || profile.normalizationStatus === 'invalid') {
      return shared({
        status: 'blocked',
        insightTitle: 'Spatial comparison is blocked until the measure has a defensible denominator or normalization.',
        artifactFamily: 'not_renderable',
        primaryRoute: 'normalization_review',
        fallbackRoute: 'source_value_table_without_spatial_shading',
        renderer: 'none',
        encodings: [],
        requiredDisclosures: ['normalization or denominator is unresolved'],
        guardrails: ['do not shade administrative areas by raw counts when population/exposure differs materially'],
      }, context);
    }
    return shared({
      insightTitle: measure ? `Where does ${measure.name} differ across the selected geography?` : 'Where does the selected measure differ across the map?',
      artifactFamily: 'choropleth',
      primaryRoute: 'neutral_administrative_boundary_map',
      fallbackRoute: 'sorted_dot_plot',
      renderer: 'MapLibre_vector_tiles',
      encodings: [
        'administrative area -> geometry',
        'reviewed normalized value -> ordered lightness',
        'selected area -> outline/focus state',
        'missing value -> non-quantitative missing pattern',
      ],
      interaction: {
        mapPanZoom: true,
        screenStableLabels: true,
        selectedAreaInspector: true,
      },
      mobile: {
        mapHeightMustPreserveEvidence: true,
        tapAndStepThroughSelection: true,
        twoFingerZoomOrExplicitControls: true,
      },
      guardrails: [
        'do not imply causation from geographic co-location',
        'do not rank context-only measures',
        'area shading must use reviewed measure semantics and normalization',
      ],
    }, context);
  }

  if (question === 'compare_places') {
    const ranking = comparisonRankingAllowed(measure);
    return shared({
      insightTitle: measure ? `How does ${measure.name} compare across the selected places?` : 'How do the selected places compare?',
      artifactFamily: profile.hasConfidenceIntervals ? 'interval_dot_plot' : 'dot_plot',
      primaryRoute: profile.hasConfidenceIntervals ? 'sorted_interval_dot_plot' : 'sorted_dot_plot',
      fallbackRoute: 'accessible_value_table_with_in_cell_bars',
      renderer: 'svg_or_declarative_chart',
      encodings: [
        'place -> y position',
        'estimate -> x position',
        ...(profile.hasConfidenceIntervals ? ['confidence interval -> horizontal interval'] : []),
        'missing -> explicit missing marker',
      ],
      guardrails: ranking
        ? ['sort only when the reviewed comparison policy authorizes directional comparison']
        : ['context-only measures must preserve a neutral order rather than implying best/worst'],
    }, context);
  }

  if (question === 'uncertainty') {
    if (!profile.hasConfidenceIntervals) {
      return shared({
        status: 'fallback_required',
        insightTitle: 'Show the published estimates and disclose that interval uncertainty is unavailable.',
        artifactFamily: 'dot_plot',
        primaryRoute: 'estimate_dot_plot_with_uncertainty_note',
        fallbackRoute: 'value_table',
        renderer: 'svg_or_declarative_chart',
        encodings: ['estimate -> position', 'missing -> explicit missing marker'],
        requiredDisclosures: ['confidence interval unavailable for this evidence record'],
      }, context);
    }
    return shared({
      insightTitle: measure ? `How precise are the published estimates for ${measure.name}?` : 'How precise are the published estimates?',
      artifactFamily: 'interval_dot_plot',
      primaryRoute: 'forest_style_interval_plot',
      fallbackRoute: 'table_with_estimate_and_interval_columns',
      renderer: 'svg_or_declarative_chart',
      encodings: ['estimate -> point position', 'confidence interval -> line span', 'place -> row'],
      requiredDisclosures: ['interval level and source methodology'],
      guardrails: ['do not hide intervals behind tooltips', 'do not interpret overlapping intervals as a formal significance test'],
    }, context);
  }

  if (question === 'time_change') {
    if (!profile.comparableVintages || profile.timePointCount < 2) {
      return shared({
        status: 'blocked',
        insightTitle: 'A trend is not shown because the releases are not proven comparable over time.',
        artifactFamily: 'release_comparison_table',
        primaryRoute: 'release_by_release_table',
        fallbackRoute: 'small_multiple_release_cards',
        renderer: 'html_table_or_svg',
        encodings: ['release -> row/column', 'estimate -> text/position'],
        requiredDisclosures: ['comparability review failed or is incomplete'],
        guardrails: ['never draw a connecting line across incompatible vintages, definitions, geographies, or methods'],
      }, context);
    }
    return shared({
      insightTitle: measure ? `How has ${measure.name} changed across comparable releases?` : 'How has the measure changed across comparable releases?',
      artifactFamily: profile.seriesCount > 1 ? 'small_multiple_line_chart' : 'line_chart',
      primaryRoute: profile.seriesCount > 1 ? 'small_multiples' : 'single_series_line',
      fallbackRoute: 'release_value_table',
      renderer: 'svg_or_declarative_chart',
      encodings: ['time/release -> x position', 'estimate -> y position', 'series/place -> separate panel or direct label'],
      guardrails: ['do not smooth unless a reviewed analytical method explicitly requires it', 'preserve data-period and methodology changes in annotations'],
    }, context);
  }

  if (question === 'distribution') {
    if (!profile.distributionAvailable) {
      return shared({
        status: 'blocked',
        insightTitle: 'A distribution view is not shown because only summary estimates are available.',
        artifactFamily: 'summary_table',
        primaryRoute: 'estimate_table',
        fallbackRoute: 'dot_plot',
        renderer: 'html_table_or_svg',
        encodings: ['estimate -> text/position'],
        guardrails: ['do not fabricate a distribution from aggregate point estimates'],
      }, context);
    }
    return shared({
      insightTitle: 'What does the distribution show beyond the average?',
      artifactFamily: 'histogram_or_box_plot',
      primaryRoute: profile.itemCount > 50 ? 'histogram_with_summary' : 'box_plot_with_points',
      fallbackRoute: 'quantile_table',
      renderer: 'svg_or_declarative_chart',
      encodings: ['value -> position/bin', 'frequency or observations -> count/marks'],
      guardrails: ['show sample size', 'avoid density curves when sample size or bandwidth makes the shape unstable'],
    }, context);
  }

  if (question === 'relationship') {
    return shared({
      insightTitle: 'How do the two reviewed measures vary together?',
      artifactFamily: 'scatter_plot',
      primaryRoute: 'annotated_scatter_plot',
      fallbackRoute: 'paired_value_table',
      renderer: 'svg_or_declarative_chart',
      encodings: ['measure A -> x position', 'measure B -> y position', 'place -> point/label'],
      guardrails: ['association is not causation', 'no fitted line unless its method and uncertainty are explicitly reviewed'],
    }, context);
  }

  if (question === 'barrier_matrix') {
    return shared({
      insightTitle: 'Which barrier domains recur across the selected places, and where is evidence missing?',
      artifactFamily: 'matrix_heatmap',
      primaryRoute: 'place_by_barrier_matrix',
      fallbackRoute: 'accessible_matrix_table',
      renderer: 'svg_canvas_or_html_matrix',
      encodings: [
        'place -> row',
        'barrier domain -> column',
        'reviewed comparable magnitude -> ordered lightness',
        'missing/unavailable -> separate non-quantitative glyph or pattern',
      ],
      guardrails: [
        'do not mix incompatible units in one quantitative color scale',
        'do not turn missing values into the lightest magnitude',
        'do not create a composite barrier score unless a separately governed methodology exists',
      ],
    }, context);
  }

  if (question === 'planning_alignment') {
    return shared({
      insightTitle: 'Which reviewed local-plan claims have cited evidence, and which evidence-record categories remain incomplete?',
      artifactFamily: 'evidence_alignment_matrix',
      primaryRoute: 'claim_type_by_document_matrix_with_locator_detail',
      fallbackRoute: 'grouped_evidence_table',
      renderer: 'html_table_with_in_cell_graphics',
      encodings: ['document -> row/group', 'claim type -> column', 'verified cited claim -> mark/count', 'gap -> explicit evidence-record gap marker'],
      guardrails: ['evidence-record gaps are not proof the official plan omits a topic', 'do not infer semantic conflicts without a governed relationship'],
    }, context);
  }

  if (question === 'funding_fit') {
    return shared({
      insightTitle: 'Which reviewed opportunity requirements are matched, incomplete, conflicting, or still unknown?',
      artifactFamily: 'funding_criteria_matrix',
      primaryRoute: 'criterion_status_table_with_evidence_links',
      fallbackRoute: 'accessible_criterion_list',
      renderer: 'html_table_with_in_cell_status_marks',
      encodings: ['criterion -> row', 'status -> redundant icon/text treatment', 'source lineage -> linked detail', 'missing partner/evidence -> explicit identifier list'],
      guardrails: ['no gauge or single funding score', 'no eligibility verdict', 'no award probability', 'no funding allocation recommendation'],
    }, context);
  }

  if (question === 'evidence_relationships') {
    if (!profile.relationshipEdgesAvailable) {
      return shared({
        status: 'blocked',
        insightTitle: 'A relationship graph is not shown because governed relationship edges are unavailable.',
        artifactFamily: 'evidence_table',
        primaryRoute: 'source_claim_table',
        fallbackRoute: 'source_claim_table',
        renderer: 'html_table',
        encodings: ['evidence item -> row', 'source/release -> columns'],
        guardrails: ['do not infer edges from textual similarity alone'],
      }, context);
    }
    return shared({
      insightTitle: 'How do reviewed evidence items, local-plan claims, and decision artifacts connect?',
      artifactFamily: 'node_link_evidence_graph',
      primaryRoute: 'layered_directed_graph',
      fallbackRoute: 'adjacency_table',
      renderer: 'svg_or_canvas_graph',
      encodings: ['entity type -> node shape/label', 'reviewed relationship -> edge', 'evidence status -> redundant state marker'],
      interaction: { nodeSelectionInspector: true, hoverRole: 'preview_only' },
      guardrails: ['every edge must have a governed relationship type and provenance', 'no decorative force layout when a layered reading order is clearer'],
    }, context);
  }

  throw new Error('Unhandled visualization question.');
}

module.exports = {
  QUESTIONS,
  selectVisualization,
};
