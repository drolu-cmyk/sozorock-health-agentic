BEGIN;

-- LangGraph creates these durable tables before this governed migration runs.
-- Every persisted checkpoint row is scoped by the canonical thread identifier:
--   cbcap:<tenant_id>:county-run:<run_id>
--
-- FORCE RLS is deliberate. The shared runtime database role must never be able
-- to read or write another tenant's checkpoint state even if application code
-- regresses. An absent tenant setting fails closed.

ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoints FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_blobs FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_writes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_writes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cbcap_checkpoint_tenant_isolation ON public.checkpoints;
CREATE POLICY cbcap_checkpoint_tenant_isolation
  ON public.checkpoints
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND left(
      thread_id,
      length('cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:')
    ) = 'cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:'
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND left(
      thread_id,
      length('cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:')
    ) = 'cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:'
  );

DROP POLICY IF EXISTS cbcap_checkpoint_blob_tenant_isolation ON public.checkpoint_blobs;
CREATE POLICY cbcap_checkpoint_blob_tenant_isolation
  ON public.checkpoint_blobs
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND left(
      thread_id,
      length('cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:')
    ) = 'cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:'
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND left(
      thread_id,
      length('cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:')
    ) = 'cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:'
  );

DROP POLICY IF EXISTS cbcap_checkpoint_write_tenant_isolation ON public.checkpoint_writes;
CREATE POLICY cbcap_checkpoint_write_tenant_isolation
  ON public.checkpoint_writes
  USING (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND left(
      thread_id,
      length('cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:')
    ) = 'cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:'
  )
  WITH CHECK (
    nullif(current_setting('app.tenant_id', true), '') IS NOT NULL
    AND left(
      thread_id,
      length('cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:')
    ) = 'cbcap:' || nullif(current_setting('app.tenant_id', true), '') || ':county-run:'
  );

COMMENT ON POLICY cbcap_checkpoint_tenant_isolation ON public.checkpoints IS
  'Fail-closed tenant isolation for durable CB-CAP LangGraph checkpoints.';
COMMENT ON POLICY cbcap_checkpoint_blob_tenant_isolation ON public.checkpoint_blobs IS
  'Fail-closed tenant isolation for durable CB-CAP LangGraph checkpoint blobs.';
COMMENT ON POLICY cbcap_checkpoint_write_tenant_isolation ON public.checkpoint_writes IS
  'Fail-closed tenant isolation for durable CB-CAP LangGraph checkpoint writes.';

COMMIT;
