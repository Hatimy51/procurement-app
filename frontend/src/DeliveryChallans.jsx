import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const STATUS_LABEL = { draft: 'Draft', dispatched: 'Dispatched' }
const STATUS_STAMP = { draft: 'stamp-neutral', dispatched: 'stamp-success' }

function StatusBadge({ status }) {
  return (
    <span className={`stamp ${STATUS_STAMP[status] || 'stamp-neutral'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

export default function DeliveryChallans() {
  const [view, setView] = useState('list') // 'list' | 'create' | 'detail'
  const [dcs, setDcs] = useState([])
  const [readyQuotes, setReadyQuotes] = useState([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  // ---- Create form state ----
  const [pickedQuoteId, setPickedQuoteId] = useState(null)
  const [quoteLines, setQuoteLines] = useState([]) // QuoteLineDeliveryStatus[]
  const [qtyDrafts, setQtyDrafts] = useState({}) // quote_line_item_id -> string
  const [vehicleNumber, setVehicleNumber] = useState('')
  const [driverName, setDriverName] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [creating, setCreating] = useState(false)

  // ---- Detail state ----
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [editQtyDrafts, setEditQtyDrafts] = useState({})
  const [editVehicle, setEditVehicle] = useState('')
  const [editDriver, setEditDriver] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ready, all] = await Promise.all([
        api.listReadyQuotesForDelivery(),
        api.listDeliveryChallans(),
      ])
      setReadyQuotes(ready)
      setDcs(all)
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
    setVehicleNumber('')
    setDriverName('')
    setCreateNotes('')
    setView('create')
    try {
      const lines = await api.getQuoteDeliveryStatus(quoteId)
      setQuoteLines(lines)
      const drafts = {}
      lines.forEach((l) => { drafts[l.quote_line_item_id] = String(l.quantity_remaining) })
      setQtyDrafts(drafts)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleCreate() {
    setError(null)
    const items = quoteLines
      .map((l) => ({ quote_line_item_id: l.quote_line_item_id, quantity_delivered: qtyDrafts[l.quote_line_item_id] }))
      .filter((i) => i.quantity_delivered !== '' && Number(i.quantity_delivered) > 0)

    if (items.length === 0) {
      setError('Enter a quantity greater than zero for at least one item.')
      return
    }
    setCreating(true)
    try {
      const dc = await api.createDeliveryChallan({
        customer_quote_id: pickedQuoteId,
        vehicle_number: vehicleNumber || null,
        driver_name: driverName || null,
        notes: createNotes || null,
        items,
      })
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
      const data = await api.getDeliveryChallanDetail(id)
      setDetail(data)
      setEditVehicle(data.vehicle_number || '')
      setEditDriver(data.driver_name || '')
      setEditNotes(data.notes || '')
      setEditQtyDrafts({})
    } catch (e) {
      setError(e.message)
    }
  }

  async function refreshDetail() {
    const data = await api.getDeliveryChallanDetail(selectedId)
    setDetail(data)
    return data
  }

  async function handleSaveDraft() {
    setSaving(true)
    setError(null)
    try {
      const items = detail.items.map((i) => ({
        quote_line_item_id: i.quote_line_item_id || null,
        po_line_item_id: i.po_line_item_id || null,
        quantity_delivered: editQtyDrafts[i.id] !== undefined ? editQtyDrafts[i.id] : i.quantity_delivered,
      }))
      await api.updateDeliveryChallanDraft(selectedId, {
        vehicle_number: editVehicle || null,
        driver_name: editDriver || null,
        notes: editNotes || null,
        items,
      })
      setInfoMessage('Draft saved.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkDispatched() {
    if (!window.confirm('Mark this delivery challan as dispatched? It will be locked after this.')) return
    setError(null)
    try {
      await api.markDeliveryChallanDispatched(selectedId)
      setInfoMessage('Marked as dispatched.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this draft delivery challan?')) return
    setError(null)
    try {
      await api.deleteDeliveryChallan(selectedId)
      setInfoMessage('Delivery challan deleted.')
      setView('list')
    } catch (e) {
      setError(e.message)
    }
  }

  // ---- Detail view ----
  if (view === 'detail' && detail) {
    const isDraft = detail.status === 'draft'
    return (
      <div>
        <div style={styles.detailHeader} className="no-print">
          <button className="btn-link" onClick={() => setView('list')}>← Back to list</button>
          <div>
            <button className="btn btn-secondary" onClick={() => window.print()}>Print / Export</button>
            {isDraft && <button className="btn-link btn-link-danger" style={{ marginLeft: 10 }} onClick={handleDelete}>Delete draft</button>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-mono)', color: 'var(--color-ink)' }}>{detail.dc_number}</h2>
          <StatusBadge status={detail.status} />
        </div>
        <p style={styles.muted}>
          Against quote {detail.quote_number}
          {' · '}{detail.customer_name} · {detail.site_name}
        </p>
        <p style={styles.muted}>
          Created {new Date(detail.created_at).toLocaleString()}
          {detail.created_by && <> by {detail.created_by}</>}
          {detail.updated_by && detail.updated_by !== detail.created_by && (
            <> · Last edited by {detail.updated_by}</>
          )}
          {detail.dispatched_at && <> · Dispatched {new Date(detail.dispatched_at).toLocaleString()}</>}
        </p>

        {error && <div className="banner banner-error no-print">{error}</div>}
        {infoMessage && <div className="banner banner-info no-print">{infoMessage}</div>}

        <table className="ledger-table">
          <thead>
            <tr><th>Description</th><th>Spec</th><th>Unit</th><th>Qty Delivered</th></tr>
          </thead>
          <tbody>
            {detail.items.map((item) => (
              <tr key={item.id}>
                <td>{item.description}</td>
                <td>{item.spec || '—'}</td>
                <td>{item.unit}</td>
                <td className="num">
                  {isDraft ? (
                    <input
                      type="number" step="0.01" style={{ width: 100 }}
                      value={editQtyDrafts[item.id] !== undefined ? editQtyDrafts[item.id] : item.quantity_delivered}
                      onChange={(e) => setEditQtyDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                    />
                  ) : item.quantity_delivered}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
          <div>
            <label className="eyebrow">Vehicle Number</label>
            {isDraft ? (
              <input style={{ width: '100%' }} value={editVehicle} onChange={(e) => setEditVehicle(e.target.value)} />
            ) : <p style={{ fontSize: 13 }}>{detail.vehicle_number || '—'}</p>}
          </div>
          <div>
            <label className="eyebrow">Driver Name</label>
            {isDraft ? (
              <input style={{ width: '100%' }} value={editDriver} onChange={(e) => setEditDriver(e.target.value)} />
            ) : <p style={{ fontSize: 13 }}>{detail.driver_name || '—'}</p>}
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label className="eyebrow">Notes</label>
          {isDraft ? (
            <textarea style={{ width: '100%' }} rows={2} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
          ) : <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.notes || '—'}</p>}
        </div>

        <div style={styles.actionsRow} className="no-print">
          {isDraft ? (
            <>
              <button className="btn btn-primary" onClick={handleSaveDraft} disabled={saving}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button className="btn btn-success" onClick={handleMarkDispatched}>Mark as Dispatched</button>
            </>
          ) : (
            <p style={styles.muted}>This delivery challan is dispatched and locked.</p>
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
          eyebrow="Fulfillment"
          title="New Delivery Challan"
          description="Quantities only — no pricing on a delivery challan."
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
            <tr><th>Description</th><th>Spec</th><th>Unit</th><th>Quoted</th><th>Already Delivered</th><th>Remaining</th><th>Deliver Now</th></tr>
          </thead>
          <tbody>
            {quoteLines.map((l) => (
              <tr key={l.quote_line_item_id}>
                <td>{l.description}</td>
                <td>{l.spec || '—'}</td>
                <td>{l.unit}</td>
                <td className="num">{l.quantity_quoted}</td>
                <td className="num">{l.quantity_already_delivered}</td>
                <td className="num">{l.quantity_remaining}</td>
                <td className="num">
                  <input
                    type="number" step="0.01" style={{ width: 100 }}
                    value={qtyDrafts[l.quote_line_item_id] ?? ''}
                    onChange={(e) => setQtyDrafts((d) => ({ ...d, [l.quote_line_item_id]: e.target.value }))}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
          <div>
            <label className="eyebrow">Vehicle Number</label>
            <input style={{ width: '100%' }} value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} placeholder="e.g. MH-01-AB-1234" />
          </div>
          <div>
            <label className="eyebrow">Driver Name</label>
            <input style={{ width: '100%' }} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
          </div>
        </div>
        <label className="eyebrow">Notes</label>
        <textarea style={{ width: '100%', marginBottom: 16 }} rows={2} value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} />

        <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create Draft Delivery Challan'}
        </button>
      </div>
    )
  }

  // ---- List view ----
  return (
    <div>
      <PageHeader
        eyebrow="Fulfillment"
        title="Delivery Challans"
        description="Goods-movement documents for approved or sent quotes — supports partial deliveries across more than one challan."
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
          <h3 style={{ marginTop: 20 }}>Ready to Deliver</h3>
          {readyQuotes.length === 0 ? (
            <p style={styles.muted}>No approved or sent quotes with undelivered items right now.</p>
          ) : (
            <table className="ledger-table">
              <thead><tr><th>Quote #</th><th>Customer</th><th>Site</th><th>Lines Remaining</th><th></th></tr></thead>
              <tbody>
                {readyQuotes.map((q) => (
                  <tr key={q.id}>
                    <td className="num">{q.quote_number}</td>
                    <td>{q.customer_name}</td>
                    <td>{q.site_name}</td>
                    <td className="num">{q.lines_remaining}</td>
                    <td><button className="btn btn-primary" onClick={() => openCreate(q.id)}>Create Challan</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ marginTop: 28 }}>Challans</h3>

          {/* Search and Status Filters */}
          {dcs.length > 0 && (
            <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                style={{ flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
                placeholder="Search by DC #, quote #, customer, or site…"
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
                <option value="dispatched">Dispatched</option>
              </select>
            </div>
          )}

          {dcs.length === 0 ? (
            <p style={styles.muted}>No delivery challans created yet.</p>
          ) : (
            (() => {
              const qStr = search.trim().toLowerCase()
              const filtered = dcs.filter((dc) => {
                if (qStr) {
                  const matchDC = dc.dc_number?.toLowerCase().includes(qStr)
                  const matchQ = dc.quote_number?.toLowerCase().includes(qStr)
                  const matchCust = dc.customer_name?.toLowerCase().includes(qStr)
                  if (!matchDC && !matchQ && !matchCust) return false
                }
                if (statusFilter !== 'all' && dc.status !== statusFilter) return false
                return true
              })

              if (filtered.length === 0) {
                return <p style={{ ...styles.muted, padding: '20px 0' }}>No delivery challans match your search and filter criteria.</p>
              }

              return (
                <table className="ledger-table">
                  <thead><tr><th>DC #</th><th>Quote #</th><th>Customer</th><th>Status</th><th>Items</th><th>Created</th><th></th></tr></thead>
                  <tbody>
                    {filtered.map((dc) => (
                      <tr key={dc.id}>
                        <td className="num">{dc.dc_number}</td>
                        <td className="num">{dc.quote_number}</td>
                        <td>{dc.customer_name}</td>
                        <td><StatusBadge status={dc.status} /></td>
                        <td className="num">{dc.item_count}</td>
                        <td>{new Date(dc.created_at).toLocaleString()}</td>
                        <td><button className="btn-link" onClick={() => openDetail(dc.id)}>View</button></td>
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
  actionsRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-line)' },
}
