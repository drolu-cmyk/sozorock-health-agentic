const { GovernedGraph } = require('./graph');
const { GovernedHarness } = require('./harness');
const { InMemoryRunMemory } = require('./memory');
const {
  COUNTY_FIPS,
  hasUserAssumptions,
  isApprovedHumanRecord,
} = require('./contracts');

const NODE_IDS = [
  'resolve_place',
  'load_evidence',
  'synthesize_barriers',
  'organize_plan',
  'scenario',
  'draft_brief',
  'await_review',
  'publish',
];

function requiredHandler(handlers, name) {
  if (typeof handlers[name] !== 'function') throw new Error(`CB-CAP graph requires handler ${name}.`);
  return handlers[name];
}

function createCBCAPGraph(options = {}) {
  const handlers = options.handlers || {};
  const resolvePlace = requiredHandler(handlers, 'resolvePlace');
  const loadEvidence = requiredHandler(handlers, 'loadEvidence');
  const synthesizeBarriers = requiredHandler(handlers, 'synthesizeBarriers');
  const organizePlan = requiredHandler(handlers, 'organizePlan');
  const draftBrief = requiredHandler(handlers, 'draftBrief');
  const buildScenario = handlers.buildScenario || null;
  const publish = handlers.publish || null;

  const nodes = {
    resolve_place: {
      async run(state) {
        const place = await resolvePlace(state.task);
        if (!place || place.status === 'unresolved') {
          return {
            patch: { place: place || { status: 'unresolved', query: state.task?.location || null } },
            halt: {
              code: 'place_not_resolved',
              reason: 'The requested geography could not be resolved to one verified U.S. county.',
              status: 'needs_place_selection',
            },
          };
        }
        if (place.status === 'ambiguous') {
          return {
            patch: { place },
            halt: {
              code: 'place_selection_required',
              reason: place.message || 'The requested geography maps to more than one county. Select one county explicitly.',
              status: 'needs_place_selection',
            },
          };
        }
        if (!COUNTY_FIPS.test(String(place.countyFips || ''))) {
          return {
            patch: { place },
            halt: {
              code: 'county_fips_required',
              reason: 'CB-CAP county planning requires one verified five-digit county FIPS.',
              status: 'needs_place_selection',
            },
          };
        }
        return { patch: { place }, next: 'load_evidence' };
      },
    },
    load_evidence: {
      async run(state) {
        return { patch: { evidence: await loadEvidence(state.place, state.task) }, next: 'synthesize_barriers' };
      },
    },
    synthesize_barriers: {
      async run(state) {
        return { patch: { barriers: await synthesizeBarriers(state.evidence, state.place, state.task) }, next: 'organize_plan' };
      },
    },
    organize_plan: {
      async run(state) {
        return {
          patch: { planning: await organizePlan(state) },
          next: hasUserAssumptions(state.task.assumptions) && buildScenario ? 'scenario' : 'draft_brief',
        };
      },
    },
    scenario: {
      async run(state) {
        return { patch: { scenario: await buildScenario(state, state.task.assumptions) }, next: 'draft_brief' };
      },
    },
    draft_brief: {
      async run(state) {
        return { patch: { draft: await draftBrief(state) }, next: 'await_review' };
      },
    },
    await_review: {
      async run(state) {
        if (isApprovedHumanRecord(state.approval) && publish) return { next: 'publish' };
        return {
          patch: { approval: { ...(state.approval || {}), status: 'required' } },
          halt: {
            code: 'human_review_required',
            reason: 'CB-CAP generated a draft. Human review and explicit approval are required before approved output.',
            status: 'awaiting_human_review',
          },
        };
      },
    },
    publish: {
      async run(state) {
        return { patch: { output: await publish(state), status: 'approved_output' }, next: null };
      },
    },
  };

  return new GovernedGraph({
    nodes,
    start: 'resolve_place',
    memory: options.memory || new InMemoryRunMemory(options),
    harness: options.harness || new GovernedHarness({ allowedNodes: NODE_IDS, maxSteps: 16, killSwitch: options.killSwitch }),
    clock: options.clock,
  });
}

module.exports = { NODE_IDS, createCBCAPGraph };
