"""Provider-neutral public identity gateway core.

The initial implementation is intentionally fail-closed: it defines the
same-origin /auth/* surface without enabling an identity provider or accepting
credentials. A provider adapter can replace DisabledIdentityProvider later
without changing the public-site routes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Mapping, Protocol
from urllib.parse import urlsplit

SESSION_SCHEMA = "prototype-ordax.public-identity-session/1"
ERROR_SCHEMA = "prototype-ordax.public-identity-error/1"
JSON_CONTENT_TYPE = "application/json; charset=utf-8"
NO_STORE = "no-store, max-age=0"


@dataclass(frozen=True)
class GatewayResponse:
    status: int
    headers: tuple[tuple[str, str], ...]
    body: bytes


class IdentityProvider(Protocol):
    @property
    def configured(self) -> bool: ...

    def begin_login(self) -> str: ...

    def begin_registration(self) -> str: ...

    def complete_callback(self, query: str) -> str: ...

    def revoke_session(self, cookie_header: str | None) -> tuple[str, ...]: ...


class ProviderUnavailable(RuntimeError):
    pass


class DisabledIdentityProvider:
    @property
    def configured(self) -> bool:
        return False

    def _unavailable(self) -> str:
        raise ProviderUnavailable("identity provider is not configured")

    def begin_login(self) -> str:
        return self._unavailable()

    def begin_registration(self) -> str:
        return self._unavailable()

    def complete_callback(self, query: str) -> str:
        del query
        return self._unavailable()

    def revoke_session(self, cookie_header: str | None) -> tuple[str, ...]:
        del cookie_header
        self._unavailable()
        raise AssertionError("unreachable")


def _json_response(status: int, payload: Mapping[str, object]) -> GatewayResponse:
    body = (json.dumps(payload, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    return GatewayResponse(
        status=status,
        headers=(
            ("Content-Type", JSON_CONTENT_TYPE),
            ("Cache-Control", NO_STORE),
            ("Pragma", "no-cache"),
            ("X-Content-Type-Options", "nosniff"),
            ("Content-Length", str(len(body))),
        ),
        body=body,
    )


def _redirect(location: str, *, set_cookies: tuple[str, ...] = ()) -> GatewayResponse:
    headers: list[tuple[str, str]] = [
        ("Location", location),
        ("Cache-Control", NO_STORE),
        ("Pragma", "no-cache"),
        ("Content-Length", "0"),
    ]
    for cookie in set_cookies:
        headers.append(("Set-Cookie", cookie))
    return GatewayResponse(status=303, headers=tuple(headers), body=b"")


def _error(status: int, code: str, message: str) -> GatewayResponse:
    return _json_response(
        status,
        {
            "$schema": ERROR_SCHEMA,
            "error": code,
            "message": message,
        },
    )


def _safe_same_origin_path(value: str) -> bool:
    split = urlsplit(value)
    return (
        value.startswith("/")
        and not value.startswith("//")
        and not split.scheme
        and not split.netloc
        and not split.fragment
    )


class PublicIdentityGateway:
    def __init__(self, provider: IdentityProvider | None = None) -> None:
        self.provider = provider or DisabledIdentityProvider()

    def _provider_unavailable(self) -> GatewayResponse:
        return _error(
            503,
            "identity-provider-unavailable",
            "O serviço de identidade OrdaX ainda não está configurado.",
        )

    def handle(
        self,
        method: str,
        target: str,
        headers: Mapping[str, str] | None = None,
    ) -> GatewayResponse:
        method = method.upper()
        request_headers = {key.lower(): value for key, value in (headers or {}).items()}
        split = urlsplit(target)
        path = split.path

        if path == "/auth/session":
            if method != "GET":
                return self._method_not_allowed("GET")
            return _json_response(
                200,
                {
                    "$schema": SESSION_SCHEMA,
                    "authenticated": False,
                    "provider": "configured" if self.provider.configured else "unconfigured",
                    "status": "anonymous",
                },
            )

        if path == "/auth/login":
            if method != "GET":
                return self._method_not_allowed("GET")
            if not self.provider.configured:
                return self._provider_unavailable()
            try:
                location = self.provider.begin_login()
            except ProviderUnavailable:
                return self._provider_unavailable()
            if not _safe_same_origin_path(location):
                return _error(502, "invalid-provider-redirect", "O provedor retornou um destino inválido.")
            return _redirect(location)

        if path == "/auth/register":
            if method != "GET":
                return self._method_not_allowed("GET")
            if not self.provider.configured:
                return self._provider_unavailable()
            try:
                location = self.provider.begin_registration()
            except ProviderUnavailable:
                return self._provider_unavailable()
            if not _safe_same_origin_path(location):
                return _error(502, "invalid-provider-redirect", "O provedor retornou um destino inválido.")
            return _redirect(location)

        if path == "/auth/callback":
            if method != "GET":
                return self._method_not_allowed("GET")
            if not self.provider.configured:
                return self._provider_unavailable()
            try:
                location = self.provider.complete_callback(split.query)
            except ProviderUnavailable:
                return self._provider_unavailable()
            if not _safe_same_origin_path(location):
                return _error(502, "invalid-provider-redirect", "O callback retornou um destino inválido.")
            return _redirect(location)

        if path == "/auth/logout":
            if method != "POST":
                return self._method_not_allowed("POST")
            if not self.provider.configured:
                return self._provider_unavailable()
            if request_headers.get("sec-fetch-site") == "cross-site":
                return _error(403, "cross-site-request-rejected", "A solicitação cross-site foi rejeitada.")
            try:
                cookies = self.provider.revoke_session(request_headers.get("cookie"))
            except ProviderUnavailable:
                return self._provider_unavailable()
            return _redirect("/", set_cookies=cookies)

        if path.startswith("/auth/"):
            return _error(404, "identity-route-not-found", "Rota de identidade inexistente.")
        return _error(404, "not-found", "Recurso inexistente.")

    @staticmethod
    def _method_not_allowed(allowed: str) -> GatewayResponse:
        response = _error(405, "method-not-allowed", "Método não permitido.")
        return GatewayResponse(
            status=response.status,
            headers=response.headers + (("Allow", allowed),),
            body=response.body,
        )


gateway = PublicIdentityGateway()


def application(environ, start_response):
    """Minimal WSGI adapter; deployment remains external to this module."""

    method = str(environ.get("REQUEST_METHOD", "GET"))
    path = str(environ.get("PATH_INFO", "/"))
    query = str(environ.get("QUERY_STRING", ""))
    target = path + (("?" + query) if query else "")

    headers: dict[str, str] = {}
    for key, value in environ.items():
        if key.startswith("HTTP_") and isinstance(value, str):
            name = key[5:].replace("_", "-").lower()
            headers[name] = value

    response = gateway.handle(method, target, headers)
    reason = {
        200: "OK",
        303: "See Other",
        403: "Forbidden",
        404: "Not Found",
        405: "Method Not Allowed",
        502: "Bad Gateway",
        503: "Service Unavailable",
    }.get(response.status, "Error")
    start_response(f"{response.status} {reason}", list(response.headers))
    return [response.body]
