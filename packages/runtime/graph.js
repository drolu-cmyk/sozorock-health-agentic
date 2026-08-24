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

  async _memory(method, ...args) {
    if (!this.memory || typeof this.memory[method] !== 'function') {
      throw new Error(`Graph memory does not implement ${method}().`);
    }
    return await this.memory[method](...args);
  }

  async run(task, initial = {}) {
    const runId = initial.runId || crypto.randomUUID();
    const existing = await this._memory('read', runId);
    if (existing.length === 0) {
      await this._memory('createRun', {
        product: 'cbcap',
        taskType: task?.type || 'decision_workflow',
        tenantId: initial.tenantId || null,
      }, runId);
    } else {
      throw new Error(`Run ${runId} already exists. Use resume() for an existing run.`);
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
    return this._execute(state, this.start, 0);
  }

  async resume(runId, continuation = {}) {
    if (typeof runId !== 'string' || !runId.trim()) throw new Error('runId is required to resume a graph run.');
    if (!continuation || typeof continuation !== 'object' || Array.isArray(continuation)) {
      throw new Error('Continuation must be an object.');
    }
    if (!continuation.approval || typeof continuation.approval !== 'object' || Array.isArray(continuation.approval)) {
      throw new Error('A human approval record is required to resume this review run.');
    }

    const checkpoint = await this._memory('latestCheckpoint', runId);
    if (!checkpoint) throw new Error(`Run ${runId} has no persisted checkpoint.`);
    if (checkpoint.status !== 'awaiting_human_review' || !checkpoint.resumeAt) {
      throw new Error(`Run ${runId} is not awaiting a resumable human review.`);
    }
    if (!this.nodes[checkpoint.resumeAt]) {
      throw new Error(`Run ${runId} cannot resume at unregistered node ${checkpoint.resumeAt}.`);
    }

    const state = clone(checkpoint.state);
    if (!state || state.runId !== runId) throw new Error(`Run ${runId} checkpoint identity is invalid.`);
    delete state.error;
    delete state.haltedAt;
    delete state.completedAt;
    state.status = 'running';
    state.approval = clone(continuation.approval);
    state.lastResumedAt = this.clock();
    state.resumeCount = Number.isInteger(state.resumeCount) ? state.resumeCount + 1 : 1;

    await this._memory('append', runId, {
      type: 'run_resumed',
      resumeAt: checkpoint.resumeAt,
      checkpointSequence: checkpoint.sequence,
      priorStatus: checkpoint.status,
      resumeCount: state.resumeCount,
    });
    return this._execute(state, checkpoint.resumeAt, Number.isInteger(checkpoint.step) ? checkpoint.step : 0);
  }

  async _execute(initialState, startNodeId, initialStep) {
    let state = clone(initialState);
    let nodeId = startNodeId;
    let step = initialStep;

    while (nodeId) {
      step += 1;
      const node = this.nodes[nodeId];
      if (!node || typeof node.run !== 'function') {
        return this._halt(state, nodeId, 'unknown_node', `Graph node ${nodeId} is not registered.`, 'blocked', null, step);
      }

      const authorization = this.harness.authorize({ nodeId, state: clone(state), step });
      if (!authorization.ok) {
        return this._halt(state, nodeId, authorization.code, authorization.reason, 'blocked', null, step);
      }

      await this._memory('append', state.runId, { type: 'node_started', nodeId, step });
      const startedAt = this.clock();
      let result;
      try {
        result = await node.run(clone(state), { runId: state.runId, step, memory: this.memory });
      } catch (error) {
        return this._halt(
          state,
          nodeId,
          'node_error',
          error instanceof Error ? error.message : String(error),
          'blocked',
          null,
          step,
        );
      }

      const patch = result?.patch || {};
      state = mergeState(state, patch);
      state.trace = [
        ...(state.trace || []),
        { nodeId, step, startedAt, completedAt: this.clock(), status: result?.halt ? 'halted' : 'completed' },
      ];

      const after = this.harness.validateAfter({ nodeId, state: clone(state), step });
      if (!after.ok) return this._halt(state, nodeId, after.code, after.reason, 'blocked', null, step);

      await this._memory('append', state.runId, { type: 'node_completed', nodeId, step, next: result?.next || null });
      if (result?.halt) {
        return this._halt(
          state,
          nodeId,
          result.halt.code || 'halted',
          result.halt.reason || 'Execution halted.',
          result.halt.status,
          result.halt.resumeAt || null,
          step,
        );
      }

      await this._memory('checkpoint', state.runId, state, {
        nodeId,
        step,
        status: state.status,
        resumeAt: null,
      });

      if (typeof result?.next === 'string') nodeId = result.next;
      else if (typeof node.next === 'function') nodeId = node.next(clone(state), clone(result));
      else nodeId = node.next || null;
    }

    state.status = state.status === 'running' ? 'completed' : state.status;
    state.completedAt = this.clock();
    await this._memory('append', state.runId, { type: 'run_completed', status: state.status });
    await this._memory('checkpoint', state.runId, state, {
      nodeId: null,
      step,
      status: state.status,
      resumeAt: null,
    });
    return state;
  }

  async _halt(state, nodeId, code, reason, status = 'blocked', resumeAt = null, step = null) {
    const next = {
      ...clone(state),
      status,
      haltedAt: nodeId,
      error: { code, reason },
      completedAt: this.clock(),
    };
    await this._memory('append', state.runId, { type: 'run_halted', nodeId, code, reason, status, resumeAt });
    await this._memory('checkpoint', state.runId, next, {
      nodeId,
      step,
      status,
      resumeAt,
    });
    return next;
  }
}

module.exports = { GovernedGraph };
