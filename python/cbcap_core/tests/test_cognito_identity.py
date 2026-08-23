from __future__ import annotations

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.cognito_identity import CognitoAccessTokenVerifier, CognitoVerifierSettings

REGION = "us-east-1"
POOL = "us-east-1_Example123"
CLIENT = "client-example-123"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{POOL}"
AUTH_TIME = 1787490000
IAT = 1787490060
EXP = 1787493660
TOKEN = "header.payload.signature"


def settings(**updates):
    payload = {
        "region": REGION,
        "user_pool_id": POOL,
        "app_client_id": CLIENT,
        "required_scopes": ["cbcap/workspace"],
        "resource_audience": "https://api.cbcap.sozorockfoundation.org",
    }
    payload.update(updates)
    return CognitoVerifierSettings(**payload)


def valid_payload(**updates):
    payload = {
        "sub": "subject-opaque-123",
        "iss": ISSUER,
        "exp": EXP,
        "iat": IAT,
        "auth_time": AUTH_TIME,
        "jti": "token-jti-123",
        "client_id": CLIENT,
        "token_use": "access",
        "scope": "openid cbcap/workspace",
        "aud": "https://api.cbcap.sozorockfoundation.org",
        "cognito:groups": ["admin"],
    }
    payload.update(updates)
    return payload


class FakeSigningKey:
    key = object()


class FakeJwks:
    def __init__(self):
        self.tokens = []

    def get_signing_key_from_jwt(self, token):
        self.tokens.append(token)
        return FakeSigningKey()


def verifier(monkeypatch, payload):
    instance = CognitoAccessTokenVerifier(settings())
    fake_jwks = FakeJwks()
    instance._jwks = fake_jwks
    observed = {}

    def fake_decode(token, *, key, algorithms, issuer, options):
        observed.update(
            {
                "token": token,
                "key": key,
                "algorithms": algorithms,
                "issuer": issuer,
                "options": options,
            }
        )
        return payload

    monkeypatch.setattr("cbcap_core.cognito_identity.jwt.decode", fake_decode)
    return instance, fake_jwks, observed


def test_settings_bind_user_pool_to_exact_region():
    with pytest.raises(ValidationError, match="region"):
        CognitoVerifierSettings(
            region="us-east-1",
            user_pool_id="us-west-2_Example123",
            app_client_id=CLIENT,
        )


def test_verified_access_token_produces_identity_not_role(monkeypatch):
    instance, fake_jwks, observed = verifier(monkeypatch, valid_payload())
    principal = instance.verify(TOKEN)

    assert fake_jwks.tokens == [TOKEN]
    assert observed["algorithms"] == ["RS256"]
    assert observed["issuer"] == ISSUER
    assert observed["options"]["verify_aud"] is False
    assert set(observed["options"]["require"]) >= {
        "sub",
        "iss",
        "exp",
        "iat",
        "auth_time",
        "jti",
        "client_id",
        "token_use",
    }
    assert principal.subject == "subject-opaque-123"
    assert principal.issuer == ISSUER
    assert principal.session_id == "token-jti-123"
    assert principal.authenticated_at == datetime.fromtimestamp(AUTH_TIME, tz=timezone.utc)
    assert principal.expires_at == datetime.fromtimestamp(EXP, tz=timezone.utc)
    serialized = principal.model_dump(mode="json")
    assert "role" not in serialized
    assert "cognito:groups" not in serialized


@pytest.mark.parametrize(
    ("payload_updates", "message"),
    [
        ({"client_id": "other-client"}, "app client"),
        ({"token_use": "id"}, "not an access token"),
        ({"iss": "https://attacker.example.test"}, "issuer"),
        ({"aud": "https://other.example.test"}, "resource audience"),
        ({"scope": "openid profile"}, "required API scope"),
        ({"scope": ["cbcap/workspace"]}, "scope claim"),
    ],
)
def test_verified_claims_still_fail_closed_when_semantics_are_wrong(
    monkeypatch,
    payload_updates,
    message,
):
    instance, _, _ = verifier(monkeypatch, valid_payload(**payload_updates))
    with pytest.raises(PermissionError, match=message):
        instance.verify(TOKEN)


def test_authentication_time_cannot_follow_issued_at(monkeypatch):
    instance, _, _ = verifier(
        monkeypatch,
        valid_payload(auth_time=IAT + 1),
    )
    with pytest.raises(PermissionError, match="authentication time"):
        instance.verify(TOKEN)


def test_malformed_or_oversize_tokens_are_rejected_before_jwks_network_access(monkeypatch):
    instance, fake_jwks, _ = verifier(monkeypatch, valid_payload())
    with pytest.raises(PermissionError, match="format"):
        instance.verify("not-a-jwt")
    assert fake_jwks.tokens == []

    small_limit = CognitoAccessTokenVerifier(settings(max_token_bytes=1024))
    small_limit._jwks = fake_jwks
    oversized = "a." + ("b" * 1100) + ".c"
    with pytest.raises(PermissionError, match="size"):
        small_limit.verify(oversized)
    assert fake_jwks.tokens == []
