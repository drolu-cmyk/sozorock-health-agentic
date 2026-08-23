from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SQL_ROOT = REPO_ROOT / "sql"


def read_sql(relative: str) -> str:
    return (SQL_ROOT / relative).read_text(encoding="utf-8")


def test_tenant_evidence_tables_are_private_append_only_and_kms_bound():
    sql = read_sql("007_tenant_private_evidence.sql")
    assert "cbcap.tenant_evidence_document" in sql
    assert "cbcap.tenant_evidence_review" in sql
    assert "encryption_mode = 'aws:kms'" in sql
    assert "CHECK (public_access_blocked)" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "tenant_evidence_document_tenant_isolation" in sql
    assert "tenant_evidence_review_tenant_isolation" in sql
    assert "tenant_evidence_document_append_only" in sql
    assert "tenant_evidence_review_append_only" in sql
    assert "prevent_tenant_evidence_mutation" in sql


def test_eligible_private_evidence_cannot_contain_prohibited_person_level_material():
    sql = read_sql("007_tenant_private_evidence.sql")
    assert "aggregation_level <> 'person_level'" in sql
    assert "NOT contains_phi" in sql
    assert "NOT contains_individual_health_records" in sql
    assert "NOT contains_credentials_or_secrets" in sql
    assert "usage_rights_confirmed" in sql


def test_review_trigger_matches_parent_tenant_and_blocks_invalid_acceptance():
    sql = read_sql("007_tenant_private_evidence.sql")
    assert "validate_tenant_evidence_review" in sql
    assert "document_record.tenant_id <> NEW.tenant_id" in sql
    assert "only eligible tenant evidence can be accepted" in sql
    assert "expired tenant evidence cannot be accepted" in sql
    assert "document_record.retention_until < NEW.reviewed_at::date" in sql
    assert "tenant_evidence_review_guard" in sql
    assert "tenant_evidence_one_acceptance_idx" in sql
    assert "tenant_evidence_review_timestamp_unique_idx" in sql


def test_tenant_evidence_rollback_refuses_to_erase_document_or_review_history():
    rollback = read_sql("rollback/007_tenant_private_evidence.down.sql")
    assert "Refusing to drop CB-CAP tenant-private evidence history" in rollback
    assert "SELECT 1 FROM cbcap.tenant_evidence_review" in rollback
    assert "SELECT 1 FROM cbcap.tenant_evidence_document" in rollback
