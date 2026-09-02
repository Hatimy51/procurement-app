from .base import BaseERPAdapter
from .zoho_adapter import ZohoBooksAdapter
from .tally_adapter import TallyAdapter


def get_erp_adapter(erp_type: str, config: dict | None = None) -> BaseERPAdapter:
    config = config or {}
    normalized = erp_type.strip().lower()

    if normalized == "zoho":
        return ZohoBooksAdapter(
            api_key=config.get("zoho_api_key", ""),
            organization_id=config.get("zoho_org_id", ""),
        )
    if normalized == "tally":
        return TallyAdapter(
            host_url=config.get("tally_url", "http://localhost:9000"),
        )
    raise ValueError(
        f"Unsupported ERP type: '{erp_type}'. Contact admin to set up ERP connection."
    )
