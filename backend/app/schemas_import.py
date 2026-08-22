from pydantic import BaseModel


class ImportPreviewOut(BaseModel):
    headers: list[str]
    sample_rows: list[list[str]]
    total_rows: int


class ImportCommitOut(BaseModel):
    rows_processed: int
    products_created: int
    products_matched: int
    price_entries_created: int
    rows_skipped: int
    skipped_reason_sample: list[str]
