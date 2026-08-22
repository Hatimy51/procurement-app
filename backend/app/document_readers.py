"""
Converts non-text enquiry sources (Excel files, screenshots) into plain text,
so they can flow through the SAME extraction engine as pasted email text.
This keeps one extraction pipeline instead of building separate logic per
file format — the only thing that changes per format is how we get to text.
"""
import io


def read_xlsx_as_text(file_bytes: bytes) -> str:
    """
    Reads every sheet/row/cell of an Excel file and renders it as a plain
    text table. Excel enquiries are already structured, so this text is
    usually cleaner and easier to extract from than free-form email prose.
    """
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    lines = []
    for sheet in wb.worksheets:
        for row in sheet.iter_rows(values_only=True):
            cells = [str(c) if c is not None else "" for c in row]
            if any(cells):  # skip fully empty rows
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def read_csv_as_text(file_bytes: bytes) -> str:
    return file_bytes.decode("utf-8", errors="ignore")


def read_image_as_text(file_bytes: bytes) -> str:
    """
    OCR for screenshots/photos of enquiries (e.g. a tabled enquiry embedded
    in an email as an image, which can't be copy-pasted as text at all).
    Uses Tesseract — free, runs locally, no per-use cost, consistent with
    the zero-cost v1 constraint. Expect this to be the least reliable of
    the three input paths (OCR quality varies with image clarity).
    """
    import pytesseract
    from PIL import Image

    image = Image.open(io.BytesIO(file_bytes))
    return pytesseract.image_to_string(image)


def extract_text_from_upload(filename: str, file_bytes: bytes) -> str:
    """Dispatches to the right reader based on file extension."""
    lower = filename.lower()
    if lower.endswith((".xlsx", ".xls")):
        return read_xlsx_as_text(file_bytes)
    elif lower.endswith(".csv"):
        return read_csv_as_text(file_bytes)
    elif lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
        return read_image_as_text(file_bytes)
    else:
        raise ValueError(
            f"Unsupported file type for '{filename}'. "
            "Supported: .xlsx, .xls, .csv, .png, .jpg, .jpeg, .webp"
        )
