from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DEPLOY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy-private-runtime.yml"


def test_first_private_stack_creation_preserves_protected_resources_for_repair():
    workflow = DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    provision = workflow.split(
        "- name: Provision private infrastructure with runtime disabled", 1
    )[1].split("- name: Apply append-only database migrations before serving traffic", 1)[0]

    assert "aws cloudformation describe-stacks" in provision
    assert "CREATE_FAILED" in provision
    assert "rollback_flag=--disable-rollback" in provision
    assert "rollback_flag=--no-disable-rollback" in provision
    assert '"$rollback_flag"' in provision
    assert "DesiredCount=0" in provision


def test_post_migration_runtime_enablement_restores_normal_cloudformation_rollback():
    workflow = DEPLOY_WORKFLOW.read_text(encoding="utf-8")
    enable = workflow.split(
        "- name: Enable one governed runtime task after migrations succeed", 1
    )[1].split("- name: Prove live health, readiness, ingress, CORS, and authentication boundaries", 1)[0]

    assert "--no-disable-rollback" in enable
    assert "DesiredCount=1" in enable
