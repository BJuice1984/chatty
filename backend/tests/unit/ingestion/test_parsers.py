"""Deterministic parser coverage over the committed fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.ingestion.parsers import ParseError, extract_text

FIXTURES = Path(__file__).parents[2] / 'fixtures' / 'documents'


def fixture_bytes(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


def test_docx_fixture_extracts_paragraphs_and_table():
    text = extract_text('sample.docx', fixture_bytes('sample.docx'))

    assert 'Chatty RAG fixture document.' in text
    assert 'Vector retrieval returns the most similar chunk for a query.' in text
    assert 'format parser' in text
    assert 'docx python-docx' in text


def test_pdf_fixture_extracts_text_layer_without_ocr():
    text = extract_text('sample.pdf', fixture_bytes('sample.pdf'))

    assert 'Chatty text PDF fixture.' in text
    assert 'Retrieval is chat scoped and returns file ids.' in text


def test_pdf_without_text_layer_yields_empty_string():
    assert extract_text('empty.pdf', fixture_bytes('empty.pdf')) == ''


def test_xlsx_fixture_extracts_cells():
    text = extract_text('sample.xlsx', fixture_bytes('sample.xlsx'))

    assert 'embedding portable json vector' in text
    assert 'scope chat membership' in text


def test_corrupt_docx_fails_explicitly():
    with pytest.raises(ParseError) as excinfo:
        extract_text('corrupt.docx', fixture_bytes('corrupt.docx'))

    assert excinfo.value.kind == 'parse_failed'


def test_unsupported_suffix_fails_explicitly():
    with pytest.raises(ParseError) as excinfo:
        extract_text('notes.txt', b'plain text is not an office format')

    assert excinfo.value.kind == 'unsupported_content_type'


def test_doc_suffix_uses_the_injected_converter():
    calls: list[bytes] = []

    def fake_converter(body: bytes) -> bytes:
        calls.append(body)
        return fixture_bytes('sample.docx')

    text = extract_text('sample.doc', b'legacy-binary-doc-bytes', fake_converter)

    assert calls == [b'legacy-binary-doc-bytes']
    assert 'Chatty RAG fixture document.' in text


def test_doc_suffix_without_converter_fails_explicitly():
    with pytest.raises(ParseError) as excinfo:
        extract_text('sample.doc', b'legacy-binary-doc-bytes', None)

    assert excinfo.value.kind == 'converter_failed'
