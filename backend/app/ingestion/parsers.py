"""Deterministic text extraction for supported document formats.

Non-OCR by design: a PDF without a text layer yields an empty string and the
service records the explicit `no_text` failure state.
"""

from __future__ import annotations

from io import BytesIO

SUPPORTED_SUFFIXES = ('.docx', '.pdf', '.xlsx', '.doc')


class ParseError(Exception):
    """Explicit parser failure with a stable machine-readable kind."""

    def __init__(self, kind: str, detail: str = ''):
        super().__init__(detail or kind)
        self.kind = kind


def extract_text(original_name: str, body: bytes, docx_converter=None) -> str:
    """Extract document text by file suffix; `.doc` converts to docx first."""
    suffix = _suffix(original_name)
    if suffix == '.docx':
        return _parse_docx(body)
    if suffix == '.doc':
        if docx_converter is None:
            raise ParseError('converter_failed', 'no doc converter configured')
        return _parse_docx(docx_converter(body))
    if suffix == '.pdf':
        return _parse_pdf(body)
    if suffix == '.xlsx':
        return _parse_xlsx(body)
    raise ParseError('unsupported_content_type', f'unsupported file suffix: {suffix or "(none)"}')


def _suffix(original_name: str) -> str:
    dot = original_name.rfind('.')
    return original_name[dot:].lower() if dot >= 0 else ''


def _parse_docx(body: bytes) -> str:
    try:
        import docx

        document = docx.Document(BytesIO(body))
        parts = [paragraph.text for paragraph in document.paragraphs]
        for table in document.tables:
            for row in table.rows:
                parts.append(' '.join(cell.text for cell in row.cells))
        return '\n'.join(part for part in parts if part.strip())
    except ParseError:
        raise
    except Exception as exc:
        raise ParseError('parse_failed', f'docx parsing failed: {exc}') from exc


def _parse_pdf(body: bytes) -> str:
    try:
        from pypdf import PdfReader

        reader = PdfReader(BytesIO(body))
        return '\n'.join((page.extract_text() or '') for page in reader.pages)
    except Exception as exc:
        raise ParseError('parse_failed', f'pdf parsing failed: {exc}') from exc


def _parse_xlsx(body: bytes) -> str:
    try:
        import openpyxl

        workbook = openpyxl.load_workbook(BytesIO(body), read_only=True, data_only=True)
        parts = []
        for worksheet in workbook.worksheets:
            for row in worksheet.iter_rows(values_only=True):
                cells = [str(cell) for cell in row if cell is not None and str(cell).strip()]
                if cells:
                    parts.append(' '.join(cells))
        workbook.close()
        return '\n'.join(parts)
    except Exception as exc:
        raise ParseError('parse_failed', f'xlsx parsing failed: {exc}') from exc
