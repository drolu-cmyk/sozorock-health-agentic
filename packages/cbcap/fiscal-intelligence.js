const CONTRACT = 'cbcap.fiscal-intelligence.v1';
const TYPES = new Set(['county_fiscal_record','budget','grant','program_expenditure','staffing_allocation']);
function text(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required.`);
  return value.trim();
}
function date(value, name) {
  const result = text(value, name, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(`${result}T00:00:00Z`).toISOString().slice(0,10) !== result) throw new Error(`${name} is invalid.`);
  return result;
}
function fiscalRecord(record, { tenantId, countyFips }) {
  if (!record || record.tenantId !== tenantId || record.countyFips !== countyFips) throw new Error('Fiscal evidence scope does not match.');
  if (!TYPES.has(record.type) || record.reviewStatus !== 'reviewed' || record.supersededBy) throw new Error('Current reviewed fiscal evidence is required.');
  if (record.authorizedForPlanning !== true) throw new Error('Fiscal evidence is not authorized for planning.');
  const reviewer = text(record.reviewer, 'reviewer', 240);
  const reviewedAt = date(record.reviewedAt, 'reviewedAt');
  const periodStart = date(record.periodStart,'periodStart');
  const periodEnd = date(record.periodEnd,'periodEnd');
  if (periodEnd < periodStart) throw new Error('Fiscal period is invalid.');
  const value = record.value;
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('Fiscal value must be a finite number or null.');
  if (value === null && !record.missingReason) throw new Error('Missing fiscal evidence needs an explicit reason.');
  if (typeof record.unit !== 'string' || !['USD','FTE','hours'].includes(record.unit)) throw new Error('Fiscal unit is invalid.');
  const citation = record.citation;
  if (!citation || !(Number.isInteger(citation.page) && citation.page > 0 || typeof citation.section === 'string' && citation.section.trim())) throw new Error('An exact citation locator is required.');
  return {
    id:text(record.id,'record id',240), type:record.type, title:text(record.title,'title'),
    value, unit:record.unit, source:text(record.source,'source'),
    documentId:text(record.documentId,'document identity',240), documentVersion:text(record.documentVersion,'document version',240),
    periodStart, periodEnd, countyFips, citation:{page:citation.page || null,section:citation.section || null},
    reviewStatus:'reviewed', reviewer, reviewedAt, fundingBasis: ['committed','grant_dependent','unknown'].includes(record.fundingBasis) ? record.fundingBasis : 'unknown',
    missingReason:value === null ? text(record.missingReason,'missing reason') : null,
  };
}
function buildFiscalView({ records, tenantId, countyFips, assumptions = [] }) {
  if (!/^\d{5}$/.test(countyFips || '') || !tenantId || !Array.isArray(records) || records.length > 2000) throw new Error('Fiscal scope is invalid.');
  const facts = records.map(record => fiscalRecord(record,{tenantId,countyFips}));
  const ids = new Set(facts.map(record => record.id));
  if (ids.size !== facts.length) throw new Error('Duplicate fiscal records are not allowed.');
  if (!Array.isArray(assumptions) || assumptions.length > 20) throw new Error('Planning assumptions are invalid.');
  const seen = new Set();
  const scenarios = assumptions.map(assumption => {
    if (!assumption || Object.keys(assumption).some(key => !['recordId','multiplier','rationale'].includes(key))) throw new Error('Unsupported fiscal assumption.');
    const fact = facts.find(record => record.id === assumption.recordId);
    if (!fact || seen.has(fact.id)) throw new Error('Each scenario needs one distinct reviewed record.');
    seen.add(fact.id);
    if (typeof assumption.multiplier !== 'number' || !Number.isFinite(assumption.multiplier) || assumption.multiplier < 0 || assumption.multiplier > 10) throw new Error('Multiplier must be between zero and ten.');
    const value = fact.value === null ? null : fact.value * assumption.multiplier;
    if (value !== null && !Number.isFinite(value)) throw new Error('Scenario value exceeds supported range.');
    return {recordId:fact.id,label:'Planning scenario',assumption:{label:'User assumption',multiplier:assumption.multiplier,rationale:text(assumption.rationale,'assumption rationale')},value,unit:fact.unit,citation:fact.citation,documentId:fact.documentId,documentVersion:fact.documentVersion};
  });
  return {contract:CONTRACT,countyFips,status:facts.length ? 'review_required':'not_available',facts,scenarios,
    missingEvidence:facts.length ? facts.filter(record => record.value === null).map(record => ({recordId:record.id,reason:record.missingReason})) : [{reason:'Not found in reviewed evidence'}],
    humanReviewRequired:true,allocationDecision:false,
    limitations:['Records with different units or periods are not added together.','Planning scenarios change explicit assumptions; they do not allocate resources.','Missing values remain missing. No financial health score is calculated.']};
}
module.exports = {CONTRACT,buildFiscalView,fiscalRecord};
