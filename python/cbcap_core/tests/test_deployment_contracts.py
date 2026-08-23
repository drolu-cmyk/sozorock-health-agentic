from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = REPO_ROOT / "Dockerfile.runtime"
DOCKERIGNORE = REPO_ROOT / ".dockerignore"
REGISTRY_STACK = REPO_ROOT / "infrastructure" / "cloudformation" / "cbcap-runtime-registry.yml"
RUNTIME_STACK = REPO_ROOT / "infrastructure" / "cloudformation" / "cbcap-private-runtime.yml"
DEPLOY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy-private-runtime.yml"


def _text(path: Path) -> str:
    assert path.is_file(), f"required deployment artifact is missing: {path.relative_to(REPO_ROOT)}"
    return path.read_text(encoding="utf-8")


def test_runtime_image_contains_governed_migrations():
    dockerfile = _text(DOCKERFILE)
    dockerignore = _text(DOCKERIGNORE)

    assert "COPY sql /app/sql" in dockerfile
    ignored = {
        line.strip()
        for line in dockerignore.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }
    assert "sql" not in ignored
    assert "/sql" not in ignored


def test_registry_uses_immutable_scanned_images():
    stack = _text(REGISTRY_STACK)
    assert "ImageTagMutability: IMMUTABLE" in stack
    assert "ScanOnPush: true" in stack
    assert "DeletionPolicy: Retain" in stack


def test_private_runtime_is_separate_from_public_cbcap_frontend():
    stack = _text(RUNTIME_STACK)
    assert "Default: api.cbcap.sozorockfoundation.org" in stack
    assert "Default: https://health.sozorockfoundation.org/api/evidence/v1/gateway" in stack
    assert "Default: cbcap.sozorockfoundation.org" not in stack
    assert "DesiredCount:\n    Type: Number\n    Default: 0" in stack


def test_private_runtime_has_required_security_and_state_components():
    stack = _text(RUNTIME_STACK)
    required_resources = (
        "Type: AWS::RDS::DBInstance",
        "Type: AWS::Cognito::UserPool",
        "Type: AWS::Cognito::UserPoolClient",
        "Type: AWS::KMS::Key",
        "Type: AWS::S3::Bucket",
        "Type: AWS::ECS::Cluster",
        "Type: AWS::ECS::TaskDefinition",
        "Type: AWS::ECS::Service",
        "Type: AWS::ElasticLoadBalancingV2::LoadBalancer",
        "Type: AWS::WAFv2::WebACL",
        "Type: AWS::CertificateManager::Certificate",
        "Type: AWS::Route53::RecordSet",
    )
    for resource in required_resources:
        assert resource in stack

    assert "StorageEncrypted: true" in stack
    assert "PubliclyAccessible: false" in stack
    assert "DeletionProtection: true" in stack
    assert "BlockPublicAcls: true" in stack
    assert "RestrictPublicBuckets: true" in stack
    assert "EnableKeyRotation: true" in stack
    assert "MfaConfiguration: OPTIONAL" in stack
    assert "AccessTokenValidity: 15" in stack
    assert "ELBSecurityPolicy-TLS13-1-2-2021-06" in stack


def test_migrations_are_a_separate_task_before_runtime_scale_up():
    stack = _text(RUNTIME_STACK)
    assert "MigrationTaskDefinition:" in stack
    assert "Command: [python, -m, cbcap_core.migration_runner]" in stack
    assert "CB_CAP_MIGRATION_ROOT, Value: /app/sql" in stack


def test_deployment_workflow_keeps_migration_before_service_enablement():
    workflow = _text(DEPLOY_WORKFLOW)
    zero_index = workflow.index("DesiredCount=0")
    migration_index = workflow.index("aws ecs run-task")
    one_index = workflow.index("DesiredCount=1")
    assert zero_index < migration_index < one_index
    assert "api.cbcap.sozorockfoundation.org/healthz" in workflow
    assert "api.cbcap.sozorockfoundation.org/readyz" in workflow
    assert "CBCAP_PRIVATE_AWS_DEPLOY_ROLE_ARN" in workflow
