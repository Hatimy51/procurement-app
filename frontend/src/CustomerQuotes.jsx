import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const STATUS_LABEL = { draft: 'Draft', approved: 'Approved', sent: 'Sent' }
const STATUS_STAMP = { draft: 'stamp-neutral', approved: 'stamp-accent', sent: 'stamp-success' }

function StatusBadge({ status }) {
  return (
    <span className={`stamp ${STATUS_STAMP[status] || 'stamp-neutral'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

export default function CustomerQuotes() {
  const [ready, setReady] = useState([])
  const [quotes, setQuotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)
  const [generatingId, setGeneratingId] = useState(null)

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [notesDraft, setNotesDraft] = useState('')
  const [priceDrafts, setPriceDrafts] = useState({}) // line_item_id -> price string
  const [approverName, setApproverName] = useState('')
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [readyData, quotesData] = await Promise.all([
        api.listReadyEnquiries(),
        api.listCustomerQuotes(),
      ])
      setReady(readyData)
      setQuotes(quotesData)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  async function handleGenerate(enquiryId) {
    setGeneratingId(enquiryId)
    setError(null)
    try {
      const quote = await api.generateQuote(enquiryId)
      await loadList()
      openDetail(quote.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setGeneratingId(null)
    }
  }

  async function openDetail(id) {
    setSelectedId(id)
    setDetailLoading(true)
    setError(null)
    try {
      const data = await api.getCustomerQuoteDetail(id)
      setDetail(data)
      setNotesDraft(data.notes || '')
      const drafts = {}
      data.items.forEach((i) => { drafts[i.id] = i.unit_price ?? '' })
      setPriceDrafts(drafts)
      setApproverName(data.approved_by_name || '')
    } catch (e) {
      setError(e.message)
    } finally {
      setDetailLoading(false)
    }
  }

  function backToList() {
    setSelectedId(null)
    setDetail(null)
    setPriceDrafts({})
    setApproverName('')
  }

  async function refreshDetail() {
    const data = await api.getCustomerQuoteDetail(selectedId)
    setDetail(data)
    const drafts = {}
    data.items.forEach((i) => { drafts[i.id] = i.unit_price ?? '' })
    setPriceDrafts(drafts)
  }

  async function handleSaveDraft() {
    setSaving(true)
    setError(null)
    try {
      const items = detail.items.map((i) => ({
        id: i.id,
        unit_price: priceDrafts[i.id] === '' ? null : priceDrafts[i.id],
      }))
      await api.updateQuoteDraft(selectedId, { notes: notesDraft, items })
      setInfoMessage('Draft saved.')
      await refreshDetail()
      loadList()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleApprove() {
    setApproving(true)
    setError(null)
    try {
      await api.approveQuote(selectedId, approverName)
      setInfoMessage('Quote approved.')
      await refreshDetailFull()
      loadList()
    } catch (e) {
      setError(e.message)
    } finally {
      setApproving(false)
    }
  }

  async function refreshDetailFull() {
    const data = await api.getCustomerQuoteDetail(selectedId)
    setDetail(data)
    setApproverName(data.approved_by_name || '')
  }

  async function handleRevert() {
    if (!window.confirm('Send this quote back to draft? It will need to be re-approved before it can be sent.')) return
    setError(null)
    try {
      await api.revertQuoteToDraft(selectedId)
      setInfoMessage('Reverted to draft.')
      await refreshDetail()
      loadList()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleMarkSent() {
    if (!window.confirm('Mark this quote as sent? This locks it — no further edits will be possible.')) return
    setError(null)
    try {
      await api.markQuoteSent(selectedId)
      setInfoMessage('Marked as sent.')
      await refreshDetailFull()
      loadList()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this draft quote? The enquiry will go back to the ready-to-quote queue.')) return
    setError(null)
    try {
      await api.deleteCustomerQuote(selectedId)
      setInfoMessage('Quote deleted.')
      backToList()
      loadList()
    } catch (e) {
      setError(e.message)
    }
  }

  function updatePriceDraft(id, value) {
    setPriceDrafts((d) => ({ ...d, [id]: value }))
  }

  const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // ---- Detail view ----
  if (selectedId && detail) {
    const isDraft = detail.status === 'draft'
    const isApproved = detail.status === 'approved'
    const isSent = detail.status === 'sent'

    return (
      <div>
        <div style={styles.detailHeader} className="no-print">
          <button style={styles.linkButton} onClick={backToList}>← Back to list</button>
          <div>
            <button style={styles.secondaryButton} onClick={() => window.print()}>Print / Export</button>
            {isDraft && (
              <button style={styles.dangerLinkButton} onClick={handleDelete}>Delete draft</button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-mono)', color: 'var(--color-ink)' }}>{detail.quote_number}</h2>
          <StatusBadge status={detail.status} />
        </div>
        <p style={styles.muted}>
          {detail.customer_name} · {detail.site_name} · Created {new Date(detail.created_at).toLocaleString()}
        </p>
        {detail.approved_by_name && (
          <p style={styles.muted}>
            Approved by {detail.approved_by_name} on {new Date(detail.approved_at).toLocaleString()}
          </p>
        )}
        {detail.sent_at && (
          <p style={styles.muted}>Sent {new Date(detail.sent_at).toLocaleString()}</p>
        )}

        {error && <div style={styles.errorBanner} className="no-print">{error}</div>}
        {infoMessage && <div style={styles.infoBanner} className="no-print">{infoMessage}</div>}
        {isDraft && detail.items_price_missing > 0 && (
          <div style={styles.warnBanner}>
            {detail.items_price_missing} item(s) still have no price — fill those in before this quote can be approved.
          </div>
        )}

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Description</th>
              <th style={styles.th}>Spec</th>
              <th style={styles.th}>Qty</th>
              <th style={styles.th}>Unit</th>
              <th style={styles.th}>Unit Price</th>
              <th style={styles.th}>GST %</th>
              <th style={styles.th}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((item) => {
              const price = isDraft ? priceDrafts[item.id] : item.unit_price
              const lineTotal = price !== '' && price != null ? Number(price) * Number(item.quantity) : null
              return (
                <tr key={item.id} style={styles.tr}>
                  <td style={styles.td}>{item.description}</td>
                  <td style={styles.td}>{item.spec || '—'}</td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>{item.quantity}</td>
                  <td style={styles.td}>{item.unit}</td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>
                    {isDraft ? (
                      <input
                        style={styles.priceInput}
                        type="number"
                        step="0.01"
                        placeholder="Price Missing"
                        value={priceDrafts[item.id]}
                        onChange={(e) => updatePriceDraft(item.id, e.target.value)}
                      />
                    ) : (
                      item.unit_price != null ? money(item.unit_price) : '—'
                    )}
                  </td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>{item.gst_percent != null ? `${item.gst_percent}%` : '—'}</td>
                  <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>{lineTotal != null ? money(lineTotal) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div style={styles.totalsBlock}>
          <div style={styles.totalsRow}><span>Subtotal</span><span>{money(detail.subtotal)}</span></div>
          <div style={styles.totalsRow}><span>Total GST</span><span>{money(detail.total_gst)}</span></div>
          <div style={{ ...styles.totalsRow, fontWeight: 700 }}><span>Grand Total</span><span>{money(detail.grand_total)}</span></div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={styles.label}>Notes (payment terms, validity, etc.)</label>
          {isDraft ? (
            <textarea
              style={styles.textarea}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              rows={3}
            />
          ) : (
            <p style={styles.notesText}>{detail.notes || '—'}</p>
          )}
        </div>

        <div style={styles.actionsRow} className="no-print">
          {isDraft && (
            <>
              <button style={styles.primaryButton} onClick={handleSaveDraft} disabled={saving}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <input
                style={styles.approverInput}
                placeholder="Approver name"
                value={approverName}
                onChange={(e) => setApproverName(e.target.value)}
              />
              <button
                style={styles.successButton}
                onClick={handleApprove}
                disabled={approving || !approverName.trim() || detail.items_price_missing > 0}
                title={detail.items_price_missing > 0 ? 'Every item needs a price before approving' : ''}
              >
                {approving ? 'Approving…' : 'Approve'}
              </button>
            </>
          )}
          {isApproved && (
            <>
              <button style={styles.secondaryButton} onClick={handleRevert}>Revert to Draft</button>
              <button style={styles.successButton} onClick={handleMarkSent}>Mark as Sent</button>
            </>
          )}
          {isSent && <p style={styles.muted}>This quote is sent and locked.</p>}
        </div>
      </div>
    )
  }

  // ---- List view ----
  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Customer Quotes"
        description="Turn reviewed enquiries into priced, approved quotes ready to send."
      />

      {error && <div style={styles.errorBanner}>{error}</div>}
      {infoMessage && <div style={styles.infoBanner}>{infoMessage}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <h3 style={{ marginTop: 20 }}>Ready to Quote</h3>
          {ready.length === 0 ? (
            <p style={styles.muted}>No reviewed enquiries waiting to be quoted right now.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Site</th>
                  <th style={styles.th}>Items</th>
                  <th style={styles.th}>Price Missing</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {ready.map((e) => (
                  <tr key={e.id} style={styles.tr}>
                    <td style={styles.td}>{e.customer_name}</td>
                    <td style={styles.td}>{e.site_name}</td>
                    <td style={styles.td}>{e.item_count}</td>
                    <td style={styles.td}>{e.items_price_missing > 0 ? e.items_price_missing : '—'}</td>
                    <td style={styles.td}>
                      <button
                        style={styles.primaryButton}
                        onClick={() => handleGenerate(e.id)}
                        disabled={generatingId === e.id}
                      >
                        {generatingId === e.id ? 'Generating…' : 'Generate Quote'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 28 }}>Quotes</h3>
          {quotes.length === 0 ? (
            <p style={styles.muted}>No quotes generated yet.</p>
          ) : (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Quote #</th>
                  <th style={styles.th}>Customer</th>
                  <th style={styles.th}>Site</th>
                  <th style={styles.th}>Status</th>
                  <th style={styles.th}>Total</th>
                  <th style={styles.th}>Created</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id} style={styles.tr}>
                    <td style={styles.td}>{q.quote_number}</td>
                    <td style={styles.td}>{q.customer_name}</td>
                    <td style={styles.td}>{q.site_name}</td>
                    <td style={styles.td}><StatusBadge status={q.status} /></td>
                    <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>{money(q.grand_total)}</td>
                    <td style={styles.td}>{new Date(q.created_at).toLocaleString()}</td>
                    <td style={styles.td}>
                      <button style={styles.linkButton} onClick={() => openDetail(q.id)}>View</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

const styles = {
  title: { fontSize: 20, margin: '0 0 4px 0', color: 'var(--color-ink)' },
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  errorBanner: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-danger)' },
  infoBanner: { background: 'var(--color-accent-soft)', color: 'var(--color-accent)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-accent)' },
  warnBanner: { background: 'var(--color-warning-soft)', color: 'var(--color-warning)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-warning)' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 8 },
  th: { textAlign: 'left', borderBottom: '1px solid var(--color-line-strong)', padding: '10px 10px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, background: 'var(--color-paper)' },
  tr: { borderBottom: '1px solid var(--color-line)' },
  td: { padding: '10px 10px' },
  priceInput: { width: 110, padding: 5, fontSize: 12.5, fontFamily: 'var(--font-mono)' },
  approverInput: { padding: '8px 10px', fontSize: 13, width: 180 },
  primaryButton: { background: 'var(--color-rust)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500 },
  secondaryButton: { background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', marginRight: 8 },
  successButton: { background: 'var(--color-success)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500 },
  linkButton: { background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12.5, padding: 0, marginRight: 10, fontFamily: 'var(--font-sans)' },
  dangerLinkButton: { background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 12.5, padding: 0, marginLeft: 10, fontFamily: 'var(--font-sans)' },
  totalsBlock: { maxWidth: 300, marginLeft: 'auto', marginTop: 12, fontFamily: 'var(--font-mono)' },
  totalsRow: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 },
  label: { display: 'block', fontSize: 11, color: 'var(--color-muted)', marginBottom: 4, fontWeight: 500, letterSpacing: '0.04em', textTransform: 'uppercase' },
  textarea: { width: '100%', padding: 8, fontSize: 13, fontFamily: 'inherit' },
  notesText: { fontSize: 13, whiteSpace: 'pre-wrap' },
  actionsRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-line)' },
}
