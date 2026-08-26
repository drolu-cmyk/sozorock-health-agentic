const crypto = require('crypto');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

class InMemoryRunMemory {
  constructor(options = {}) {
    this.clock = options.clock || (() => new Date().toISOString());
    this.runs = new Map();
  }

  createRun(metadata = {}, runId = crypto.randomUUID()) {
    if (this.runs.has(runId)) {
      throw new Error(`Run ${runId} already exists.`);
    }
    this.runs.set(runId, []);
    this.append(runId, { type: 'run_created', metadata: clone(metadata) });
    return runId;
  }

  append(runId, event) {
    const events = this.runs.get(runId);
    if (!events) throw new Error(`Unknown run ${runId}.`);
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('Memory event must be an object.');
    }
    const record = Object.freeze({
      ...clone(event),
      sequence: events.length + 1,
      at: this.clock(),
    });
    events.push(record);
    return clone(record);
  }

  checkpoint(runId, state, details = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('Checkpoint state must be an object.');
    }
    return this.append(runId, {
      type: 'state_checkpoint',
      nodeId: details.nodeId || null,
      step: Number.isInteger(details.step) ? details.step : null,
      status: details.status || state.status || null,
      resumeAt: details.resumeAt || null,
      state: clone(state),
    });
  }

  read(runId) {
    const events = this.runs.get(runId);
    if (!events) return [];
    return clone(events);
  }

  latestCheckpoint(runId) {
    const events = this.runs.get(runId);
    if (!events) return null;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index].type === 'state_checkpoint') return clone(events[index]);
    }
    return null;
  }

  claimResume(runId, checkpointSequence, event) {
    const events = this.runs.get(runId);
    if (!events) throw new Error(`Unknown run ${runId}.`);
    if (!Number.isInteger(checkpointSequence) || checkpointSequence < 1) {
      throw new Error('checkpointSequence must be a positive integer.');
    }
    if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'run_resumed') {
      throw new Error('Resume claim requires a run_resumed event.');
    }
    const checkpoint = events[checkpointSequence - 1];
    if (
      events.length !== checkpointSequence
      || checkpoint?.type !== 'state_checkpoint'
      || checkpoint?.status !== 'awaiting_human_review'
    ) {
      return null;
    }
    return this.append(runId, event);
  }
}

module.exports = { InMemoryRunMemory };
