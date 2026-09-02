import requests
from typing import Any, Dict

from .base import BaseERPAdapter


class ZohoBooksAdapter(BaseERPAdapter):
    def __init__(self, api_key: str, organization_id: str):
        self.api_key = api_key
        self.org_id = organization_id
        self.base_url = "https://www.zohoapis.com/books/v3"
        self.headers = {
            "Authorization": f"Zoho-oauthtoken {self.api_key}",
            "Content-Type": "application/json",
        }

    def push_purchase_order(self, po_data: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/purchaseorders?organization_id={self.org_id}"
        payload = {
            "vendor_name": po_data.get("supplier_name"),
            "reference_number": po_data.get("po_number"),
            "date": po_data.get("created_date") or po_data.get("date"),
            "line_items": [
                {
                    "name": item.get("description"),
                    "rate": item.get("unit_price"),
                    "quantity": item.get("quantity"),
                    "unit": item.get("unit_of_measure", item.get("unit", "pcs")),
                }
                for item in po_data.get("items", [])
            ],
        }

        try:
            response = requests.post(url, json=payload, headers=self.headers, timeout=30)
            if response.status_code in (200, 201):
                data = response.json()
                return {
                    "success": True,
                    "external_id": data.get("purchaseorder", {}).get("purchaseorder_id"),
                }
            return {"success": False, "error": response.text}
        except requests.RequestException as exc:
            return {"success": False, "error": f"Zoho request failed: {exc}"}

    def push_invoice(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        url = f"{self.base_url}/bills?organization_id={self.org_id}"
        payload = {
            "vendor_name": invoice_data.get("supplier_name"),
            "bill_number": invoice_data.get("invoice_number"),
            "line_items": [
                {
                    "name": item.get("description"),
                    "rate": item.get("unit_price"),
                    "quantity": item.get("quantity", item.get("quantity_invoiced")),
                }
                for item in invoice_data.get("items", [])
            ],
        }

        try:
            response = requests.post(url, json=payload, headers=self.headers, timeout=30)
            if response.status_code in (200, 201):
                return {
                    "success": True,
                    "external_id": response.json().get("bill", {}).get("bill_id"),
                }
            return {"success": False, "error": response.text}
        except requests.RequestException as exc:
            return {"success": False, "error": f"Zoho request failed: {exc}"}

    def get_payment_status(self, external_id: str, record_type: str = "vendor_invoice") -> Dict[str, Any]:
        endpoint = "invoices" if record_type == "invoice" else "bills"
        url = f"{self.base_url}/{endpoint}/{external_id}?organization_id={self.org_id}"
        try:
            response = requests.get(url, headers=self.headers, timeout=30)
            if response.status_code == 200:
                data = response.json()
                record = data.get("invoice") if record_type == "invoice" else data.get("bill", {})
                status_raw = str(record.get("status", "")).lower()
                is_paid = status_raw in ("paid", "settled")
                return {
                    "status": "paid" if is_paid else status_raw or "unpaid",
                    "raw_status": status_raw,
                    "paid_amount": record.get("payment_made") or record.get("total", 0) if is_paid else 0,
                    "balance": record.get("balance", 0),
                }
            return {"status": "unknown", "error": response.text}
        except requests.RequestException as exc:
            return {"status": "unknown", "error": f"Zoho request failed: {exc}"}
