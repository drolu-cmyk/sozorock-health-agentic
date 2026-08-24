const PLANNING_CONTRACT = 'sozorock.evidence-gateway.planning.v1';

const IMPLEMENTATION_EVIDENCE_TYPES = Object.freeze([
  'priority',
  'objective',
  'intervention',
  'responsible_partner',
  'evaluation_measure',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && Boolean(value.trim());
}

function exactCountyScope(item, geographyId) {
  return Array.isArray(item?.geography_ids)
    && item.geography_ids.length === 1
    && item.geography_ids[0] === geographyId;
}

function humanReviewed(item) {
  return item?.review_status === 'verified'
    && nonEmpty(item.reviewed_by)
    && nonEmpty(item.reviewed_at);
}

function citationLocator(citation) {
  const pageNumber = Number.isInteger(citation?.page_number) && citation.page_number > 0
    ? citation.page_number
    : null;
  const section = nonEmpty(citation?.section) ? citation.section.trim() : null;
  if (pageNumber === null && section === null) return null;
  return {
    citationId: citation.id,
    sourceVersionId: citation.source_version_id,
    pageNumber,
    artifactPageIndex: Number.isInteger(citation?.artifact_page_index) && citation.artifact_page_index >= 0
      ? citation.artifact_page_index
      : null,
    section,
    sourceField: nonEmpty(citation?.source_field) ? citation.source_field.trim() : null,
    quotedTextHash: nonEmpty(citation?.quoted_text_hash) ? citation.quoted_text_hash : null,
  };
}

function buildEvidenceItem(claim, document, citations, release) {
  return {
    claimId: claim.id,
    claimType: claim.claim_type,
    statement: claim.statement,
    confidence: claim.confidence,
    extractionMethod: claim.extraction_method,
    document: {
      documentId: document.id,
      documentType: document.document_type,
      title: document.title,
      publisher: document.publisher,
      officialUrl: document.official_url,
      publishedAt: document.published_at || null,
      periodStart: document.period_start || null,
      periodEnd: document.period_end || null,
      currentPlanStatus: document.current_plan_status,
      sourceVersionId: document.source_version_id,
    },
    citations: citations.map(citationLocator).filter(Boolean),
    evidenceRelease: clone(release),
  };
}

function buildChaChipWorkbench(evidence) {
  const packageData = evidence?.package || {};
  const geography = Array.isArray(packageData.geographies) ? packageData.geographies[0] : null;
  const geographyId = geography?.id || null;
  const release = {
    contract: evidence?.contract || packageData.contract_version || null,
    releaseId: evidence?.releaseId || packageData.release_id || null,
    releaseHash: evidence?.releaseHash || null,
    planningContract: packageData.planning_contract_version || null,
  };

  const base = {
    kind: 'cbcap_cha_chip_evidence_workbench_v1',
    status: 'no_verified_current_plan',
    geography: geographyId ? {
      id: geographyId,
      countyFips: geography.county_fips || null,
      displayName: geography.display_name || geography.name || null,
    } : null,
    evidenceRelease: release,
    currentDocuments: [],
    supportingDocuments: [],
    evidenceByType: {},
    evidenceRecordGaps: [],
    governanceConflicts: [],
    conflictAssessment: {
      status: 'explicit_structural_conflicts_only',
      semanticConflictInferencePerformed: false,
    },
    boundaries: {
      officialPriorityDecision: false,
      actionSelection: false,
      replacesOfficialChaChip: false,
      humanReviewRequired: true,
    },
  };

  if (!geographyId || packageData.planning_contract_version !== PLANNING_CONTRACT) {
    return {
      ...base,
      status: 'planning_evidence_contract_unavailable',
      evidenceRecordGaps: [{
        code: 'planning_contract_unavailable',
        reason: 'This Evidence Gateway release does not expose the governed planning-evidence extension.',
      }],
    };
  }

  const documents = Array.isArray(packageData.planning_documents) ? packageData.planning_documents : [];
  const claims = Array.isArray(packageData.planning_claims) ? packageData.planning_claims : [];
  const citations = Array.isArray(packageData.planning_citations) ? packageData.planning_citations : [];
  const sourceVersions = new Set(
    (Array.isArray(packageData.source_versions) ? packageData.source_versions : [])
      .filter((source) => source?.review_status === 'verified')
      .map((source) => source.source_version_id),
  );

  const admittedDocuments = documents.filter((document) =>
    humanReviewed(document)
    && document.coverage_scope === 'county_specific'
    && exactCountyScope(document, geographyId)
    && sourceVersions.has(document.source_version_id),
  );
  const documentById = new Map(admittedDocuments.map((document) => [document.id, document]));

  const currentDocuments = admittedDocuments.filter((document) => document.current_plan_status === 'verified_current');
  const currentDocumentIds = new Set(currentDocuments.map((document) => document.id));
  const supportingDocuments = admittedDocuments.filter((document) => document.current_plan_status !== 'verified_current');

  const citationsByClaim = new Map();
  for (const citation of citations) {
    if (citation?.review_status !== 'verified') continue;
    const locator = citationLocator(citation);
    if (!locator) continue;
    const document = documentById.get(citation.document_id);
    if (!document || citation.source_version_id !== document.source_version_id) continue;
    if (!citationsByClaim.has(citation.claim_id)) citationsByClaim.set(citation.claim_id, []);
    citationsByClaim.get(citation.claim_id).push(citation);
  }

  const currentClaims = claims.filter((claim) =>
    humanReviewed(claim)
    && exactCountyScope(claim, geographyId)
    && currentDocumentIds.has(claim.document_id)
    && citationsByClaim.has(claim.id),
  );

  const evidenceByType = {};
  for (const claim of currentClaims) {
    const document = documentById.get(claim.document_id);
    const claimCitations = (citationsByClaim.get(claim.id) || []).filter((citation) =>
      citation.document_id === claim.document_id
      && citation.source_version_id === document.source_version_id,
    );
    if (!claimCitations.length) continue;
    if (!evidenceByType[claim.claim_type]) evidenceByType[claim.claim_type] = [];
    evidenceByType[claim.claim_type].push(buildEvidenceItem(claim, document, claimCitations, release));
  }

  const evidenceRecordGaps = [];
  if (currentDocuments.length === 0) {
    evidenceRecordGaps.push({
      code: 'verified_current_plan_missing',
      reason: 'No verified current county plan is present in this published evidence release.',
    });
  }
  for (const claimType of IMPLEMENTATION_EVIDENCE_TYPES) {
    if (!Array.isArray(evidenceByType[claimType]) || evidenceByType[claimType].length === 0) {
      evidenceRecordGaps.push({
        code: `cited_${claimType}_evidence_missing`,
        claimType,
        reason: `No reviewed, cited ${claimType.replaceAll('_', ' ')} claim is available in the current Evidence Gateway record. This is an evidence-record gap, not proof that the official plan omits it.`,
      });
    }
  }

  const governanceConflicts = [];
  if (currentDocuments.length > 1) {
    governanceConflicts.push({
      code: 'multiple_verified_current_plans',
      documentIds: currentDocuments.map((document) => document.id),
      reason: 'More than one county-specific document is designated verified_current. Human governance review is required before CB-CAP treats either as authoritative.',
    });
  }

  let status = 'verified_current_plan_evidence';
  if (currentDocuments.length === 0) status = 'no_verified_current_plan';
  else if (currentDocuments.length > 1) status = 'current_plan_governance_conflict';
  else if (Object.values(evidenceByType).flat().length === 0) status = 'verified_current_plan_without_cited_claims';

  return {
    ...base,
    status,
    currentDocuments: currentDocuments.map((document) => clone(document)),
    supportingDocuments: supportingDocuments.map((document) => clone(document)),
    evidenceByType,
    evidenceRecordGaps,
    governanceConflicts,
  };
}

module.exports = {
  IMPLEMENTATION_EVIDENCE_TYPES,
  PLANNING_CONTRACT,
  buildChaChipWorkbench,
};
