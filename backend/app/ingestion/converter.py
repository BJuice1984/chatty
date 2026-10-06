"""Bounded `.doc` conversion through an external converter subprocess.

The command is injectable so deterministic tests never need LibreOffice; the
live checklist row runs the host converter. A hard timeout and an explicit
failure state are part of the stage contract.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from app.ingestion.config import DEFAULT_CONVERTER_COMMAND


class ConversionError(Exception):
    """Explicit converter failure with a stable machine-readable kind."""

    def __init__(self, kind: str, detail: str = ''):
        super().__init__(detail or kind)
        self.kind = kind


class DocConverter:
    """Convert legacy `.doc` bytes to `.docx` bytes with a hard timeout."""

    def __init__(self, command: tuple[str, ...] = DEFAULT_CONVERTER_COMMAND, *, timeout_seconds: float = 30.0):
        self.command = command
        self.timeout_seconds = timeout_seconds

    def to_docx(self, body: bytes) -> bytes:
        with tempfile.TemporaryDirectory(prefix='chatty-doc-') as tmp:
            source = Path(tmp) / 'source.doc'
            source.write_bytes(body)
            try:
                completed = subprocess.run(  # noqa: S603 - bounded, injectable command
                    [*self.command, str(source), '--outdir', tmp],
                    capture_output=True,
                    timeout=self.timeout_seconds,
                    check=False,
                )
            except subprocess.TimeoutExpired as exc:
                raise ConversionError('converter_timeout', f'converter exceeded {self.timeout_seconds}s') from exc
            converted = Path(tmp) / 'source.docx'
            if completed.returncode != 0 or not converted.is_file():
                detail = completed.stderr.decode(errors='replace').strip()[:200]
                raise ConversionError('converter_failed', f'converter exited with {completed.returncode}: {detail}')
            return converted.read_bytes()


def default_converter(timeout_seconds: float) -> DocConverter:
    return DocConverter(timeout_seconds=timeout_seconds)
