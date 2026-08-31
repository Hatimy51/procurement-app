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
      setInfoMessage(
        `Scanned ${result.messages_found} message(s) — ${result.enquiries_created} enquiry(ies) created, ` +
          `${result.quotes_matched} supplier price(s) added, ${result.logged_only} logged for review.`
      )
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setScanning(false)
    }
  }

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

      <h3>Activity</h3>
      {activity.length === 0 ? (
        <p style={styles.muted}>Nothing scanned yet.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr><th>Subject</th><th>From</th><th>Category</th><th>Result</th><th>When</th></tr>
          </thead>
          <tbody>
            {activity.map((a) => (
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
