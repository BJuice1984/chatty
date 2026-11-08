"""Deterministic RTF value escaping and template filling.

The shipped templates (r7-office RTF, ``{\\rtf1\\ansi\\ansicpg0}``) encode
every character — Cyrillic AND digits/dots/spaces/underscores — as
``\\uNNNN*`` decimal escapes with a ``*`` fallback byte (D-F-18,
byte-verified 2026-11-08). Values render in the SAME profile, so their
interpretation never depends on the reader's code page; ASCII tokens are
inserted into text runs as literal bytes.
"""

from __future__ import annotations

import re

TOKEN_RE = re.compile(r'\{\{(\w+)\}\}')


def escape_rtf_text(value: str) -> str:
    """Escape one value for insertion into an RTF text run.

    Safe ASCII passes through, ``\\ { }`` are backslash-escaped, everything
    else becomes a ``\\uNNNN*`` decimal escape (matching the template
    profile). Code points beyond the signed-16-bit RTF range never occur
    in the Russian forms; they degrade to ``?`` instead of corrupting the
    document.
    """

    out: list[str] = []
    for ch in value:
        code = ord(ch)
        if 32 <= code < 128:
            out.append('\\' + ch if ch in '{}\\' else ch)
        elif code <= 32767:
            out.append(f'\\u{code}*')
        else:
            out.append('?')
    return ''.join(out)


def template_tokens(rtf_bytes: bytes) -> set[str]:
    """Token names carried by a template (ASCII ``{{name}}`` placeholders)."""

    return set(TOKEN_RE.findall(rtf_bytes.decode('latin-1')))


def fill(rtf_bytes: bytes, values: dict[str, str]) -> bytes:
    """Fill a template byte-for-byte deterministically.

    The mapping keys must equal the template's token set exactly — a
    missing or extra key raises ``ValueError`` naming the difference, and
    an unresolved token after filling is an error rather than a silently
    shipped document.
    """

    text = rtf_bytes.decode('latin-1')
    expected = template_tokens(rtf_bytes)
    missing = sorted(expected - values.keys())
    extra = sorted(values.keys() - expected)
    if missing or extra:
        raise ValueError(f'template token mismatch: missing={missing} extra={extra}')
    for key in sorted(values):
        text = text.replace('{{' + key + '}}', escape_rtf_text(values[key]))
    if '{{' in text:
        raise ValueError('unresolved template tokens remain after filling')
    return text.encode('latin-1')
