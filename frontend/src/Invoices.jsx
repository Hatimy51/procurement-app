import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'
import SyncToERPButton from './SyncToERPButton'

const STATUS_LABEL = { draft: 'Draft', issued: 'Issued' }
const STATUS_STAMP = { draft: 'stamp-neutral', issued: 'stamp-success' }

function StatusBadge({ status }) {
  return (
    <span className={`stamp ${STATUS_STAMP[status] || 'stamp-neutral'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

export default function Invoices() {
  const [view, setView] = useState('list') // 'list' | 'create' | 'detail'
  const [invoices, setInvoices] = useState([])
  const [readyQuotes, setReadyQuotes] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  // ---- Create form state ----
  const [pickedQuoteId, setPickedQuoteId] = useState(null)
  const [quoteLines, setQuoteLines] = useState([])
  const [qtyDrafts, setQtyDrafts] = useState({})
  const [createNotes, setCreateNotes] = useState('')
  const [creating, setCreating] = useState(false)

  // ---- Detail state ----
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editQtyDrafts, setEditQtyDrafts] = useState({})
  const [editPriceDrafts, setEditPriceDrafts] = useState({})
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [refreshingERP, setRefreshingERP] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ready, all] = await Promise.all([api.listReadyQuotesForInvoice(), api.listInvoices()])
      setReadyQuotes(ready)
      setInvoices(all)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (view === 'list') loadList() }, [view, loadList])

  async function openCreate(quoteId) {
    setError(null)
    setPickedQuoteId(quoteId)
    setCreateNotes('')
    setView('create')
    try {
      const lines = await api.getQuoteInvoiceStatus(quoteId)
      setQuoteLines(lines)
      const drafts = {}
      lines.forEach((l) => { drafts[l.quote_line_item_id] = String(l.quantity_available_to_invoice) })
      setQtyDrafts(drafts)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleCreate() {
    setError(null)
    const items = quoteLines
      .map((l) => ({ quote_line_item_id: l.quote_line_item_id, quantity_invoiced: qtyDrafts[l.quote_line_item_id] }))
      .filter((i) => i.quantity_invoiced !== '' && Number(i.quantity_invoiced) > 0)

    if (items.length === 0) {
      setError('Enter a quantity greater than zero for at least one item.')
      return
    }
    setCreating(true)
    try {
      const inv = await api.createInvoice({ customer_quote_id: pickedQuoteId, notes: createNotes || null, items })
    } catch (e) {
      if (e.existing_id) {
        setError({ message: e.message, existing_id: e.existing_id, existing_number: e.existing_number })
      } else {
        setError(e.message)
      }
    } finally {
      setCreating(false)
    }
  }

  async function openDetail(id) {
    setSelectedId(id)
    setView('detail')
    setError(null)
    try {
      const data = await api.getInvoiceDetail(id)
      setDetail(data)
      setEditNotes(data.notes || '')
      setEditQtyDrafts({})
      setEditPriceDrafts({})
    } catch (e) {
      setError(e.message)
    }
  }

  async function refreshDetail() {
    const data = await api.getInvoiceDetail(selectedId)
    setDetail(data)
  }

  async function handleSaveDraft() {
    setSaving(true)
    setError(null)
    try {
      const items = detail.items.map((i) => ({
        quote_line_item_id: i.quote_line_item_id,
        quantity_invoiced: editQtyDrafts[i.id] !== undefined ? editQtyDrafts[i.id] : i.quantity_invoiced,
        unit_price: editPriceDrafts[i.id] !== undefined ? (editPriceDrafts[i.id] === '' ? null : editPriceDrafts[i.id]) : i.unit_price,
        gst_percent: i.gst_percent,
      }))
      await api.updateInvoiceDraft(selectedId, { notes: editNotes, items })
      setInfoMessage('Draft saved.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleIssue() {
    if (!window.confirm('Issue this invoice? It will be locked after this.')) return
    setError(null)
    try {
      await api.issueInvoice(selectedId)
      setInfoMessage('Invoice issued.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this draft invoice?')) return
    setError(null)
    try {
      await api.deleteInvoice(selectedId)
      setInfoMessage('Invoice deleted.')
      setView('list')
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleRefreshERP() {
    setRefreshingERP(true)
    setError(null)
    try {
      await api.refreshERPStatus({ record_type: 'invoice', record_id: selectedId })
      setInfoMessage('ERP status refreshed.')
      await openDetail(selectedId)
    } catch (e) {
      setError(e.message)
    } finally {
      setRefreshingERP(false)
    }
  }

  const money = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  // ---- Detail view ----
  if (view === 'detail' && detail) {
    const isDraft = detail.status === 'draft'
    return (
      <div>
        <div style={styles.detailHeader} className="no-print">
          <button className="btn-link" onClick={() => setView('list')}>← Back to list</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-secondary" onClick={() => window.print()}>Print / Export</button>
            <button className="btn btn-secondary" onClick={handleRefreshERP} disabled={refreshingERP}>
              {refreshingERP ? 'Refreshing…' : 'Refresh ERP Status'}
            </button>
            {!isDraft && (
              <SyncToERPButton recordData={detail} recordType="invoice" onSynced={() => openDetail(selectedId)} />
            )}
            {isDraft && <button className="btn-link btn-link-danger" style={{ marginLeft: 10 }} onClick={handleDelete}>Delete draft</button>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-mono)', color: 'var(--color-ink)' }}>{detail.invoice_number}</h2>
          <StatusBadge status={detail.status} />
          {detail.erp_payment_status && (
            <span className={`stamp ${detail.erp_payment_status === 'paid' ? 'stamp-success' : 'stamp-neutral'}`}>
              ERP: {detail.erp_payment_status.toUpperCase()}
            </span>
          )}
        </div>
        <p style={styles.muted}>Against quote {detail.quote_number} · {detail.customer_name} · {detail.site_name}</p>
        <p style={styles.muted}>
          Created {new Date(detail.created_at).toLocaleString()}
          {detail.created_by && <> by {detail.created_by}</>}
          {detail.updated_by && detail.updated_by !== detail.created_by && (
            <> · Last edited by {detail.updated_by}</>
          )}
          {detail.issued_at && <> · Issued {new Date(detail.issued_at).toLocaleString()}</>}
        </p>

        {error && <div className="banner banner-error no-print">{error}</div>}
        {infoMessage && <div className="banner banner-info no-print">{infoMessage}</div>}
        {isDraft && detail.items_price_missing > 0 && (
          <div className="banner banner-warning">
            {detail.items_price_missing} item(s) still have no price — fill those in before this can be issued.
          </div>
        )}

        <table className="ledger-table">
          <thead>
            <tr><th>Description</th><th>Spec</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>GST %</th><th>Line Total</th></tr>
          </thead>
          <tbody>
            {detail.items.map((item) => {
              const qty = isDraft && editQtyDrafts[item.id] !== undefined ? editQtyDrafts[item.id] : item.quantity_invoiced
              const price = isDraft && editPriceDrafts[item.id] !== undefined ? editPriceDrafts[item.id] : item.unit_price
              const lineTotal = price !== '' && price != null ? Number(price) * Number(qty) : null
              return (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.spec || '—'}</td>
                  <td className="num">
                    {isDraft ? (
                      <input type="number" step="0.01" style={{ width: 90 }} value={qty}
                        onChange={(e) => setEditQtyDrafts((d) => ({ ...d, [item.id]: e.target.value }))} />
                    ) : item.quantity_invoiced}
                  </td>
                  <td>{item.unit}</td>
                  <td className="num">
                    {isDraft ? (
                      <input type="number" step="0.01" placeholder="Price Missing" style={{ width: 110 }} value={price ?? ''}
                        onChange={(e) => setEditPriceDrafts((d) => ({ ...d, [item.id]: e.target.value }))} />
                    ) : (item.unit_price != null ? money(item.unit_price) : '—')}
                  </td>
                  <td className="num">{item.gst_percent != null ? `${item.gst_percent}%` : '—'}</td>
                  <td className="num">{lineTotal != null ? money(lineTotal) : '—'}</td>
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
          <label className="eyebrow">Notes</label>
          {isDraft ? (
            <textarea style={{ width: '100%' }} rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          ) : <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.notes || '—'}</p>}
        </div>

        <div style={styles.actionsRow} className="no-print">
          {isDraft ? (
            <>
              <button className="btn btn-primary" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
              <button
                className="btn btn-success" onClick={handleIssue}
                disabled={detail.items_price_missing > 0}
                title={detail.items_price_missing > 0 ? 'Every item needs a price before issuing' : ''}
              >
                Issue Invoice
              </button>
            </>
          ) : (
            <p style={styles.muted}>This invoice is issued and locked.</p>
          )}
        </div>
      </div>
    )
  }

  // ---- Create view ----
  if (view === 'create') {
    return (
      <div>
        <PageHeader
          eyebrow="Accounts"
          title="New Invoice"
          description="Standard GST-split invoice — quantity available is capped by what's actually been dispatched, not just quoted."
          action={<button className="btn-link" onClick={() => setView('list')}>← Cancel</button>}
        />

        {error && (
          <div className="banner banner-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>{typeof error === 'object' ? error.message : error}</span>
            {typeof error === 'object' && error.existing_id && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                style={{ padding: '4px 10px', fontSize: '12px' }}
                onClick={() => openDetail(error.existing_id)}
              >
                Jump to Draft #{error.existing_number || ''} →
              </button>
            )}
          </div>
        )}

        <table className="ledger-table" style={{ marginBottom: 16 }}>
          <thead>
            <tr><th>Description</th><th>Unit Price</th><th>GST %</th><th>Dispatched</th><th>Already Invoiced</th><th>Available</th><th>Invoice Now</th></tr>
          </thead>
          <tbody>
            {quoteLines.map((l) => (
              <tr key={l.quote_line_item_id}>
                <td>{l.description}</td>
                <td className="num">{l.unit_price != null ? money(l.unit_price) : '—'}</td>
                <td className="num">{l.gst_percent != null ? `${l.gst_percent}%` : '—'}</td>
                <td className="num">{l.quantity_dispatched}</td>
                <td className="num">{l.quantity_already_invoiced}</td>
                <td className="num">{l.quantity_available_to_invoice}</td>
                <td className="num">
                  <input type="number" step="0.01" style={{ width: 90 }}
                    value={qtyDrafts[l.quote_line_item_id] ?? ''}
                    onChange={(e) => setQtyDrafts((d) => ({ ...d, [l.quote_line_item_id]: e.target.value }))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <label className="eyebrow">Notes</label>
        <textarea style={{ width: '100%', marginBottom: 16 }} rows={2} value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} />

        <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create Draft Invoice'}
        </button>
      </div>
    )
  }

  // ---- List view ----
  return (
    <div>
      <PageHeader
        eyebrow="Accounts"
        title="Invoices"
        description="GST-aware billing against what's actually been delivered — supports partial invoicing across more than one invoice."
      />

      {error && (
        <div className="banner banner-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>{typeof error === 'object' ? error.message : error}</span>
          {typeof error === 'object' && error.existing_id && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              style={{ padding: '4px 10px', fontSize: '12px' }}
              onClick={() => openDetail(error.existing_id)}
            >
              Jump to Draft #{error.existing_number || ''} →
            </button>
          )}
        </div>
      )}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <>
          <h3 style={{ marginTop: 20 }}>Ready to Invoice</h3>
          {readyQuotes.length === 0 ? (
            <p style={styles.muted}>Nothing dispatched-but-unbilled right now.</p>
          ) : (
            <table className="ledger-table">
              <thead><tr><th>Quote #</th><th>Customer</th><th>Site</th><th>Lines Available</th><th></th></tr></thead>
              <tbody>
                {readyQuotes.map((q) => (
                  <tr key={q.id}>
                    <td className="num">{q.quote_number}</td>
                    <td>{q.customer_name}</td>
                    <td>{q.site_name}</td>
                    <td className="num">{q.lines_available}</td>
                    <td><button className="btn btn-primary" onClick={() => openCreate(q.id)}>Create Invoice</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 28 }}>Invoices</h3>

          {/* Search and Status Filters */}
          {invoices.length > 0 && (
            <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
                placeholder="Search by Invoice #, quote #, or customer…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="issued">Issued</option>
              </select>
            </div>
          )}

          {invoices.length === 0 ? (
            <p style={styles.muted}>No invoices created yet.</p>
          ) : (
            (() => {
              const qStr = search.trim().toLowerCase()
              const filtered = invoices.filter((inv) => {
                if (qStr) {
                  const matchInv = inv.invoice_number?.toLowerCase().includes(qStr)
                  const matchQ = inv.quote_number?.toLowerCase().includes(qStr)
                  const matchCust = inv.customer_name?.toLowerCase().includes(qStr)
                  if (!matchInv && !matchQ && !matchCust) return false
                }
                if (statusFilter !== 'all' && inv.status !== statusFilter) return false
                return true
              })

              if (filtered.length === 0) {
                return <p style={{ ...styles.muted, padding: '20px 0' }}>No invoices match your search and filter criteria.</p>
              }

              return (
                <table className="ledger-table">
                  <thead><tr><th>Invoice #</th><th>Quote</th><th>Customer</th><th>Status</th><th>Total</th><th>Created</th><th></th></tr></thead>
                  <tbody>
                    {filtered.map((inv) => (
                      <tr key={inv.id}>
                        <td className="num">{inv.invoice_number}</td>
                        <td className="num">{inv.quote_number}</td>
                        <td>{inv.customer_name}</td>
                        <td><StatusBadge status={inv.status} /></td>
                        <td className="num">{money(inv.grand_total)}</td>
                        <td>{new Date(inv.created_at).toLocaleString()}</td>
                        <td><button className="btn-link" onClick={() => openDetail(inv.id)}>View</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            })()
          )}
        </>
      )}
    </div>
  )
}

const styles = {
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  totalsBlock: { maxWidth: 300, marginLeft: 'auto', marginTop: 12, fontFamily: 'var(--font-mono)' },
  totalsRow: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 },
  actionsRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-line)' },
}
