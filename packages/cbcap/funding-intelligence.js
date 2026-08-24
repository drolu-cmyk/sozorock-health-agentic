const CRITERION_TYPES = Object.freeze([
  'applicant_type',
  'geography',
  'designation',
  'partner',
  'evidence',
  'plan_priority',
  'barrier',
]);

const ENTITY_POOLS = Object.freeze({
  designation: 'designationEvidenceIds',
  partner: 'partnerOrganizationIds',
  evidence: 'supportingEvidenceIds',
  plan_priority: 'planPriorityClaimIds',
  barrier: 'barrierEvidenceIds',
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredString(value, label, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function strings(value, label, maxItems = 500) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label} must be a bounded array.`);
  return [...new Set(value.map((item, index) => requiredString(item, `${label}[${index}]`, 300)))];
}

function validIsoDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = requiredString(value, 'date', 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error('date must use YYYY-MM-DD.');
  }
  return date;
}

function validateOfficialSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('opportunity.source is required.');
  const officialUrl = requiredString(source.officialUrl, 'opportunity.source.officialUrl', 2000);
  let parsed;
  try {
    parsed = new URL(officialUrl);
  } catch {
    throw new Error('opportunity.source.officialUrl must be a valid URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('opportunity.source.officialUrl must use https.');
  return {
    sourceId: requiredString(source.sourceId, 'opportunity.source.sourceId', 240),
    publisher: requiredString(source.publisher, 'opportunity.source.publisher', 300),
    officialUrl,
    retrievedAt: requiredString(source.retrievedAt, 'opportunity.source.retrievedAt', 80),
    reviewStatus: requiredString(source.reviewStatus, 'opportunity.source.reviewStatus', 40),
    sourceClaimIds: strings(source.sourceClaimIds, 'opportunity.source.sourceClaimIds'),
  };
}

function validateCriterion(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`criteria[${index}] must be an object.`);
  const type = requiredString(value.type, `criteria[${index}].type`, 80);
  if (!CRITERION_TYPES.includes(type)) throw new Error(`criteria[${index}].type is unsupported.`);
  return {
    id: requiredString(value.id, `criteria[${index}].id`, 240),
    type,
    description: requiredString(value.description, `criteria[${index}].description`, 1000),
    required: value.required !== false,
    acceptedValues: strings(value.acceptedValues, `criteria[${index}].acceptedValues`),
    requiredEntityIds: strings(value.requiredEntityIds, `criteria[${index}].requiredEntityIds`),
    sourceClaimIds: strings(value.sourceClaimIds, `criteria[${index}].sourceClaimIds`),
  };
}

function validateOpportunity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('opportunity is required.');
  const criteria = Array.isArray(value.criteria) ? value.criteria.map(validateCriterion) : [];
  if (criteria.length > 100) throw new Error('opportunity criteria are too numerous.');
  return {
    id: requiredString(value.id, 'opportunity.id', 240),
    title: requiredString(value.title, 'opportunity.title', 500),
    reviewStatus: requiredString(value.reviewStatus, 'opportunity.reviewStatus', 40),
    openDate: validIsoDate(value.openDate),
    closeDate: validIsoDate(value.closeDate),
    source: validateOfficialSource(value.source),
    criteria,
  };
}

function validateApplicant(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('applicant profile is required.');
  return {
    tenantId: requiredString(value.tenantId, 'applicant.tenantId', 200),
    organizationId: requiredString(value.organizationId, 'applicant.organizationId', 240),
    applicantTypes: strings(value.applicantTypes, 'applicant.applicantTypes'),
    geographyIds: strings(value.geographyIds, 'applicant.geographyIds'),
    partnerOrganizationIds: strings(value.partnerOrganizationIds, 'applicant.partnerOrganizationIds'),
    designationEvidenceIds: strings(value.designationEvidenceIds, 'applicant.designationEvidenceIds'),
    supportingEvidenceIds: strings(value.supportingEvidenceIds, 'applicant.supportingEvidenceIds'),
    planPriorityClaimIds: strings(value.planPriorityClaimIds, 'applicant.planPriorityClaimIds'),
    barrierEvidenceIds: strings(value.barrierEvidenceIds, 'applicant.barrierEvidenceIds'),
  };
}

function intersection(left, right) {
  const rightSet = new Set(right);
  return [...new Set(left.filter((item) => rightSet.has(item)))].sort();
}

function difference(required, available) {
  const availableSet = new Set(available);
  return [...new Set(required.filter((item) => !availableSet.has(item)))].sort();
}

function deadlineStatus(opportunity, asOf) {
  if (opportunity.openDate && asOf < opportunity.openDate) return 'not_yet_open';
  if (opportunity.closeDate && asOf > opportunity.closeDate) return 'closed';
  if (!opportunity.openDate && !opportunity.closeDate) return 'unknown';
  return 'open';
}

function evaluateCriterion(criterion, applicant, context) {
  if (criterion.type === 'applicant_type') {
    if (!criterion.acceptedValues.length) {
      return { criterionId: criterion.id, type: criterion.type, status: 'not_applicable', matchedEntityIds: [], missingEntityIds: [], sourceClaimIds: criterion.sourceClaimIds, explanation: 'No applicant-type restriction is encoded in the reviewed criterion.' };
    }
    const matched = intersection(applicant.applicantTypes, criterion.acceptedValues);
    return {
      criterionId: criterion.id,
      type: criterion.type,
      status: matched.length ? 'matched' : 'conflict',
      matchedEntityIds: matched,
      missingEntityIds: [],
      sourceClaimIds: criterion.sourceClaimIds,
      explanation: matched.length
        ? 'The organization profile matches a reviewed applicant class in this opportunity record.'
        : 'The organization profile does not match the reviewed applicant classes currently encoded for this opportunity. Confirm final eligibility with the funder.',
    };
  }

  if (criterion.type === 'geography') {
    if (!criterion.acceptedValues.length) {
      return { criterionId: criterion.id, type: criterion.type, status: 'not_applicable', matchedEntityIds: [], missingEntityIds: [], sourceClaimIds: criterion.sourceClaimIds, explanation: 'No geographic restriction is encoded in the reviewed criterion.' };
    }
    const available = [...applicant.geographyIds, context.countyId, ...(context.stateId ? [context.stateId] : [])];
    const matched = intersection(available, criterion.acceptedValues);
    return {
      criterionId: criterion.id,
      type: criterion.type,
      status: matched.length ? 'matched' : 'conflict',
      matchedEntityIds: matched,
      missingEntityIds: [],
      sourceClaimIds: criterion.sourceClaimIds,
      explanation: matched.length
        ? 'The planning geography matches a reviewed opportunity geography.'
        : 'The planning geography does not match the reviewed geographic values currently encoded for this opportunity. Confirm final eligibility with the funder.',
    };
  }

  const poolName = ENTITY_POOLS[criterion.type];
  const available = applicant[poolName] || [];
  if (!criterion.requiredEntityIds.length) {
    return { criterionId: criterion.id, type: criterion.type, status: 'not_applicable', matchedEntityIds: [], missingEntityIds: [], sourceClaimIds: criterion.sourceClaimIds, explanation: 'No entity-specific requirement is encoded in the reviewed criterion.' };
  }
  const matched = intersection(available, criterion.requiredEntityIds);
  const missing = difference(criterion.requiredEntityIds, available);
  return {
    criterionId: criterion.id,
    type: criterion.type,
    status: missing.length ? 'incomplete' : 'matched',
    matchedEntityIds: matched,
    missingEntityIds: missing,
    sourceClaimIds: criterion.sourceClaimIds,
    explanation: missing.length
      ? 'The current institutional evidence record does not yet contain every reviewed item required by this criterion.'
      : 'The current institutional evidence record contains every reviewed item required by this criterion.',
  };
}

function requirementsStatus(criteria, results) {
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const required = results.filter((result) => byId.get(result.criterionId)?.required && result.status !== 'not_applicable');
  if (required.some((result) => result.status === 'conflict')) return 'conflict';
  if (required.some((result) => result.status === 'incomplete')) return 'incomplete';
  if (required.length && required.every((result) => result.status === 'matched')) return 'matched';
  return 'unknown';
}

function fitStatus(requirements, results) {
  if (requirements === 'conflict') return 'weak_evidence_fit';
  const matchedTypes = new Set(results.filter((result) => result.status === 'matched').map((result) => result.type));
  const aligned = ['designation', 'evidence', 'plan_priority', 'barrier'].filter((type) => matchedTypes.has(type)).length;
  if (requirements === 'matched' && aligned >= 2) return 'strong_evidence_fit';
  if (requirements === 'matched' && aligned >= 1) return 'partial_evidence_fit';
  if (requirements === 'incomplete') return aligned >= 1 ? 'partial_evidence_fit' : 'weak_evidence_fit';
  return 'not_evaluated';
}

function blockedResult(opportunity, deadline, code, reason) {
  return {
    kind: 'cbcap_funding_fit_v1',
    opportunityId: opportunity.id,
    opportunityTitle: opportunity.title,
    status: 'blocked',
    deadlineStatus: deadline,
    requirementsStatus: 'unknown',
    fitStatus: 'not_evaluated',
    criteria: [],
    missingEvidenceIds: [],
    missingPartnerIds: [],
    trajectory: [{ stage: 'source_validation', decision: 'blocked', reasonCodes: [code] }],
    caveats: [reason],
    humanReviewRequired: true,
    finalEligibilityAuthority: 'funder_and_authorized_humans',
    awardPredictionProduced: false,
    fundingAllocationProduced: false,
  };
}

function evaluateFundingFit(input) {
  const opportunity = validateOpportunity(input?.opportunity);
  const applicant = validateApplicant(input?.applicant);
  const countyId = requiredString(input?.countyId, 'countyId', 240);
  const stateId = input?.stateId ? requiredString(input.stateId, 'stateId', 240) : null;
  const asOf = validIsoDate(input?.asOf) || new Date().toISOString().slice(0, 10);
  const deadline = deadlineStatus(opportunity, asOf);

  const sourceVerified = opportunity.reviewStatus === 'verified'
    && opportunity.source.reviewStatus === 'verified'
    && opportunity.source.sourceClaimIds.length > 0;
  if (!sourceVerified) {
    return blockedResult(
      opportunity,
      deadline,
      'funding_source_not_verified',
      'Funding fit is blocked until the opportunity and the criteria used for reasoning have verified official-source lineage.',
    );
  }

  const missingLineage = opportunity.criteria.filter((criterion) => criterion.required && criterion.sourceClaimIds.length === 0);
  if (missingLineage.length) {
    return {
      ...blockedResult(
        opportunity,
        deadline,
        'required_criterion_missing_source_lineage',
        'One or more required opportunity criteria lack verified source-claim lineage and cannot be used for funding reasoning.',
      ),
      trajectory: missingLineage.map((criterion) => ({
        stage: 'criterion_lineage',
        criterionId: criterion.id,
        decision: 'blocked',
        reasonCodes: ['required_criterion_missing_source_lineage'],
      })),
    };
  }

  if (deadline === 'closed') {
    return {
      kind: 'cbcap_funding_fit_v1',
      opportunityId: opportunity.id,
      opportunityTitle: opportunity.title,
      status: 'closed_opportunity',
      deadlineStatus: deadline,
      requirementsStatus: 'unknown',
      fitStatus: 'not_evaluated',
      criteria: [],
      missingEvidenceIds: [],
      missingPartnerIds: [],
      trajectory: [{ stage: 'deadline', decision: 'closed', reasonCodes: ['opportunity_closed'] }],
      caveats: ['The reviewed opportunity is closed as of the supplied date. This says nothing about future or renewed funding availability.'],
      humanReviewRequired: true,
      finalEligibilityAuthority: 'funder_and_authorized_humans',
      awardPredictionProduced: false,
      fundingAllocationProduced: false,
    };
  }

  const results = opportunity.criteria.map((criterion) => evaluateCriterion(criterion, applicant, { countyId, stateId }));
  const requirements = requirementsStatus(opportunity.criteria, results);
  const fit = fitStatus(requirements, results);
  const missingEvidenceIds = [...new Set(results
    .filter((result) => ['designation', 'evidence', 'plan_priority', 'barrier'].includes(result.type))
    .flatMap((result) => result.missingEntityIds))].sort();
  const missingPartnerIds = [...new Set(results
    .filter((result) => result.type === 'partner')
    .flatMap((result) => result.missingEntityIds))].sort();

  const trajectory = [
    { stage: 'source_validation', decision: 'verified', reasonCodes: [] },
    { stage: 'deadline', decision: deadline, reasonCodes: deadline === 'not_yet_open' ? ['opportunity_not_yet_open'] : deadline === 'unknown' ? ['deadline_not_verified'] : [] },
    ...results.map((result) => ({
      stage: 'criterion',
      criterionId: result.criterionId,
      decision: result.status,
      reasonCodes: [`${result.type}_${result.status}`],
      matchedEntityIds: clone(result.matchedEntityIds),
      missingEntityIds: clone(result.missingEntityIds),
    })),
    { stage: 'evidence_fit', decision: fit, reasonCodes: [`requirements_${requirements}`, `fit_${fit}`] },
  ];

  const caveats = [
    'Funding fit is an evidence-matching assessment, not a final eligibility determination, award prediction, or funding recommendation.',
    'Final eligibility, application strategy, partner commitments, and funding decisions remain with authorized humans and the funder.',
  ];
  if (deadline === 'not_yet_open') caveats.push('The opportunity is not yet open as of the supplied date.');
  if (deadline === 'unknown') caveats.push('The application deadline is not verified and must be confirmed before action.');
  if (requirements === 'unknown') caveats.push('The reviewed criteria are insufficient to determine whether requirements are matched.');

  return {
    kind: 'cbcap_funding_fit_v1',
    opportunityId: opportunity.id,
    opportunityTitle: opportunity.title,
    status: 'provisional_review_required',
    evaluatedAt: new Date().toISOString(),
    asOf,
    deadlineStatus: deadline,
    requirementsStatus: requirements,
    fitStatus: fit,
    criteria: results,
    missingEvidenceIds,
    missingPartnerIds,
    source: clone(opportunity.source),
    trajectory,
    caveats,
    humanReviewRequired: true,
    finalEligibilityAuthority: 'funder_and_authorized_humans',
    awardPredictionProduced: false,
    fundingAllocationProduced: false,
  };
}

module.exports = {
  CRITERION_TYPES,
  evaluateFundingFit,
  validateApplicant,
  validateOpportunity,
};
