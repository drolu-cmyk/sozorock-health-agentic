from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import jwt
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError
from pydantic import Field, model_validator

from .identity_adapter import VerifiedExternalPrincipal
from .models import StrictModel


class CognitoVerifierSettings(StrictModel):
    region: str = Field(pattern=r"^[a-z]{2}(?:-gov)?-[a-z]+-\d$")
    user_pool_id: str = Field(pattern=r"^[a-z]{2}(?:-gov)?-[a-z]+-\d_[A-Za-z0-9]+$")
    app_client_id: str = Field(min_length=1, max_length=256)
    required_scopes: list[str] = Field(default_factory=list)
    resource_audience: str | None = Field(default=None, min_length=1, max_length=2048)
    jwks_cache_seconds: int = Field(default=300, ge=60, le=3600)
    jwks_timeout_seconds: float = Field(default=5.0, gt=0, le=30)
    max_token_bytes: int = Field(default=16 * 1024, ge=1024, le=64 * 1024)

    @model_validator(mode="after")
    def validate_pool_and_scopes(self) -> "CognitoVerifierSettings":
        if not self.user_pool_id.startswith(f"{self.region}_"):
            raise ValueError("Cognito user pool region does not match configured region")
        if len(set(self.required_scopes)) != len(self.required_scopes):
            raise ValueError("required Cognito scopes must be unique")
        if any(not item.strip() or any(char.isspace() for char in item) for item in self.required_scopes):
            raise ValueError("required Cognito scopes must be nonblank single scope values")
        return self

    @property
    def issuer(self) -> str:
        return f"https://cognito-idp.{self.region}.amazonaws.com/{self.user_pool_id}"

    @property
    def jwks_uri(self) -> str:
        return f"{self.issuer}/.well-known/jwks.json"


class CognitoAccessTokenVerifier:
    """Verify Cognito access tokens before any CB-CAP role or tenant lookup.

    Cognito groups are deliberately ignored. CB-CAP authorization comes from
    the append-only server-side workspace membership registry after this token
    has established only the external principal identity.
    """

    def __init__(self, settings: CognitoVerifierSettings) -> None:
        self.settings = settings
        self._jwks = PyJWKClient(
            settings.jwks_uri,
            cache_jwk_set=True,
            lifespan=settings.jwks_cache_seconds,
            timeout=settings.jwks_timeout_seconds,
            headers={"User-Agent": "cbcap-core/cognito-jwt-v1"},
        )

    @staticmethod
    def _required_string(payload: dict[str, Any], name: str) -> str:
        value = payload.get(name)
        if not isinstance(value, str) or not value.strip():
            raise PermissionError(f"verified Cognito token is missing required {name} claim")
        return value

    @staticmethod
    def _required_epoch(payload: dict[str, Any], name: str) -> datetime:
        value = payload.get(name)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise PermissionError(f"verified Cognito token has invalid {name} claim")
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except (OverflowError, OSError, ValueError) as exc:
            raise PermissionError(f"verified Cognito token has invalid {name} claim") from exc

    def verify(self, token: str) -> VerifiedExternalPrincipal:
        candidate = token.strip()
        if not candidate:
            raise PermissionError("Cognito access token is required")
        if len(candidate.encode("utf-8")) > self.settings.max_token_bytes:
            raise PermissionError("Cognito access token exceeds the accepted size")
        if candidate.count(".") != 2:
            raise PermissionError("Cognito access token format is invalid")

        try:
            signing_key = self._jwks.get_signing_key_from_jwt(candidate)
            payload = jwt.decode(
                candidate,
                key=signing_key.key,
                algorithms=["RS256"],
                issuer=self.settings.issuer,
                options={
                    "require": [
                        "sub",
                        "iss",
                        "exp",
                        "iat",
                        "auth_time",
                        "jti",
                        "client_id",
                        "token_use",
                    ],
                    "verify_aud": False,
                },
            )
        except (InvalidTokenError, PyJWKClientError, OSError, TimeoutError) as exc:
            raise PermissionError("Cognito access token verification failed") from exc

        if not isinstance(payload, dict):
            raise PermissionError("Cognito access token payload is invalid")
        if self._required_string(payload, "iss") != self.settings.issuer:
            raise PermissionError("Cognito access token issuer is invalid")
        if self._required_string(payload, "client_id") != self.settings.app_client_id:
            raise PermissionError("Cognito access token app client is invalid")
        if self._required_string(payload, "token_use") != "access":
            raise PermissionError("Cognito token is not an access token")

        if self.settings.resource_audience is not None:
            audience = payload.get("aud")
            if audience != self.settings.resource_audience:
                raise PermissionError("Cognito access token resource audience is invalid")

        scope_value = payload.get("scope", "")
        if scope_value is not None and not isinstance(scope_value, str):
            raise PermissionError("Cognito access token scope claim is invalid")
        token_scopes = set((scope_value or "").split())
        missing_scopes = sorted(set(self.settings.required_scopes) - token_scopes)
        if missing_scopes:
            raise PermissionError("Cognito access token is missing required API scope")

        subject = self._required_string(payload, "sub")
        token_id = self._required_string(payload, "jti")
        authenticated_at = self._required_epoch(payload, "auth_time")
        expires_at = self._required_epoch(payload, "exp")
        issued_at = self._required_epoch(payload, "iat")
        if authenticated_at > issued_at:
            raise PermissionError("Cognito access token authentication time is invalid")
        if issued_at >= expires_at:
            raise PermissionError("Cognito access token lifetime is invalid")

        return VerifiedExternalPrincipal(
            subject=subject,
            issuer=self.settings.issuer,
            session_id=token_id,
            verification_method="oidc_jwt_verified",
            authenticated_at=authenticated_at,
            expires_at=expires_at,
        )
