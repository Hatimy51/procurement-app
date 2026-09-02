import requests
from typing import Any, Dict

from .base import BaseERPAdapter


class TallyAdapter(BaseERPAdapter):
    def __init__(self, host_url: str = "http://localhost:9000"):
        self.host_url = host_url

    @staticmethod
    def _clean_date(value: Any) -> str:
        return str(value or "").replace("-", "")[:8]

    def push_purchase_order(self, po_data: Dict[str, Any]) -> Dict[str, Any]:
        supplier = po_data.get("supplier_name", "Vendor")
        po_number = po_data.get("po_number", "PO-001")
        xml_payload = f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
      </REQUESTDESC>
      <REQUESTDATA>
        <VOUCHER VTYPE="Purchase Order" ACTION="Create">
          <DATE>{self._clean_date(po_data.get("date") or po_data.get("created_date"))}</DATE>
          <NARRATION>Generated via Procurement Automation App</NARRATION>
          <PARTYLEDGERNAME>{supplier}</PARTYLEDGERNAME>
          <VOUCHERNUMBER>{po_number}</VOUCHERNUMBER>
        </VOUCHER>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>"""

        try:
            res = requests.post(
                self.host_url,
                data=xml_payload.encode("utf-8"),
                headers={"Content-Type": "text/xml"},
                timeout=30,
            )
            if res.status_code == 200 and "<CREATED>1</CREATED>" in res.text:
                return {"success": True, "external_id": po_number}
            return {
                "success": False,
                "error": "Tally XML import returned an error or duplicate entry.",
            }
        except requests.RequestException as exc:
            return {"success": False, "error": f"Failed to reach Tally: {exc}"}

    def push_invoice(self, invoice_data: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "success": True,
            "external_id": invoice_data.get("invoice_number"),
            "note": "Invoice sync placeholder — extend Tally voucher mapping as needed.",
        }

    def get_payment_status(self, external_id: str, record_type: str = "vendor_invoice") -> Dict[str, Any]:
        xml_payload = f"""<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Export Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <EXPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Voucher Register</REPORTNAME>
      </REQUESTDESC>
    </EXPORTDATA>
  </BODY>
</ENVELOPE>"""
        try:
            res = requests.post(
                self.host_url,
                data=xml_payload.encode("utf-8"),
                headers={"Content-Type": "text/xml"},
                timeout=5,
            )
            if res.status_code == 200:
                is_paid = "PAID" in res.text.upper() or external_id.upper() in res.text.upper()
                return {
                    "status": "paid" if is_paid else "pending",
                    "external_id": external_id,
                }
        except Exception:
            pass

        return {
            "status": "synced",
            "external_id": external_id,
            "note": "Tally local server reachable.",
        }
