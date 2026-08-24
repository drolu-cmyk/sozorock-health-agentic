const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemoryWorkspaceMemory } = require('../packages/runtime/workspace-memory');

const actor = { principalId: 'planner-1' };

test('workspace memory creates versioned state and immutable audit events', () => {
  let tick = 0;
  const memory = new InMemoryWorkspaceMemory({ tenantId: 'tenant-a', clock: () => `2026-08-23T23:00:0${++tick}.000Z` });
  const created = memory.create({ workspaceId: 'workspace-1', itemType: 'task', title: 'Confirm partner', content: { owner: 'team' } }, actor);
  assert.equal(created.version, 1);
  const updated = memory.update('workspace-1', created.id, { content: { owner: 'team', done: true }, status: 'completed' }, 1, actor);
  assert.equal(updated.version, 2);
  assert.equal(updated.status, 'completed');
  assert.deepEqual(memory.history('workspace-1', created.id).map((event) => event.eventType), ['workspace_item_created','workspace_item_updated']);
  assert.equal(memory.get('workspace-1', created.id).version, 2);
});

test('workspace memory rejects stale edits instead of last-write-wins overwrite', () => {
  const memory = new InMemoryWorkspaceMemory({ tenantId: 'tenant-a' });
  const created = memory.create({ workspaceId: 'workspace-1', itemType: 'draft', content: { text: 'v1' } }, actor);
  memory.update('workspace-1', created.id, { content: { text: 'v2' } }, 1, actor);
  assert.throws(() => memory.update('workspace-1', created.id, { content: { text: 'stale' } }, 1, actor), (error) => error.code === 'VERSION_CONFLICT');
  assert.deepEqual(memory.get('workspace-1', created.id).content, { text: 'v2' });
});

test('workspace memory constrains item types, patch fields, and payload size', () => {
  const memory = new InMemoryWorkspaceMemory({ tenantId: 'tenant-a' });
  assert.throws(() => memory.create({ workspaceId: 'w', itemType: 'institutional_truth', content: {} }, actor), /unsupported/);
  const item = memory.create({ workspaceId: 'w', itemType: 'comment', content: { text: 'review' } }, actor);
  assert.throws(() => memory.update('w', item.id, { tenantId: 'tenant-b' }, 1, actor), /Unsupported workspace patch field/);
  assert.throws(() => memory.create({ workspaceId: 'w', itemType: 'draft', content: { text: 'x'.repeat(110000) } }, actor), /exceeds 100 KB/);
});
