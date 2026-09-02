import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const OUTCOME_LABEL = {
  enquiry_created: 'Enquiry created',
  enquiry_creation_failed: 'Enquiry creation failed',
  quote_matched: 'Supplier price added',
  quote_ingestion_failed: 'Reply reading failed',
  attachment_unreadable: "Attachment couldn't be read",
  unmatched_supplier: 'Unrecognized sender',
  logged_only: 'Logged only',
}
const OUTCOME_STAMP = {
  enquiry_created: 'stamp-success',
  quote_matched: 'stamp-success',
  enquiry_creation_failed: 'stamp-danger',
  quote_ingestion_failed: 'stamp-danger',
  attachment_unreadable: 'stamp-danger',
  unmatched_supplier: 'stamp-warning',
  logged_only: 'stamp-neutral',
}

export default function Inbox() {
  const [status, setStatus] = useState(null)
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [connecting, setConnecting] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [filterMode, setFilterMode] = useState('workflow') // 'workflow' | 'all'

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, a] = await Promise.all([api.getInboxStatus(), api.getInboxActivity()])
      setStatus(s)
      setActivity(a)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    // If we just came back from Google's consent screen, the backend
    // redirected here with a query param — surface the result once.
    const params = new URLSearchParams(window.location.search)
    if (params.get('inbox') === 'connected') {
      setInfoMessage('Gmail connected.')
      window.history.replaceState({}, '', window.location.pathname)
    } else if (params.get('inbox_error')) {
      setError(`Couldn't connect: ${decodeURIComponent(params.get('inbox_error'))}`)
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [load])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      const { auth_url } = await api.startInboxConnect()
      window.location.href = auth_url
    } catch (e) {
      setError(e.message)
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect this inbox? Scanning will stop until you reconnect.')) return
    setError(null)
    try {
      await api.disconnectInbox()
      setInfoMessage('Inbox disconnected.')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleScan() {
    setScanning(true)
    setError(null)
    try {
      const result = await api.scanInbox()
      const summary = []
      if (result.enquiries_created > 0) summary.push(`${result.enquiries_created} enquiry(ies) created`)
      if (result.quotes_matched > 0) summary.push(`${result.quotes_matched} supplier price(s) added`)
      if (summary.length === 0) {
        setInfoMessage(`Scanned ${result.messages_found} message(s) — no new workflow items found.`)
      } else {
        setInfoMessage(`Scanned ${result.messages_found} message(s) — ${summary.join(', ')}.`)
      }
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

  const enquiryActivity = activity.filter(
    (a) => a.category === 'new_enquiry' || a.outcome.includes('enquiry')
  )
  const vendorActivity = activity.filter(
    (a) => a.category === 'supplier_quote' || a.outcome.includes('quote') || a.outcome === 'unmatched_supplier'
  )
  const workflowActivity = activity.filter((a) => a.outcome !== 'logged_only')
  const attentionActivity = activity.filter(
    (a) =>
      a.outcome === 'unmatched_supplier' ||
      a.outcome === 'enquiry_creation_failed' ||
      a.outcome === 'quote_ingestion_failed' ||
      a.outcome === 'attachment_unreadable'
  )

  let displayedActivity = activity
  if (filterMode === 'enquiries') displayedActivity = enquiryActivity
  else if (filterMode === 'vendor_quotes') displayedActivity = vendorActivity
  else if (filterMode === 'workflow') displayedActivity = workflowActivity
  else if (filterMode === 'attention') displayedActivity = attentionActivity

  return (
    <div>
      <PageHeader
        eyebrow="Automation"
        title="Inbox"
        description="Connect your Gmail so new enquiries and supplier replies can be picked up automatically, instead of pasting them in by hand."
      />

      {error && <div className="banner banner-error">{error}</div>}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : status?.connected ? (
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ margin: 0, fontSize: 14 }}>
                Connected as <strong>{status.email_address}</strong>
              </p>
              <p style={styles.muted}>
                Connected {new Date(status.connected_at).toLocaleString()}
                {status.last_scanned_at && <> · Last scanned {new Date(status.last_scanned_at).toLocaleString()}</>}
              </p>
            </div>
            <div>
              <button className="btn btn-primary" onClick={handleScan} disabled={scanning}>
                {scanning ? 'Scanning…' : 'Scan Now'}
              </button>
              <button className="btn-link btn-link-danger" style={{ marginLeft: 12 }} onClick={handleDisconnect}>
                Disconnect
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 18, marginBottom: 20 }}>
          <p style={{ marginTop: 0 }}>No inbox connected yet.</p>
          <button className="btn btn-primary" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Redirecting…' : 'Connect Gmail'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Activity Log</h3>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={filterMode === 'enquiries' ? 'btn btn-secondary btn-sm' : 'btn btn-sm'}
            style={filterMode !== 'enquiries' ? { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink-soft)' } : {}}
            onClick={() => setFilterMode('enquiries')}
          >
            Customer Enquiries ({enquiryActivity.length})
          </button>

          <button
            type="button"
            className={filterMode === 'vendor_quotes' ? 'btn btn-secondary btn-sm' : 'btn btn-sm'}
            style={filterMode !== 'vendor_quotes' ? { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink-soft)' } : {}}
            onClick={() => setFilterMode('vendor_quotes')}
          >
            Vendor Quotes ({vendorActivity.length})
          </button>

          <button
            type="button"
            className={filterMode === 'workflow' ? 'btn btn-secondary btn-sm' : 'btn btn-sm'}
            style={filterMode !== 'workflow' ? { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink-soft)' } : {}}
            onClick={() => setFilterMode('workflow')}
          >
            All Workflow Mails ({workflowActivity.length})
          </button>

          {attentionActivity.length > 0 && (
            <button
              type="button"
              className={filterMode === 'attention' ? 'btn btn-secondary btn-sm' : 'btn btn-sm'}
              style={filterMode !== 'attention' ? { background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#DC2626' } : { background: '#DC2626', color: '#fff' }}
              onClick={() => setFilterMode('attention')}
            >
              Attention Needed ({attentionActivity.length})
            </button>
          )}

          <button
            type="button"
            className={filterMode === 'all' ? 'btn btn-secondary btn-sm' : 'btn btn-sm'}
            style={filterMode !== 'all' ? { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink-soft)' } : {}}
            onClick={() => setFilterMode('all')}
          >
            All Scanned ({activity.length})
          </button>
        </div>
      </div>

      {displayedActivity.length === 0 ? (
        <p style={styles.muted}>
          {filterMode === 'workflow'
            ? 'No workflow-relevant emails (enquiries or quotes) scanned yet.'
            : 'Nothing scanned yet.'}
        </p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr><th>Subject</th><th>From</th><th>Category</th><th>Result</th><th>When</th></tr>
          </thead>
          <tbody>
            {displayedActivity.map((a) => (
              <tr key={a.id}>
                <td>{a.subject || '(no subject)'}</td>
                <td style={styles.muted}>{a.from_address || '—'}</td>
                <td className="num">{a.category}</td>
                <td><span className={`stamp ${OUTCOME_STAMP[a.outcome] || 'stamp-neutral'}`}>{OUTCOME_LABEL[a.outcome] || a.outcome}</span></td>
                <td>{a.received_at ? new Date(a.received_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const styles = {
  muted: { color: 'var(--color-muted)', fontSize: 13 },
}
