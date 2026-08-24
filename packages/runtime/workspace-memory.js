const crypto = require('crypto');

const WORKSPACE_ITEM_TYPES = Object.freeze([
  'draft',
  'comment',
  'task',
  'saved_view',
  'review_question',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function requiredString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function optionalString(value, label, max = 500) {
  if (value === undefined || value === null || value === '') return null;
  return requiredString(value, label, max);
}

function validateWorkspaceContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('workspace content must be an object.');
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') > 100_000) throw new Error('workspace content exceeds 100 KB.');
  return clone(value);
}

function normalizeWorkspaceItem(input, context = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('workspace item must be an object.');
  const itemType = requiredString(input.itemType, 'itemType', 80);
  if (!WORKSPACE_ITEM_TYPES.includes(itemType)) throw new Error('itemType is unsupported.');
  return {
    id: optionalString(input.id, 'id', 128) || crypto.randomUUID(),
    tenantId: requiredString(context.tenantId, 'tenantId', 200),
    workspaceId: requiredString(input.workspaceId, 'workspaceId', 128),
    geographyId: optionalString(input.geographyId, 'geographyId', 240),
    itemType,
    title: optionalString(input.title, 'title', 500),
    content: validateWorkspaceContent(input.content || {}),
    status: optionalString(input.status, 'status', 80) || 'active',
    createdBy: requiredString(context.principalId, 'principalId', 200),
  };
}

class InMemoryWorkspaceMemory {
  constructor(options = {}) {
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
    this.items = new Map();
    this.events = [];
  }

  create(input, actor) {
    const item = normalizeWorkspaceItem(input, { tenantId: this.tenantId, principalId: actor.principalId });
    const now = this.clock();
    const record = { ...item, version: 1, createdAt: now, updatedAt: now, updatedBy: actor.principalId };
    const key = `${item.workspaceId}:${item.id}`;
    if (this.items.has(key)) throw new Error(`Workspace item ${item.id} already exists.`);
    this.items.set(key, clone(record));
    this.events.push({ tenantId: this.tenantId, workspaceId: item.workspaceId, itemId: item.id, eventType: 'workspace_item_created', version: 1, actorId: actor.principalId, payload: clone(record), occurredAt: now });
    return clone(record);
  }

  update(workspaceId, itemId, patch, expectedVersion, actor) {
    requiredString(workspaceId, 'workspaceId', 128);
    requiredString(itemId, 'itemId', 128);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('expectedVersion must be a positive integer.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('workspace patch must be an object.');
    const allowed = new Set(['title', 'content', 'status']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`Unsupported workspace patch field ${key}.`);
    const key = `${workspaceId}:${itemId}`;
    const current = this.items.get(key);
    if (!current) return null;
    if (current.version !== expectedVersion) {
      const error = new Error('Workspace item version conflict.');
      error.code = 'VERSION_CONFLICT';
      throw error;
    }
    const now = this.clock();
    const next = {
      ...current,
      ...(Object.prototype.hasOwnProperty.call(patch, 'title') ? { title: optionalString(patch.title, 'title', 500) } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'content') ? { content: validateWorkspaceContent(patch.content) } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'status') ? { status: requiredString(patch.status, 'status', 80) } : {}),
      version: current.version + 1,
      updatedAt: now,
      updatedBy: actor.principalId,
    };
    this.items.set(key, clone(next));
    this.events.push({ tenantId: this.tenantId, workspaceId, itemId, eventType: 'workspace_item_updated', version: next.version, actorId: actor.principalId, payload: clone(patch), occurredAt: now });
    return clone(next);
  }

  get(workspaceId, itemId) {
    return clone(this.items.get(`${workspaceId}:${itemId}`) || null);
  }

  list(workspaceId, options = {}) {
    const status = options.status || null;
    return [...this.items.values()]
      .filter((item) => item.workspaceId === workspaceId && (!status || item.status === status))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(clone);
  }

  history(workspaceId, itemId = null) {
    return this.events.filter((event) => event.workspaceId === workspaceId && (!itemId || event.itemId === itemId)).map(clone);
  }
}

module.exports = {
  InMemoryWorkspaceMemory,
  WORKSPACE_ITEM_TYPES,
  normalizeWorkspaceItem,
  validateWorkspaceContent,
};
