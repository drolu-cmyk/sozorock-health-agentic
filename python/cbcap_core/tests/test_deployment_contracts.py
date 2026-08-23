import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DOCKERFILE = REPO_ROOT / "Dockerfile.runtime"
DOCKERIGNORE = REPO_ROOT / ".dockerignore"
REGISTRY_STACK = REPO_ROOT / "infrastructure" / "cloudformation" / "cbcap-runtime-registry.yml"
RUNTIME_STACK = REPO_ROOT / "infrastructure" / "cloudformation" / "cbcap-private-runtime.yml"
BOOTSTRAP_STACK = REPO_ROOT / "infrastructure" / "cloudformation" / "cbcap-private-deployment-bootstrap.yml"
CI_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "ci.yml"
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
    assert "CB_CAP_ALLOWED_ORIGINS, Value: 'https://cbcap.sozorockfoundation.org'" in stack


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
    assert "MfaConfiguration: ON" in stack
    assert "AllowAdminCreateUserOnly: true" in stack
    assert "AttributesRequireVerificationBeforeUpdate:" in stack
    assert "AccessTokenValidity: 15" in stack
    assert "ELBSecurityPolicy-TLS13-1-2-2021-06" in stack
    assert "EnableExecuteCommand: false" in stack
    assert "routing.http.desync_mitigation_mode, Value: strictest" in stack
    assert "deletion_protection.enabled, Value: 'true'" in stack
    assert "EnableCloudwatchLogsExports:" in stack


def test_private_evidence_bucket_denies_wrong_encryption_on_write():
    stack = _text(RUNTIME_STACK)
    policy = stack.split("  PrivateEvidenceBucketPolicy:", 1)[1].split("\n  UserPool:", 1)[0]
    assert "RequireExplicitKmsEncryption" in policy
    assert "s3:x-amz-server-side-encryption: aws:kms" in policy
    assert "RequirePrivateEvidenceKmsKey" in policy
    assert "s3:x-amz-server-side-encryption-aws-kms-key-id: !GetAtt PrivateEvidenceKey.Arn" in policy


def test_https_listener_forwards_only_the_canonical_api_host():
    stack = _text(RUNTIME_STACK)
    listener = stack.split("  HttpsListener:", 1)[1].split("\n  WebAcl:", 1)[0]
    assert "Type: fixed-response" in listener
    assert "StatusCode: '404'" in listener
    assert "HttpsHostRule:" in listener
    assert "Field: host-header" in listener
    assert "- !Ref DomainName" in listener
    assert "TargetGroupArn: !Ref TargetGroup" in listener


def test_migrations_are_a_separate_task_before_runtime_scale_up():
    stack = _text(RUNTIME_STACK)
    assert "MigrationTaskDefinition:" in stack
    assert "Command: [python, -m, cbcap_core.migration_runner]" in stack
    assert "CB_CAP_MIGRATION_ROOT, Value: /app/sql" in stack


def test_migration_task_receives_the_runtime_role_password_secret():
    stack = _text(RUNTIME_STACK)
    migration = stack.split("  MigrationTaskDefinition:", 1)[1].split("\n  MembershipAdminTaskDefinition:", 1)[0]
    assert "- Name: CB_CAP_DATABASE_PASSWORD\n              ValueFrom: !Ref RuntimeDatabasePassword" in migration
    assert "- Name: CB_CAP_MIGRATION_DATABASE_USERNAME" in migration
    assert "- Name: CB_CAP_MIGRATION_DATABASE_PASSWORD" in migration


