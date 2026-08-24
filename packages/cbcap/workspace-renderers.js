const { WORKSPACE_CONTRACT, renderAccessibleWorkspaceHtml } = require('./analytical-workspace');

function assertWorkspace(workspace) {
  if (!workspace || workspace.contract !== WORKSPACE_CONTRACT) throw new Error('A governed analytical workspace is required.');
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
}

function numericRows(workspace) {
  return workspace.accessibleFallback.rows.filter((row) => row.numericValue != null && row.valueState !== 'unavailable');
}

function renderRankedDotSvg(workspace, options = {}) {
  assertWorkspace(workspace);
  const width = Number.isFinite(options.width) ? Math.max(480, options.width) : 760;
  const rowHeight = 38;
  const left = 230;
  const right = 130;
  const top = 48;
  const rows = [...workspace.accessibleFallback.rows].sort((a, b) => {
    if (a.numericValue == null) return 1;
    if (b.numericValue == null) return -1;
    return b.numericValue - a.numericValue;
  });
  const numeric = numericRows(workspace);
  const values = numeric.map((row) => row.numericValue);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = max === min ? 1 : max - min;
  const plotWidth = width - left - right;
  const x = (value) => left + ((value - min) / span) * plotWidth;
  const height = top + rows.length * rowHeight + 48;
  const title = escapeXml(workspace.plan.claim);

  const marks = rows.map((row, index) => {
    const y = top + index * rowHeight;
    if (row.numericValue == null) {
      return `<g data-geography="${escapeXml(row.geographyId)}"><text x="16" y="${y}" dominant-baseline="middle">${escapeXml(row.geographyName)}</text><text x="${left}" y="${y}" dominant-baseline="middle">Unavailable</text></g>`;
    }
    const cx = x(row.numericValue);
    let interval = '';
    if (row.confidenceLow != null || row.confidenceHigh != null) {
      const low = row.confidenceLow == null ? row.numericValue : row.confidenceLow;
      const high = row.confidenceHigh == null ? row.numericValue : row.confidenceHigh;
      interval = `<line x1="${x(low).toFixed(2)}" x2="${x(high).toFixed(2)}" y1="${y}" y2="${y}" stroke="currentColor" stroke-width="2" />`;
    } else if (row.marginOfError != null) {
      interval = `<line x1="${x(row.numericValue - row.marginOfError).toFixed(2)}" x2="${x(row.numericValue + row.marginOfError).toFixed(2)}" y1="${y}" y2="${y}" stroke="currentColor" stroke-width="2" />`;
    }
    return `<g data-geography="${escapeXml(row.geographyId)}"><text x="16" y="${y}" dominant-baseline="middle">${escapeXml(row.geographyName)}</text>${interval}<circle cx="${cx.toFixed(2)}" cy="${y}" r="5" fill="currentColor" /><text x="${(cx + 12).toFixed(2)}" y="${y}" dominant-baseline="middle">${escapeXml(row.displayValue)}</text></g>`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="chart-title chart-desc" viewBox="0 0 ${width} ${height}"><title id="chart-title">${title}</title><desc id="chart-desc">Ranked comparison with direct place labels, visible values, explicit unavailable rows, and uncertainty intervals when present.</desc><text x="16" y="24" id="chart-heading" font-weight="700">${title}</text>${marks}</svg>`;
}

function renderBivariateLegendSvg(workspace) {
  assertWorkspace(workspace);
  if (workspace.plan.artifactFamily !== 'bivariate_map') throw new Error('Bivariate legend renderer requires a bivariate map workspace.');
  const labels = workspace.plan.legend.cells;
  const cell = 82;
  const left = 110;
  const top = 32;
  const cells = labels.flatMap((row, rowIndex) => row.map((label, columnIndex) => {
    const x = left + columnIndex * cell;
    const y = top + (2 - rowIndex) * cell;
    return `<g><rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="none" stroke="currentColor" /><text x="${x + cell / 2}" y="${y + cell / 2}" text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text></g>`;
  })).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Bivariate three by three legend with text labels" viewBox="0 0 390 310">${cells}<text x="${left + cell * 1.5}" y="300" text-anchor="middle">Measure 1 →</text><text transform="translate(20 ${top + cell * 1.5}) rotate(-90)" text-anchor="middle">Measure 2 →</text></svg>`;
}

function buildMapLibreRenderPackage(workspace) {
  assertWorkspace(workspace);
  if (!String(workspace.plan.renderer || '').startsWith('MapLibre')) throw new Error('MapLibre package requires a MapLibre visualization plan.');
  const states = {};
  for (const row of workspace.accessibleFallback.rows) {
    states[row.geographyId] ??= {};
    states[row.geographyId][row.measureId] = {
      value: row.numericValue,
      valueState: row.valueState,
      displayValue: row.displayValue,
      confidenceLow: row.confidenceLow,
      confidenceHigh: row.confidenceHigh,
      marginOfError: row.marginOfError,
      sourceVersionId: row.sourceVersionId,
    };
  }
  return {
    renderer: 'MapLibre GL JS',
    rendererOwnership: 'geographic substrate and polygon/point interaction only',
    geometryRequired: true,
    joinKey: 'governed geography ID',
    featureStateByGeography: states,
    missingEncoding: {
      numericZeroIsMissing: false,
      unavailableState: 'unavailable',
      visualRequirement: 'distinct non-quantitative pattern or neutral hatch plus text in inspector',
    },
    linkedSelection: workspace.linkedState.selectedGeographyId,
    inspectorUsesCanonicalRows: true,
    lowBandwidthFallback: renderAccessibleWorkspaceHtml(workspace),
    sourceLedger: workspace.plan.sourceLedger,
    claim: workspace.plan.claim,
  };
}

function renderWorkspacePackage(workspace, options = {}) {
  assertWorkspace(workspace);
  const family = workspace.plan.artifactFamily;
  const base = {
    contract: 'cbcap.visualization-render-package.v1',
    artifactFamily: family,
    claim: workspace.plan.claim,
    dataFingerprint: workspace.plan.dataFingerprint,
    accessibleHtml: renderAccessibleWorkspaceHtml(workspace),
    sourceLedger: workspace.plan.sourceLedger,
    mobileReadingOrder: workspace.mobile.readingOrder,
  };

  if (['dot_plot', 'interval_dot_plot'].includes(family)) {
    return { ...base, renderer: 'SVG', svg: renderRankedDotSvg(workspace, options) };
  }
  if (family === 'bivariate_map') {
    return { ...base, ...buildMapLibreRenderPackage(workspace), legendSvg: renderBivariateLegendSvg(workspace) };
  }
  if (String(workspace.plan.renderer || '').startsWith('MapLibre')) {
    return { ...base, ...buildMapLibreRenderPackage(workspace) };
  }
  return {
    ...base,
    renderer: workspace.plan.renderer || 'HTML',
    fallbackOnly: true,
  };
}

module.exports = {
  buildMapLibreRenderPackage,
  renderBivariateLegendSvg,
  renderRankedDotSvg,
  renderWorkspacePackage,
};
