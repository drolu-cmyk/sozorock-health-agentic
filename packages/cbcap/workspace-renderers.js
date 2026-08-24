const VISUALIZATION_WORKSPACE_CONTRACT = 'cbcap.visualization-workspace.v1';

function assertWorkspace(workspace) {
  if (!workspace || workspace.contract !== VISUALIZATION_WORKSPACE_CONTRACT) {
    throw new Error('A governed Evidence Gateway visualization workspace is required.');
  }
  if (!Array.isArray(workspace.data) || !workspace.plan || !workspace.ledger || !workspace.claimId) {
    throw new Error('Visualization workspace is incomplete.');
  }
}

function escapeMarkup(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function reviewedSemantic(workspace, value) {
  return workspace.ledger.metricSemantics.find((item) => (
    item?.id === value.semanticsId || item?.source_measure_id === value.sourceMeasureId
  )) || null;
}

function flattenWorkspaceRows(workspace) {
  assertWorkspace(workspace);
  return workspace.data.flatMap((countyRow) => countyRow.values.map((value) => {
    const observation = value.observation || null;
    const geography = observation?.geography || countyRow.geography || null;
    const semantics = reviewedSemantic(workspace, value);
    const sourceVersion = observation?.sourceVersion || null;
    const numericValue = value.numericValue ?? observation?.numericValue ?? null;
    const rawValue = value.value ?? observation?.value ?? null;
    const state = value.state || (observation ? 'observed' : 'unavailable');
    const unavailable = !observation && numericValue === null && rawValue === null;
    const unit = observation?.unit || semantics?.unit || null;
    const displayValue = unavailable
      ? 'Unavailable'
      : numericValue !== null && unit === 'percent'
        ? `${numericValue}%`
        : String(rawValue ?? numericValue ?? 'Unavailable');
    return {
      countyFips: countyRow.countyFips,
      geographyId: geography?.id || `county:${countyRow.countyFips}`,
      geographyName: geography?.display_name || geography?.displayName || geography?.name || `County ${countyRow.countyFips}`,
      geographyVintage: geography?.vintage || null,
      sourceMeasureId: value.sourceMeasureId,
      semanticsId: value.semanticsId,
      measureName: observation?.name || semantics?.name || value.sourceMeasureId,
      unit,
      value: rawValue,
      numericValue,
      state,
      displayValue,
      observationId: observation?.observationId || null,
      confidenceLow: observation?.confidenceLow ?? null,
      confidenceHigh: observation?.confidenceHigh ?? null,
      marginOfError: observation?.marginOfError ?? null,
      sourceVersionId: sourceVersion?.source_version_id || null,
      sourceCoverage: observation?.sourceCoverage || [],
    };
  }));
}

function workspaceClaim(workspace) {
  return workspace.plan.insightTitle || `Reviewed ${workspace.question} evidence for the selected counties.`;
}

function renderAccessibleWorkspaceHtml(workspace) {
  const rows = flattenWorkspaceRows(workspace);
  const body = rows.map((row) => {
    const uncertainty = row.marginOfError !== null
      ? `MOE ±${row.marginOfError}`
      : row.confidenceLow !== null || row.confidenceHigh !== null
        ? `${row.confidenceLow ?? '?'} to ${row.confidenceHigh ?? '?'}`
        : 'Not reported';
    return `<tr data-county-fips="${escapeMarkup(row.countyFips)}"><th scope="row">${escapeMarkup(row.geographyName)}</th><td>${escapeMarkup(row.measureName)}</td><td>${escapeMarkup(row.displayValue)}</td><td>${escapeMarkup(row.state)}</td><td>${escapeMarkup(uncertainty)}</td><td>${escapeMarkup(row.sourceVersionId || 'See source ledger')}</td></tr>`;
  }).join('');
  const sources = workspace.ledger.sourceVersions.map((source) => (
    `<li><strong>${escapeMarkup(source.title || source.source_id)}</strong>${source.release_label ? ` ${escapeMarkup(source.release_label)}` : ''}${source.release_date ? `, ${escapeMarkup(source.release_date)}` : ''}</li>`
  )).join('');
  return `<section aria-labelledby="workspace-title"><h1 id="workspace-title">${escapeMarkup(workspaceClaim(workspace))}</h1><p>Essential values, missingness, uncertainty, and source releases are available without hover or color.</p><table><caption>${escapeMarkup(workspaceClaim(workspace))}</caption><thead><tr><th scope="col">Place</th><th scope="col">Measure</th><th scope="col">Value</th><th scope="col">State</th><th scope="col">Uncertainty</th><th scope="col">Source release</th></tr></thead><tbody>${body}</tbody></table><h2>Sources and vintages</h2><ul>${sources}</ul></section>`;
}

function renderRankedDotSvg(workspace, options = {}) {
  const allRows = flattenWorkspaceRows(workspace);
  const sourceMeasureId = workspace.linkedState?.selectedSourceMeasureId || workspace.sourceMeasureIds[0];
  const rows = allRows
    .filter((row) => row.sourceMeasureId === sourceMeasureId)
    .sort((a, b) => {
      if (a.numericValue === null) return 1;
      if (b.numericValue === null) return -1;
      return b.numericValue - a.numericValue;
    });
  const width = Number.isFinite(options.width) ? Math.max(520, options.width) : 820;
  const rowHeight = 40;
  const left = 260;
  const right = 150;
  const top = 56;
  const numericRows = rows.filter((row) => row.numericValue !== null);
  const intervalBounds = numericRows.flatMap((row) => [
    row.confidenceLow ?? (row.marginOfError !== null ? row.numericValue - row.marginOfError : row.numericValue),
    row.confidenceHigh ?? (row.marginOfError !== null ? row.numericValue + row.marginOfError : row.numericValue),
  ]).filter(Number.isFinite);
  const min = intervalBounds.length ? Math.min(...intervalBounds) : 0;
  const max = intervalBounds.length ? Math.max(...intervalBounds) : 1;
  const span = max === min ? 1 : max - min;
  const plotWidth = width - left - right;
  const x = (value) => left + ((value - min) / span) * plotWidth;
  const height = top + rows.length * rowHeight + 50;
  const marks = rows.map((row, index) => {
    const y = top + index * rowHeight;
    const label = escapeMarkup(row.geographyName);
    if (row.numericValue === null) {
      return `<g data-county-fips="${escapeMarkup(row.countyFips)}"><text x="16" y="${y}" dominant-baseline="middle">${label}</text><text x="${left}" y="${y}" dominant-baseline="middle">Unavailable</text></g>`;
    }
    const cx = x(row.numericValue);
    const low = row.confidenceLow ?? (row.marginOfError !== null ? row.numericValue - row.marginOfError : null);
    const high = row.confidenceHigh ?? (row.marginOfError !== null ? row.numericValue + row.marginOfError : null);
    const interval = low !== null && high !== null
      ? `<line x1="${x(low).toFixed(2)}" x2="${x(high).toFixed(2)}" y1="${y}" y2="${y}" stroke="currentColor" stroke-width="2" />`
      : '';
    return `<g data-county-fips="${escapeMarkup(row.countyFips)}"><text x="16" y="${y}" dominant-baseline="middle">${label}</text>${interval}<circle cx="${cx.toFixed(2)}" cy="${y}" r="5" fill="currentColor" /><text x="${(cx + 12).toFixed(2)}" y="${y}" dominant-baseline="middle">${escapeMarkup(row.displayValue)}</text></g>`;
  }).join('');
  const title = escapeMarkup(workspaceClaim(workspace));
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-title chart-desc" viewBox="0 0 ${width} ${height}"><title id="chart-title">${title}</title><desc id="chart-desc">Direct-labeled county comparison with explicit unavailable values and uncertainty intervals when reviewed evidence provides them.</desc><text x="16" y="26" font-weight="700">${title}</text>${marks}</svg>`;
}

function renderBivariateLegendSvg(workspace) {
  assertWorkspace(workspace);
  if (!['bivariate_map', 'bivariate_choropleth'].includes(workspace.plan.artifactFamily)) {
    throw new Error('Bivariate legend renderer requires a bivariate workspace.');
  }
  const first = escapeMarkup(workspace.sourceMeasureIds[0] || 'Measure 1');
  const second = escapeMarkup(workspace.sourceMeasureIds[1] || 'Measure 2');
  const levels = ['Low', 'Middle', 'High'];
  const cell = 88;
  const left = 120;
  const top = 26;
  const cells = levels.flatMap((vertical, rowIndex) => levels.map((horizontal, columnIndex) => {
    const x = left + columnIndex * cell;
    const y = top + (2 - rowIndex) * cell;
    const label = `${horizontal} ${first} / ${vertical} ${second}`;
    return `<g><rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="none" stroke="currentColor" /><text x="${x + cell / 2}" y="${y + cell / 2 - 8}" text-anchor="middle">${escapeMarkup(horizontal)}</text><text x="${x + cell / 2}" y="${y + cell / 2 + 10}" text-anchor="middle">${escapeMarkup(vertical)}</text><title>${escapeMarkup(label)}</title></g>`;
  })).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bivariate three by three legend with text labels" viewBox="0 0 430 330">${cells}<text x="${left + cell * 1.5}" y="318" text-anchor="middle">${first} →</text><text transform="translate(24 ${top + cell * 1.5}) rotate(-90)" text-anchor="middle">${second} →</text></svg>`;
}

function buildMapLibreRenderPackage(workspace) {
  const rows = flattenWorkspaceRows(workspace);
  if (!String(workspace.plan.renderer || '').startsWith('MapLibre')) {
    throw new Error('MapLibre package requires a MapLibre visualization plan.');
  }
  const featureStateByGeography = {};
  for (const row of rows) {
    featureStateByGeography[row.geographyId] ??= {};
    featureStateByGeography[row.geographyId][row.sourceMeasureId] = {
      value: row.numericValue ?? row.value,
      numericValue: row.numericValue,
      state: row.state,
      displayValue: row.displayValue,
      confidenceLow: row.confidenceLow,
      confidenceHigh: row.confidenceHigh,
      marginOfError: row.marginOfError,
      observationId: row.observationId,
      sourceVersionId: row.sourceVersionId,
    };
  }
  return {
    renderer: 'MapLibre GL JS',
    rendererOwnership: 'reviewed geographic substrate and polygon/point interaction only',
    geometryRequired: true,
    joinKey: 'governed geography ID',
    featureStateByGeography,
    missingEncoding: {
      numericZeroIsMissing: false,
      unavailableStates: ['missing', 'unavailable', 'unavailable_partial_coverage', 'stale', 'complete_no_records'],
      visualRequirement: 'non-quantitative hatch/pattern plus explicit text in the inspector and table',
    },
    linkedSelection: workspace.linkedState?.selectedCountyFips || null,
    inspectorUsesCanonicalEvidenceRows: true,
    lowBandwidthFallback: renderAccessibleWorkspaceHtml(workspace),
    sourceLedger: workspace.ledger,
    claimId: workspace.claimId,
  };
}

function renderVisualizationWorkspace(workspace, options = {}) {
  assertWorkspace(workspace);
  const family = workspace.plan.artifactFamily;
  const base = {
    contract: 'cbcap.visualization-render-package.v1',
    artifactFamily: family,
    claim: workspaceClaim(workspace),
    claimId: workspace.claimId,
    accessibleHtml: renderAccessibleWorkspaceHtml(workspace),
    sourceLedger: workspace.ledger,
    mobileReadingOrder: workspace.mobile?.portraitOrder || [],
    staticAndInteractiveClaimMatch: workspace.export?.claimId === workspace.claimId,
  };
  if (['dot_plot', 'interval_dot_plot'].includes(family)) {
    return { ...base, renderer: 'SVG', svg: renderRankedDotSvg(workspace, options) };
  }
  if (['bivariate_map', 'bivariate_choropleth'].includes(family)) {
    return { ...base, ...buildMapLibreRenderPackage(workspace), legendSvg: renderBivariateLegendSvg(workspace) };
  }
  if (String(workspace.plan.renderer || '').startsWith('MapLibre')) {
    return { ...base, ...buildMapLibreRenderPackage(workspace) };
  }
  return { ...base, renderer: workspace.plan.renderer || 'HTML', fallbackOnly: true };
}

module.exports = {
  buildMapLibreRenderPackage,
  flattenWorkspaceRows,
  renderAccessibleWorkspaceHtml,
  renderBivariateLegendSvg,
  renderRankedDotSvg,
  renderVisualizationWorkspace,
};
