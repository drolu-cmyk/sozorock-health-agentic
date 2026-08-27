const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createProductionGovernedEvidenceProviders,
  entityIdsFromPackage,
} = require('../server/governed-evidence-providers');

const actor = Object.freeze({
  tenantId: 'tenant-a', principalId: 'planner-a', actorType: 'human',
  role: 'county_planner', access: 'owner', displayName: 'Planner A',
});

function evidencePackage() {
  return {
    releaseId: 'release:reviewed-1',
    package: {
      source_versions: [{ id: 'source-version:1', review_status: 'verified' }],
      metric_semantics: [{ id: 'semantics:1', review_status: 'verified' }],
      measures: [
        { id: 'measure:verified', review_status: 'verified' },
        { id: 'measure:provisional', review_status: 'provisional' },
      ],
      planning_documents: [{ id: 'document:1', review_status: 'verified' }],
      planning_claims: [{ id: 'claim:1', review_status: 'verified' }],
      planning_citations: [{ id: 'citation:1', review_status: 'verified' }],
    },
  };
}

test('production institutional validator admits only reviewed entities from the requested county release', async () => {
  const seen = [];
  const providers = createProductionGovernedEvidenceProviders({
    evidenceClient: { async getCountyPackage(countyFips) { seen.push(countyFips); return evidencePackage(); } },
  });
  const validator = await providers.institutionalEvidenceValidatorForActor(actor);
  const accepted = await validator(actor, ['measure:verified', 'claim:1'], { geographyId: 'county:36001' });
  assert.deepEqual(accepted, { ok: true, missingIds: [] });
  assert.deepEqual(seen, ['36001']);

  const rejected = await validator(actor, ['measure:provisional', 'unknown:1'], { geographyId: 'county:36001' });
  assert.deepEqual(rejected, { ok: false, missingIds: ['measure:provisional', 'unknown:1'] });
});

test('production institutional validator fails closed on invalid geography or cross-tenant actor', async () => {
  const providers = createProductionGovernedEvidenceProviders({ evidenceClient: { async getCountyPackage() { throw new Error('not expected'); } } });
  const validator = await providers.institutionalEvidenceValidatorForActor(actor);
  assert.deepEqual(await validator(actor, ['measure:verified'], { geographyId: 'state:36' }), {
    ok: false,
    missingIds: ['measure:verified'],
  });
  await assert.rejects(
    () => validator({ ...actor, tenantId: 'tenant-b' }, ['measure:verified'], { geographyId: 'county:36001' }),
    /tenant mismatch/,
  );
});

test('entity extraction never admits provisional evidence records', () => {
  const ids = entityIdsFromPackage(evidencePackage());
  assert.equal(ids.has('measure:verified'), true);
  assert.equal(ids.has('measure:provisional'), false);
  assert.equal(ids.has('release:reviewed-1'), true);
});
