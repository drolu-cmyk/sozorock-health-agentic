BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.checkpoints LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.checkpoint_blobs LIMIT 1)
     OR EXISTS (SELECT 1 FROM public.checkpoint_writes LIMIT 1) THEN
    RAISE EXCEPTION
      'refusing to disable checkpoint tenant isolation while durable checkpoint data exists';
  END IF;
END;
$$;

DROP POLICY IF EXISTS cbcap_checkpoint_tenant_isolation ON public.checkpoints;
DROP POLICY IF EXISTS cbcap_checkpoint_blob_tenant_isolation ON public.checkpoint_blobs;
DROP POLICY IF EXISTS cbcap_checkpoint_write_tenant_isolation ON public.checkpoint_writes;

ALTER TABLE public.checkpoints NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoints DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_blobs NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_blobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_writes NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_writes DISABLE ROW LEVEL SECURITY;

COMMIT;
