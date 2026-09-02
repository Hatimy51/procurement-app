import { useState } from 'react'
import { api } from './api'

/**
 * Pushes an existing PO or invoice to the configured accounting system.
 *
 * ERP credentials stay on the backend (.env); this component only sends
 * the ERP type, record type, and the record's canonical data.
 */
export default function SyncToERPButton({ recordData, recordType = 'po', erpType = 'zoho' }) {
  const [loading, setLoading] = useState(false)
  const [syncStatus, setSyncStatus] = useState(null)

  const normalizedData = recordType === 'invoice'
    ? {
        ...recordData,
        created_date: recordData.created_at,
        items: (recordData.items || []).map((item) => ({
          description: item.description,
          unit_price: item.unit_price,
          quantity: item.quantity ?? item.quantity_invoiced,
          unit_of_measure: item.unit,
        })),
      }
    : {
        ...recordData,
        created_date: recordData.created_at,
        date: recordData.created_at,
        items: (recordData.items || []).map((item) => ({
          description: item.description,
          unit_price: item.unit_price,
          quantity: item.quantity,
          unit_of_measure: item.unit,
        })),
      }

  async function handleSync() {
    setLoading(true)
    setSyncStatus(null)

    try {
      const resData = await api.syncToAccounting({
        erp_type: erpType,
        record_type: recordType,
        data: normalizedData,
      })

      setSyncStatus({
        success: true,
        message: `Synced successfully! Ref: ${resData.result?.external_id || 'created'}`,
      })
    } catch (err) {
      setSyncStatus({
        success: false,
        message: err.message || 'Sync failed.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        className="btn btn-secondary"
        onClick={handleSync}
        disabled={loading}
        style={{ padding: '6px 12px', cursor: loading ? 'default' : 'pointer' }}
      >
        {loading ? 'Pushing to ERP…' : 'Push to Accounting (ERP)'}
      </button>

      {syncStatus && (
        <span
          style={{
            marginLeft: 10,
            fontSize: 13,
            color: syncStatus.success ? '#047857' : '#DC2626',
          }}
        >
          {syncStatus.message}
        </span>
      )}
    </div>
  )
}
