from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
BOOTSTRAP_STACK = (
    REPO_ROOT
    / "infrastructure"
    / "cloudformation"
    / "cbcap-private-deployment-bootstrap.yml"
)


def test_cloudformation_can_create_only_required_service_linked_roles():
    stack = BOOTSTRAP_STACK.read_text(encoding="utf-8")
    statement = stack.split("- Sid: CreateOnlyRequiredServiceLinkedRoles", 1)[1].split(
        "- Sid: FoundationDnsOnly", 1
    )[0]

    assert "Action: iam:CreateServiceLinkedRole" in statement
    assert "ecs.amazonaws.com/AWSServiceRoleForECS" in statement
    assert "rds.amazonaws.com/AWSServiceRoleForRDS" in statement
    assert "elasticloadbalancing.amazonaws.com/AWSServiceRoleForElasticLoadBalancing" in statement
    assert "- ecs.amazonaws.com" in statement
    assert "- rds.amazonaws.com" in statement
    assert "- elasticloadbalancing.amazonaws.com" in statement
    assert "Resource: '*'" not in statement


def test_service_linked_role_permission_is_not_given_to_github_deploy_role():
    stack = BOOTSTRAP_STACK.read_text(encoding="utf-8")
    github_role = stack.split("  GitHubDeployRole:", 1)[1]
    assert "iam:CreateServiceLinkedRole" not in github_role
