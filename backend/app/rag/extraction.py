"""
Text extraction from uploaded documents.

Supported formats:
  - .txt / .md — read directly as UTF-8
  - .pdf       — extracted with pypdf, with local OCR fallback for scanned pages
  - .docx      — extracted with python-docx
  - image files — local OCR for PNG, JPEG, WebP, BMP and TIFF

Returns plain text. Formatting is intentionally stripped — for RAG we want
clean, dense text, not markdown tables or heading marks.
"""
from __future__ import annotations

import pathlib
import zipfile

SUPPORTED_EXTENSIONS = {
    ".txt", ".md", ".pdf", ".docx",
    ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff",
}
SUPPORTED_MIME_TYPES = {
    "text/plain",
    "text/markdown",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/bmp",
    "image/tiff",
}


def extract_text(file_path: str | pathlib.Path) -> str:
    path = pathlib.Path(file_path)
    ext = path.suffix.lower()

    if ext in (".txt", ".md"):
        return _extract_text_file(path)
    if ext == ".pdf":
        return _extract_pdf(path)
    if ext == ".docx":
        return _extract_docx(path)
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}:
        return _extract_image(path)

    raise ValueError(f"Unsupported file type: {ext!r}. Supported: {', '.join(sorted(SUPPORTED_EXTENSIONS))}")


def _extract_text_file(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def _extract_pdf(path: pathlib.Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise ImportError("pypdf is required for PDF extraction. Install it with: pip install pypdf") from exc

    reader = PdfReader(str(path))
    parts = []
    for page in reader.pages:
        text = page.extract_text()
        if text:
            parts.append(text.strip())
    text = "\n\n".join(parts)
    if text.strip():
        return text
    return _ocr_pdf(path)


def _extract_docx(path: pathlib.Path) -> str:
    try:
        from docx import Document
    except ImportError as exc:
        raise ImportError("python-docx is required for DOCX extraction. Install it with: pip install python-docx") from exc

    doc = Document(str(path))
    paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
    text = "\n\n".join(paragraphs)

    # DOCX stores embedded images in word/media. OCR their labels when present.
    try:
        with zipfile.ZipFile(path) as archive:
            image_names = [name for name in archive.namelist() if name.startswith("word/media/")]
            image_text = []
            for name in image_names:
                image_text.append(_ocr_image_bytes(archive.read(name)))
        visual_text = "\n\n".join(part for part in image_text if part.strip())
    except (ImportError, OSError, zipfile.BadZipFile) as exc:
        raise ValueError(f"Could not inspect embedded DOCX images: {exc}") from exc

    return "\n\n".join(part for part in (text, visual_text) if part.strip())


def _extract_image(path: pathlib.Path) -> str:
    return _ocr_image_bytes(path.read_bytes())


def _ocr_pdf(path: pathlib.Path) -> str:
    try:
        import fitz
    except ImportError as exc:
        raise ImportError("PyMuPDF is required to OCR scanned PDFs. Install it with: pip install PyMuPDF") from exc

    document = fitz.open(str(path))
    try:
        parts = []
        for page in document:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            text = _ocr_image_bytes(pixmap.tobytes("png"))
            if text.strip():
                parts.append(text.strip())
        return "\n\n".join(parts)
    finally:
        document.close()


def _ocr_image_bytes(data: bytes) -> str:
    try:
        from io import BytesIO
        from PIL import Image
        import pytesseract
    except ImportError as exc:
        raise ImportError(
            "Pillow and pytesseract are required for image OCR. "
            "Install dependencies and Tesseract OCR on the host."
        ) from exc

    try:
        with Image.open(BytesIO(data)) as image:
            return pytesseract.image_to_string(image).strip()
    except Exception as exc:
        raise ValueError(f"Could not read image for OCR: {exc}") from exc
