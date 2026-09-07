const crypto = require('crypto');
const { normalizeMetric } = require('../cbcap/metric-registry');
const { permissionDecision } = require('./workspace-identity');
class SqlMetricRegistry {
  constructor({query,tenantId}) { if(typeof query !== 'function' || !tenantId) throw new Error('Tenant metric store is required.'); this.query=query;this.tenantId=tenantId; }
  authorize(actor,action) { const decision=permissionDecision(actor,action);if(!decision.ok || decision.actor.tenantId !== this.tenantId) throw new Error('Metric access denied.');return decision.actor; }
  async list(countyFips,actor) {
    this.authorize(actor,'cbcap.metrics.read');if(!/^\d{5}$/.test(countyFips))throw new Error('County scope is required.');
    const result=await this.query('SELECT id, county_fips, definition, version, review_status, reviewed_by, reviewed_at FROM cbcap_metric_registry WHERE tenant_id=$1 AND county_fips=$2 ORDER BY updated_at DESC LIMIT 200',[this.tenantId,countyFips]);return result.rows;
  }
  async create(input,actor) {
    actor=this.authorize(actor,'cbcap.metrics.write');const definition=normalizeMetric(input);const id=crypto.randomUUID();
    const result=await this.query(`WITH inserted AS (INSERT INTO cbcap_metric_registry (tenant_id,id,county_fips,definition,created_by) VALUES ($1,$2::uuid,$3,$4::jsonb,$5) RETURNING *), event AS (INSERT INTO cbcap_metric_events (tenant_id,metric_id,version,action,actor_id,definition) SELECT tenant_id,id,version,'created',$5,definition FROM inserted) SELECT * FROM inserted`,[this.tenantId,id,definition.countyFips,JSON.stringify(definition),actor.principalId]);return result.rows[0];
  }
  async review(id,version,actor) {
    actor=this.authorize(actor,'cbcap.metrics.review');if(!/^[0-9a-f-]{36}$/i.test(id) || !Number.isSafeInteger(version) || version<1)throw new Error('Exact metric version is required.');
    const result=await this.query(`WITH updated AS (UPDATE cbcap_metric_registry SET review_status='reviewed',reviewed_by=$4,reviewed_at=now(),version=version+1,updated_at=now() WHERE tenant_id=$1 AND id=$2::uuid AND version=$3 AND review_status='draft' RETURNING *), event AS (INSERT INTO cbcap_metric_events (tenant_id,metric_id,version,action,actor_id,definition) SELECT tenant_id,id,version,'reviewed',$4,definition FROM updated) SELECT * FROM updated`,[this.tenantId,id,version,actor.principalId]);if(!result.rows[0]){const e=new Error('Metric review version conflict.');e.code='VERSION_CONFLICT';throw e;}return result.rows[0];
  }
}
module.exports={SqlMetricRegistry};