def test_runtime_migration_and_membership_admin_identities_are_separated():
    stack = _text(RUNTIME_STACK)
    runtime_role = stack.split("  RuntimeTaskExecutionRole:", 1)[1].split("\n  MigrationTaskExecutionRole:", 1)[0]
    migration_role = stack.split("  MigrationTaskExecutionRole:", 1)[1].split("\n  MembershipAdminTaskExecutionRole:", 1)[0]
    membership_role = stack.split("  MembershipAdminTaskExecutionRole:", 1)[1].split("\n  RuntimeTaskRole:", 1)[0]
    runtime_task = stack.split("  RuntimeTaskDefinition:", 1)[1].split("\n  MigrationTaskDefinition:", 1)[0]
    migration_task = stack.split("  MigrationTaskDefinition:", 1)[1].split("\n  MembershipAdminTaskDefinition:", 1)[0]
    membership_task = stack.split("  MembershipAdminTaskDefinition:", 1)[1].split("\n  Certificate:", 1)[0]

    assert "RuntimeDatabasePassword" in runtime_role
    assert "CheckpointEncryptionKey" in runtime_role
    assert "Database.MasterUserSecret" not in runtime_role

    assert "RuntimeDatabasePassword" in migration_role
    assert "Database.MasterUserSecret" in migration_role
    assert "CheckpointEncryptionKey" not in migration_role

    assert "Database.MasterUserSecret" in membership_role
    assert "RuntimeDatabasePassword" not in membership_role
    assert "CheckpointEncryptionKey" not in membership_role

    assert "ExecutionRoleArn: !GetAtt RuntimeTaskExecutionRole.Arn" in runtime_task
    assert "TaskRoleArn: !GetAtt RuntimeTaskRole.Arn" in runtime_task
    assert "ExecutionRoleArn: !GetAtt MigrationTaskExecutionRole.Arn" in migration_task
    assert "TaskRoleArn:" not in migration_task
    assert "ExecutionRoleArn: !GetAtt MembershipAdminTaskExecutionRole.Arn" in membership_task
    assert "TaskRoleArn:" not in membership_task
    assert "Command: [python, -m, cbcap_core.membership_admin]" in membership_task


def test_deployment_identity_roles_cannot_manage_themselves_or_run_membership_admin():
    stack = _text(BOOTSTRAP_STACK)
    assert "RoleName: cbcap-private-cloudformation" in stack
    assert "RoleName: cbcap-private-github-deploy" in stack
    assert "token.actions.githubusercontent.com:sub: !Sub repo:${GitHubRepository}:environment:${GitHubEnvironment}" in stack
    assert "Default: cbcap-private-runtime-" in stack
    assert "role/${RuntimeRolePrefix}*" in stack
    assert "role/${RuntimeStackPrefix}*" not in stack
    assert "iam:PassedToService: cloudformation.amazonaws.com" in stack
    assert "iam:PassedToService: ecs-tasks.amazonaws.com" in stack
    assert "task-definition/cbcap-migration:*" in stack
    assert "task-definition/cbcap-membership-admin:*" not in stack


def test_ci_and_release_actions_are_pinned_to_full_commit_shas():
    for path in (CI_WORKFLOW, DEPLOY_WORKFLOW):
        workflow = _text(path)
        uses_lines = [line.strip() for line in workflow.splitlines() if line.strip().startswith("uses:")]
        assert uses_lines
        for line in uses_lines:
            match = re.fullmatch(r"uses:\s+[^@\s]+@([0-9a-f]{40})(?:\s+#.*)?", line)
            assert match is not None, f"external action must be SHA pinned: {line}"


def test_deployment_workflow_keeps_migration_before_service_enablement():
    workflow = _text(DEPLOY_WORKFLOW)
    zero_index = workflow.index("DesiredCount=0")
    migration_index = workflow.index("aws ecs run-task")
    one_index = workflow.index("DesiredCount=1")
    assert zero_index < migration_index < one_index
    assert "api.cbcap.sozorockfoundation.org/healthz" in workflow
    assert "api.cbcap.sozorockfoundation.org/readyz" in workflow
    assert "CBCAP_PRIVATE_AWS_DEPLOY_ROLE_ARN" in workflow
    assert "CBCAP_PRIVATE_CLOUDFORMATION_ROLE_ARN" in workflow
    assert "image-scan-complete" in workflow
    assert "cbcap-membership-admin" not in workflow
