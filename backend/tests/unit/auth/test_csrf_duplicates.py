"""require_csrf against duplicate chatty_csrf cookies. On starlette 0.48.0
Request.cookies parses only the FIRST raw Cookie header
(headers.get('cookie')), and WITHIN one header the LAST duplicate name wins
(dict assignment) — either arrangement can shadow the fresh copy that
document.cookie shows. Live repro 2026-11-07 (POST /auth/logout → 403
csrf_failed with a matching header): two Cookie header entries, stale
path-scoped copy first. The check must match the header against ANY copy
across ALL Cookie headers. The two duplicate cases below are RED-GREEN
pinned: each MUST fail on the unpatched single-read require_csrf."""

from __future__ import annotations

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.core.config import Settings
from app.core.deps import require_csrf


def make_request(cookie_headers: str | list[str] | None, csrf_header_value: str | None) -> Request:
    headers = []
    if cookie_headers is not None:
        for entry in cookie_headers if isinstance(cookie_headers, list) else [cookie_headers]:
            headers.append((b'cookie', entry.encode()))
    if csrf_header_value is not None:
        headers.append((b'x-csrf-token', csrf_header_value.encode()))
    return Request({'type': 'http', 'method': 'POST', 'path': '/', 'query_string': b'', 'headers': headers})


@pytest.fixture
def settings() -> Settings:
    # require_csrf only reads the cookie/header names and the origin
    # allowlist; the jwt secret never enters the picture here
    return Settings(environment='test', allowed_origins=['http://localhost:3001'])


def test_matching_single_cookie_passes(settings: Settings) -> None:
    require_csrf(make_request('chatty_csrf=token-a', 'token-a'), settings)


def test_two_cookie_header_entries_stale_first_passes(settings: Settings) -> None:
    # RED-GREEN (live logout repro shape): the unpatched check reads only the
    # FIRST Cookie header and sees the stale copy → 403; any-copy matching
    # accepts the fresh value the header carries
    require_csrf(
        make_request(['chatty_csrf=stale-path-copy', 'chatty_csrf=fresh'], 'fresh'),
        settings,
    )


def test_single_header_fresh_first_stale_last_passes(settings: Settings) -> None:
    # RED-GREEN: within one header the LAST duplicate wins on starlette — the
    # unpatched check sees the stale copy → 403; any-copy matching accepts
    require_csrf(make_request('chatty_csrf=fresh; chatty_csrf=stale-path-copy', 'fresh'), settings)


def test_single_header_stale_first_is_no_regression_either_way(settings: Settings) -> None:
    # completeness of the matrix, NOT a red case: stale-first within one
    # header keeps the fresh copy even unpatched (last-duplicate-wins)
    require_csrf(make_request('chatty_csrf=stale-path-copy; chatty_csrf=fresh', 'fresh'), settings)


def test_header_must_match_at_least_one_copy(settings: Settings) -> None:
    with pytest.raises(HTTPException) as error:
        require_csrf(
            make_request(['chatty_csrf=stale-path-copy', 'chatty_csrf=fresh'], 'other'),
            settings,
        )

    assert error.value.status_code == 403
    assert error.value.detail == 'csrf_failed'


def test_missing_header_or_cookie_is_forbidden(settings: Settings) -> None:
    with pytest.raises(HTTPException):
        require_csrf(make_request('chatty_csrf=token-a', None), settings)

    with pytest.raises(HTTPException):
        require_csrf(make_request(None, 'token-a'), settings)
