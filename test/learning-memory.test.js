const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryLearningMemory } = require('../packages/runtime/learning-memory');

function actor(overrides = {}) {
  return {
    tenantId: 'tenant-a',
    principalId: 'reviewer-1',
    actorType: 'human',
    role: 'foundation_reviewer',
    access: 'owner',
    displayName: 'Foundation Reviewer',
    ...overrides,
  };
}

function trajectory(overrides = {}) {
  return {
    runId: 'run-1',
    geographyId: 'county:36001',
    stage: 'scenario_projection',
    actorType: 'deterministic',
    actorName: 'governed-scenario-v1',
    actorVersion: '1.0.0',
    entityId: 'scenario:run-1',
    outcome: 'Scenario sensitivity calculated',
    outcomeClass: 'completed',
    reasonCodes: ['scenario_ready'],
    sourceEntityIds: ['obs-test-rate'],
    toolNames: [],
    inputStateHash: `sha256:${'a'.repeat(64)}`,
    outputStateHash: `sha256:${'b'.repeat(64)}`,
    occurredAt: '2026-08-24T02:00:00.000Z',
    ...overrides,
  };
}

test('learning memory records structured trajectory without raw content', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a', clock: () => '2026-08-24T03:00:00.000Z' });
  const event = memory.recordTrajectory(trajectory());

  assert.equal(event.tenantId, 'tenant-a');
  assert.equal(event.stage, 'scenario_projection');
  assert.equal(event.recordedAt, '2026-08-24T03:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(event, 'rawContent'), false);
  assert.throws(
    () => memory.recordTrajectory(trajectory({ rawContent: 'raw page text' })),
    /do not belong/i,
  );
});

test('deterministic trajectory cannot claim model identity, tokens, or model cost', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a' });
  assert.throws(
    () => memory.recordTrajectory(trajectory({
      modelProvider: 'example',
      modelName: 'model-x',
      inputTokens: 20,
    })),
    /deterministic trajectory events cannot report model identity/i,
  );
});

test('evaluation labels append to immutable trajectory and human labels derive identity from workspace actor', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a', clock: () => '2026-08-24T03:00:00.000Z' });
  const event = memory.recordTrajectory(trajectory());
  const evaluation = memory.evaluate(event.id, {
    label: 'correct',
    reasonCodes: ['verified_against_release'],
  }, {
    type: 'human',
    actor: actor(),
    version: 'human-review-v1',
  });

  assert.equal(evaluation.trajectoryEventId, event.id);
  assert.equal(evaluation.evaluatorId, 'reviewer-1');
  assert.equal(evaluation.evaluatorType, 'human');
  assert.deepEqual(evaluation.reasonCodes, ['verified_against_release']);
});

test('corrections require existing trajectory and human review authority', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a' });
  const event = memory.recordTrajectory(trajectory());
  const correction = memory.correct(event.id, {
    correctedEntityId: 'scenario:run-1',
    correctionType: 'scenario_assumption',
    reasonCodes: ['range_too_narrow'],
    correctionSummary: 'Use the reviewed wider planning range in the regression case.',
  }, actor({ role: 'county_planner', access: 'contributor', principalId: 'planner-1' }));

  assert.equal(correction.correctedBy, 'planner-1');
  assert.throws(
    () => memory.correct(event.id, {
      correctedEntityId: 'scenario:run-1',
      correctionType: 'scenario_assumption',
      reasonCodes: ['agent_attempt'],
      correctionSummary: 'Agent cannot author a human correction.',
    }, actor({ role: 'evidence_agent', actorType: 'agent', principalId: 'agent-1' })),
    /not authorized/i,
  );
});

test('agent may propose an evidence-backed candidate but only foundation reviewer can approve it', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a', clock: () => '2026-08-24T03:00:00.000Z' });
  const event = memory.recordTrajectory(trajectory());
  const evaluation = memory.evaluate(event.id, {
    label: 'incomplete',
    reasonCodes: ['missing_guardrail_case'],
  }, {
    type: 'deterministic_eval',
    id: 'regression-evaluator',
    version: '1.0.0',
  });

  const candidate = memory.proposeCandidate({
    targetType: 'regression_case',
    targetId: 'scenario-horizon-boundary',
    summary: 'Add a regression case for the maximum scenario horizon.',
    rationale: 'The evaluated trajectory lacked this boundary case.',
    artifactRef: 'github:issue-or-pr-reference-only',
    evaluationIds: [evaluation.id],
    correctionIds: [],
    evidenceEntityIds: ['release-2026-08-23'],
  }, actor({ role: 'evidence_agent', actorType: 'agent', principalId: 'agent-1', access: 'viewer' }));

  assert.equal(candidate.status, 'proposed');
  assert.equal(candidate.proposedByActorType, 'agent');
  assert.equal(candidate.automaticApplicationAllowed, false);

  assert.throws(
    () => memory.reviewCandidate(candidate.id, 'approve', actor({ role: 'county_planner', principalId: 'planner-1' }), { rationale: 'Looks good.' }),
    /foundation_reviewer authority/i,
  );

  const review = memory.reviewCandidate(candidate.id, 'approve', actor(), {
    rationale: 'Approved as a candidate for the next reviewed release.',
  });
  assert.equal(review.status, 'approved_candidate');
  assert.equal(review.applicationState, 'not_applied');
  assert.equal(review.automaticApplicationAllowed, false);

  const snapshot = memory.query({ candidateStatus: 'approved_candidate' });
  assert.equal(snapshot.candidates.length, 1);
  assert.equal(snapshot.automaticProductionModification, false);
});

test('candidate storage rejects executable patches and unknown evidence records', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a' });
  const event = memory.recordTrajectory(trajectory());
  const evaluation = memory.evaluate(event.id, {
    label: 'incorrect',
    reasonCodes: ['regression'],
  }, {
    type: 'deterministic_eval',
    id: 'eval-1',
    version: '1.0.0',
  });

  assert.throws(
    () => memory.proposeCandidate({
      targetType: 'code_change',
      targetId: 'scenario-engine',
      summary: 'Candidate change',
      rationale: 'Needs review',
      artifactRef: 'github:pr-reference',
      evaluationIds: [evaluation.id],
      patch: 'diff --git ...',
    }, actor()),
    /not executable content or patches/i,
  );

  assert.throws(
    () => memory.proposeCandidate({
      targetType: 'policy_change',
      targetId: 'policy-1',
      summary: 'Candidate policy change',
      rationale: 'Needs review',
      artifactRef: 'governed:artifact',
      evaluationIds: ['00000000-0000-0000-0000-000000000000'],
    }, actor()),
    /unknown evaluation/i,
  );
});

test('learning memory rejects cross-tenant actors', () => {
  const memory = new InMemoryLearningMemory({ tenantId: 'tenant-a' });
  const event = memory.recordTrajectory(trajectory());
  assert.throws(
    () => memory.evaluate(event.id, { label: 'correct', reasonCodes: ['ok'] }, {
      type: 'human',
      actor: actor({ tenantId: 'tenant-b' }),
      version: 'human-review-v1',
    }),
    /tenant does not match/i,
  );
});
