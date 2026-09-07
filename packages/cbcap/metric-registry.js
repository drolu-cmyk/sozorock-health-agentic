const CONTRACT = 'cbcap.metric-registry.v1';
const CATEGORIES = new Set(['Fiscal Intelligence','Workforce Analytics','Program Integration','Learning Loop Adoption','Transparency Index']);
function text(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} is required.`);
  return value.trim();
}
function date(value, name) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} is invalid.`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new Error(`${name} is invalid.`);
  return value;
}
function quantity(value, name) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number or null.`);
  return value;
}
function normalizeMetric(input) {
  if (!input || Array.isArray(input) || typeof input !== 'object') throw new Error('Metric definition is required.');
  const fields = ['name','category','definition','numerator','denominator','denominatorNotApplicableReason','source','countyFips','vintage','baseline','target','unit','owner','reviewCadence','reviewDate','evidenceStatus','citations','limitations'];
  if (Object.keys(input).some(key => !fields.includes(key))) throw new Error('Unsupported metric field.');
  if (!CATEGORIES.has(input.category) || !/^\d{5}$/.test(input.countyFips || '')) throw new Error('Metric category and county scope are required.');
  if (!['source_estimate','planning_view','user_assumption','not_available'].includes(input.evidenceStatus)) throw new Error('Metric evidence status is invalid.');
  if (!Array.isArray(input.citations) || !input.citations.length || input.citations.length > 30) throw new Error('Exact citations are required.');
  const citations = input.citations.map(citation => {
    if (!citation || !(Number.isInteger(citation.page) && citation.page > 0 || typeof citation.section === 'string' && citation.section.trim())) throw new Error('Citation needs a page or section.');
    return {documentId:text(citation.documentId,'document identity',240),version:text(citation.version,'document version',240),page:citation.page || null,section:citation.section || null};
  });
  const denominator = input.denominator === null ? null : text(input.denominator,'denominator');
  const denominatorNotApplicableReason = denominator === null ? text(input.denominatorNotApplicableReason,'denominator exception') : null;
  const baseline = quantity(input.baseline,'baseline');
  const target = quantity(input.target,'target');
  if (input.evidenceStatus === 'not_available' && baseline !== null) throw new Error('Unavailable evidence cannot supply a baseline.');
  return {contract:CONTRACT,name:text(input.name,'name',240),category:input.category,definition:text(input.definition,'operational definition'),numerator:text(input.numerator,'numerator'),denominator,denominatorNotApplicableReason,source:text(input.source,'source'),countyFips:input.countyFips,vintage:date(input.vintage,'vintage'),baseline,target,unit:text(input.unit,'unit',80),owner:text(input.owner,'owner',240),reviewCadence:text(input.reviewCadence,'review cadence',240),reviewDate:date(input.reviewDate,'review date'),evidenceStatus:input.evidenceStatus,citations,limitations:text(input.limitations,'limitations')};
}
module.exports = { CONTRACT,normalizeMetric };
