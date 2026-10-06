"""Bounded `.doc` converter behavior with injected commands (no LibreOffice needed)."""

from __future__ import annotations

import os
import stat
from pathlib import Path

import pytest

from app.ingestion.converter import ConversionError, DocConverter


def write_script(path: Path, body: str) -> tuple[str, ...]:
    path.write_text(f'#!/bin/sh\n{body}\n')
    mode = stat.S_IMODE(path.stat().st_mode) | stat.S_IXUSR
    os.chmod(path, mode)
    return (str(path),)


def test_successful_conversion_copies_input_to_docx(tmp_path: Path):
    command = write_script(tmp_path / 'ok.sh', 'cp "$1" "$(dirname "$1")/source.docx"')
    converter = DocConverter(command, timeout_seconds=5.0)

    assert converter.to_docx(b'docx-passthrough-bytes') == b'docx-passthrough-bytes'


def test_timeout_is_bounded_and_explicit(tmp_path: Path):
    command = write_script(tmp_path / 'slow.sh', 'sleep 5')
    converter = DocConverter(command, timeout_seconds=0.3)

    with pytest.raises(ConversionError) as excinfo:
        converter.to_docx(b'whatever')

    assert excinfo.value.kind == 'converter_timeout'


def test_nonzero_exit_is_an_explicit_failure(tmp_path: Path):
    command = write_script(tmp_path / 'fail.sh', 'exit 3')
    converter = DocConverter(command, timeout_seconds=5.0)

    with pytest.raises(ConversionError) as excinfo:
        converter.to_docx(b'whatever')

    assert excinfo.value.kind == 'converter_failed'


def test_missing_output_is_an_explicit_failure(tmp_path: Path):
    command = write_script(tmp_path / 'noop.sh', 'exit 0')
    converter = DocConverter(command, timeout_seconds=5.0)

    with pytest.raises(ConversionError) as excinfo:
        converter.to_docx(b'whatever')

    assert excinfo.value.kind == 'converter_failed'
