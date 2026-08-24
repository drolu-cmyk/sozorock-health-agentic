const crypto = require('crypto');
const { InMemoryRunMemory } = require('./memory');
const { GovernedHarness } = require('./harness');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function mergeState(state, patch) {
  if (!patch) return clone(state);
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Graph node patch must be an object.');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'runId') && patch.runId !== state.runId) {
    throw new Error('Graph nodes cannot change runId.');
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'task')) {
    throw new Error('Graph nodes cannot replace the task contract.');
  }
  return { ...clone(state), ...clone(patch), runId: state.runId, task: clone(state.task) };
}

class GovernedGraph {
  constructor(options = {}) {
    this.nodes = options.nodes || {};
    this.start = options.start;
    this.harness = options.harness || new GovernedHarness({ allowedNodes: Object.keys(this.nodes) });
    this.memory = options.memory || new InMemoryRunMemory();
    this.clock = options.clock || (() => new Date().toISOString());
    if (!this.start || !this.nodes[this.start]) throw new Error('A valid start node is required.');
  }

  async run(task, initial = {}) {
    const runId = initial.runId || crypto.randomUUID();
    if (this.memory.read(runId).length === 0) {
      this.memory.createRun({ product: 'cbcap', taskType: task?.type || 'decision_workflow' }, runId);
    }
    let state = {
      runId,
      status: 'running',
      task: clone(task || {}),
      startedAt: this.clock(),
      approval: initial.approval ? clone(initial.approval) : { status: 'required' },
      trace: [],
      ...clone(initial),
    };
    state.runId = runId;
    state.task = clone(task || {});
    let nodeId = this.start;
    let step = 0;

    while (nodeId) {
      step += 1;
      const node = this.nodes[nodeId];
      if (!node || typeof node.run !== 'function') {
        return this._halt(state, nodeId, 'unknown_node', `Graph node ${nodeId} is not registered.`);
      }

      const authorization = this.harness.authorize({ nodeId, state: clone(state), step });
      if (!authorization.ok) {
        return this._halt(state, nodeId, authorization.code, authorization.reason);
      }

      this.memory.append(runId, { type: 'node_started', nodeId, step });
      const startedAt = this.clock();
      let result;
      try {
        result = await node.run(clone(state), { runId, step, memory: this.memory });
      } catch (error) {
        return this._halt(state, nodeId, 'node_error', error instanceof Error ? error.message : String(error));
      }

      const patch = result?.patch || {};
      state = mergeState(state, patch);
      state.trace = [
        ...(state.trace || []),
        { nodeId, step, startedAt, completedAt: this.clock(), status: result?.halt ? 'halted' : 'completed' },
      ];

      const after = this.harness.validateAfter({ nodeId, state: clone(state), step });
      if (!after.ok) return this._halt(state, nodeId, after.code, after.reason);

      this.memory.append(runId, { type: 'node_completed', nodeId, step, next: result?.next || null });
      if (result?.halt) {
        return this._halt(state, nodeId, result.halt.code || 'halted', result.halt.reason || 'Execution halted.', result.halt.status);
      }

      if (typeof result?.next === 'string') nodeId = result.next;
      else if (typeof node.next === 'function') nodeId = node.next(clone(state), clone(result));
      else nodeId = node.next || null;
    }

    state.status = state.status === 'running' ? 'completed' : state.status;
    state.completedAt = this.clock();
    this.memory.append(runId, { type: 'run_completed', status: state.status });
    return state;
  }

  _halt(state, nodeId, code, reason, status = 'blocked') {
    const next = {
      ...clone(state),
      status,
      haltedAt: nodeId,
      error: { code, reason },
      completedAt: this.clock(),
    };
    this.memory.append(state.runId, { type: 'run_halted', nodeId, code, reason, status });
    return next;
  }
}

module.exports = { GovernedGraph };
