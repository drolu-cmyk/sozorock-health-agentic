const { normalizeWorkspaceItem, validateWorkspaceContent } = require('./workspace-memory');

function requiredString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function row(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: row.tenant_id,
    workspaceId: row.workspace_id,
    geographyId: row.geography_id,
    itemType: row.item_type,
    title: row.title,
    content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
    status: row.status,
    version: Number(row.version),
    createdBy: row.created_by,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedBy: row.updated_by,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

class SqlWorkspaceMemory {
  constructor(options = {}) {
    if (typeof options.query !== 'function') throw new Error('SqlWorkspaceMemory requires query(sql, params).');
    this.query = options.query;
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
  }

  async create(input, actor) {
    const item = normalizeWorkspaceItem(input, { tenantId: this.tenantId, principalId: actor.principalId });
    const now = this.clock();
    const sql = `
      WITH inserted AS (
        INSERT INTO cbcap_workspace_items
          (id, tenant_id, workspace_id, geography_id, item_type, title, content, status, version,
           created_by, created_at, updated_by, updated_at)
        VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8,1,$9,$10::timestamptz,$9,$10::timestamptz)
        RETURNING *
      ), event AS (
        INSERT INTO cbcap_workspace_events
          (tenant_id, workspace_id, item_id, version, event_type, actor_id, payload, occurred_at)
        SELECT tenant_id, workspace_id, id, 1, 'workspace_item_created', $9, to_jsonb(inserted), $10::timestamptz
        FROM inserted
      )
      SELECT * FROM inserted`;
    const result = await this.query(sql, [item.id, this.tenantId, item.workspaceId, item.geographyId, item.itemType, item.title, JSON.stringify(item.content), item.status, actor.principalId, now]);
    if (!result?.rows?.length) throw new Error('Workspace item was not created.');
    return row(result.rows[0]);
  }

  async update(workspaceId, itemId, patch, expectedVersion, actor) {
    workspaceId = requiredString(workspaceId, 'workspaceId', 128);
    itemId = requiredString(itemId, 'itemId', 128);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new Error('expectedVersion must be a positive integer.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('workspace patch must be an object.');
    const allowed = new Set(['title', 'content', 'status']);
    for (const key of Object.keys(patch)) if (!allowed.has(key)) throw new Error(`Unsupported workspace patch field ${key}.`);
    const title = Object.prototype.hasOwnProperty.call(patch, 'title') ? (patch.title ? requiredString(patch.title, 'title', 500) : null) : null;
    const content = Object.prototype.hasOwnProperty.call(patch, 'content') ? validateWorkspaceContent(patch.content) : null;
    const status = Object.prototype.hasOwnProperty.call(patch, 'status') ? requiredString(patch.status, 'status', 80) : null;
    const now = this.clock();
    const sql = `
      WITH updated AS (
        UPDATE cbcap_workspace_items
        SET title = CASE WHEN $6 THEN $7 ELSE title END,
            content = CASE WHEN $8 THEN $9::jsonb ELSE content END,
            status = CASE WHEN $10 THEN $11 ELSE status END,
            version = version + 1,
            updated_by = $5,
            updated_at = $12::timestamptz
        WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3::uuid AND version=$4
        RETURNING *
      ), event AS (
        INSERT INTO cbcap_workspace_events
          (tenant_id, workspace_id, item_id, version, event_type, actor_id, payload, occurred_at)
        SELECT tenant_id, workspace_id, id, version, 'workspace_item_updated', $5, $13::jsonb, $12::timestamptz
        FROM updated
      )
      SELECT * FROM updated`;
    const result = await this.query(sql, [
      this.tenantId, workspaceId, itemId, expectedVersion, actor.principalId,
      Object.prototype.hasOwnProperty.call(patch, 'title'), title,
      Object.prototype.hasOwnProperty.call(patch, 'content'), JSON.stringify(content || {}),
      Object.prototype.hasOwnProperty.call(patch, 'status'), status,
      now, JSON.stringify(patch),
    ]);
    if (!result?.rows?.length) {
      const error = new Error('Workspace item was not found or its version changed.');
      error.code = 'VERSION_CONFLICT';
      throw error;
    }
    return row(result.rows[0]);
  }

  async get(workspaceId, itemId) {
    const result = await this.query('SELECT * FROM cbcap_workspace_items WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3::uuid', [this.tenantId, requiredString(workspaceId, 'workspaceId', 128), requiredString(itemId, 'itemId', 128)]);
    return result?.rows?.length ? row(result.rows[0]) : null;
  }

  async list(workspaceId, options = {}) {
    const status = options.status ? requiredString(options.status, 'status', 80) : null;
    const result = await this.query('SELECT * FROM cbcap_workspace_items WHERE tenant_id=$1 AND workspace_id=$2 AND ($3::text IS NULL OR status=$3) ORDER BY updated_at DESC, id', [this.tenantId, requiredString(workspaceId, 'workspaceId', 128), status]);
    return (result?.rows || []).map(row);
  }
}

module.exports = { SqlWorkspaceMemory, row };
