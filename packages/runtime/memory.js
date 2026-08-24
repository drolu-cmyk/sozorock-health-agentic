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

  read(runId) {
    const events = this.runs.get(runId);
    if (!events) return [];
    return clone(events);
  }
}

module.exports = { InMemoryRunMemory };
