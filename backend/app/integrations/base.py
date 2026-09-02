from abc import ABC, abstractmethod
from typing import Any, Dict


class BaseERPAdapter(ABC):
    """Abstract Base Class for all ERP and Accounting software integrations."""

    @abstractmethod
    def push_purchase_order(self, po_data: Dict[str, Any]) -> Dict[str, Any]:
        """Pushes a Purchase Order to the external ERP."""
        raise NotImplementedError

    @abstractmethod
    def push_invoice(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        """Pushes a Vendor Invoice to the external ERP."""
        raise NotImplementedError

    @abstractmethod
    def get_payment_status(self, external_id: str) -> Dict[str, Any]:
        """Fetches the payment status of an invoice from the external ERP."""
        raise NotImplementedError
