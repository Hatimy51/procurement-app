import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'
import SyncToERPButton from './SyncToERPButton'

const STATUS_LABEL = { draft: 'Draft', sent: 'Sent' }
const STATUS_STAMP = { draft: 'stamp-neutral', sent: 'stamp-success' }

function StatusBadge({ status }) {
  return (
    <span className={`stamp ${STATUS_STAMP[status] || 'stamp-neutral'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function emptyManualLine() {
  return { key: crypto.randomUUID(), product_id: null, description: '', spec: '', quantity: '', unit: '', unit_price: '', gst_percent: '' }
}

export default function PurchaseOrders() {
  const [view, setView] = useState('list') // 'list' | 'create' | 'detail'
  const [pos, setPos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  // ---- Create form state ----
  const [suppliers, setSuppliers] = useState([])
  const [quotesForLink, setQuotesForLink] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [linkedQuoteId, setLinkedQuoteId] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [productResults, setProductResults] = useState([])
  const [lines, setLines] = useState([])
  const [creating, setCreating] = useState(false)

  // ---- Detail state ----
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [priceDrafts, setPriceDrafts] = useState({})
  const [saving, setSaving] = useState(false)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPos(await api.listPurchaseOrders())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (view === 'list') loadList() }, [view, loadList])

  // Debounced product search for the item picker
  useEffect(() => {
    if (view !== 'create') return
    const t = setTimeout(async () => {
      try {
        setProductResults(await api.listProducts(productSearch))
      } catch (e) {
        setError(e.message)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [productSearch, view])

  async function openCreate() {
    setError(null)
    setSupplierId('')
    setLinkedQuoteId('')
    setCreateNotes('')
    setProductSearch('')
    setLines([])
    setView('create')
    try {
      const [s, q] = await Promise.all([api.listSuppliers(), api.listCustomerQuotes()])
      setSuppliers(s)
      setQuotesForLink(q)
      setProductResults(await api.listProducts(''))
    } catch (e) {
      setError(e.message)
    }
  }

  function addProductLine(product) {
    const latest = product.price_entries?.[0] || null
    setLines((ls) => [
      ...ls,
      {
        key: crypto.randomUUID(),
        product_id: product.id,
        description: product.name,
        spec: product.spec || '',
        quantity: '1',
        unit: product.unit || '',
        unit_price: latest?.cost_price != null ? String(latest.cost_price) : '',
        gst_percent: product.gst_percent != null ? String(product.gst_percent) : '',
      },
    ])
  }

  function addManualLine() {
    setLines((ls) => [...ls, emptyManualLine()])
  }

  function updateLine(key, field, value) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
  }

  function removeLine(key) {
    setLines((ls) => ls.filter((l) => l.key !== key))
  }

  function toPayloadItems(lineArray) {
    return lineArray.map((l) => ({
      product_id: l.product_id || null,
      description: l.description,
      spec: l.spec || null,
      quantity: l.quantity === '' ? 0 : l.quantity,
      unit: l.unit,
      unit_price: l.unit_price === '' ? null : l.unit_price,
      gst_percent: l.gst_percent === '' ? null : l.gst_percent,
    }))
  }

  async function handleCreate() {
    setError(null)
    if (!supplierId) { setError('Choose a supplier first.'); return }
    if (lines.length === 0) { setError('Add at least one item.'); return }
    if (lines.some((l) => !l.description || !l.unit || !l.quantity)) {
      setError('Every line needs a description, unit, and quantity.')
      return
    }
    setCreating(true)
    try {
      const po = await api.createPurchaseOrder({
        supplier_id: supplierId,
        customer_quote_id: linkedQuoteId || null,
        notes: createNotes || null,
        items: toPayloadItems(lines),
      })
      setInfoMessage('Purchase order created.')
      await openDetail(po.id)
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  async function openDetail(id) {
    setSelectedId(id)
    setView('detail')
    setError(null)
    try {
      const data = await api.getPurchaseOrderDetail(id)
      setDetail(data)
      setNotesDraft(data.notes || '')
      const drafts = {}
      data.items.forEach((i) => { drafts[i.id] = i.unit_price ?? '' })
      setPriceDrafts(drafts)
    } catch (e) {
      setError(e.message)
    }
  }

  async function refreshDetail() {
    const data = await api.getPurchaseOrderDetail(selectedId)
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
        product_id: null,
        description: i.description,
        spec: i.spec,
        quantity: i.quantity,
        unit: i.unit,
        gst_percent: i.gst_percent,
        unit_price: priceDrafts[i.id] === '' ? null : priceDrafts[i.id],
      }))
      await api.updatePurchaseOrderDraft(selectedId, { notes: notesDraft, items })
      setInfoMessage('Draft saved.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleMarkSent() {
    if (!window.confirm('Mark this purchase order as sent to the supplier? It will be locked after this.')) return
    setError(null)
    try {
      await api.markPurchaseOrderSent(selectedId)
      setInfoMessage('Marked as sent.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleCreateGRN() {
    setError(null)
    try {
      const result = await api.createDeliveryChallanFromPurchaseOrder(selectedId)
      setInfoMessage(
        result.dc_number
          ? `${result.message || 'GRN / Delivery Challan created.'} ${result.dc_number}`
          : (result.message || 'GRN / Delivery Challan created.')
      )
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete() {
    if (!window.confirm('Delete this draft purchase order?')) return
    setError(null)
    try {
      await api.deletePurchaseOrder(selectedId)
      setInfoMessage('Purchase order deleted.')
      setView('list')
    } catch (e) {
      setError(e.message)
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
            {detail.status !== 'draft' && (
              <SyncToERPButton recordData={detail} recordType="po" />
            )}
            {isDraft && <button className="btn-link btn-link-danger" style={{ marginLeft: 10 }} onClick={handleDelete}>Delete draft</button>}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontFamily: 'var(--font-mono)', color: 'var(--color-ink)' }}>{detail.po_number}</h2>
          <StatusBadge status={detail.status} />
        </div>
        <p style={styles.muted}>
          To: {detail.supplier_name} {detail.supplier_email ? `· ${detail.supplier_email}` : ''} {detail.supplier_phone ? `· ${detail.supplier_phone}` : ''}
        </p>
        <p style={styles.muted}>
          Created {new Date(detail.created_at).toLocaleString()}
          {detail.customer_quote_number && <> · For quote {detail.customer_quote_number}</>}
          {detail.sent_at && <> · Sent {new Date(detail.sent_at).toLocaleString()}</>}
        </p>

        {error && <div className="banner banner-error no-print">{error}</div>}
        {infoMessage && <div className="banner banner-info no-print">{infoMessage}</div>}
        {isDraft && detail.items_price_missing > 0 && (
          <div className="banner banner-warning">
            {detail.items_price_missing} item(s) still have no price — fill those in before this can be sent.
          </div>
        )}

        <table className="ledger-table">
          <thead>
            <tr>
              <th>Description</th><th>Spec</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>GST %</th><th>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {detail.items.map((item) => {
              const price = isDraft ? priceDrafts[item.id] : item.unit_price
              const lineTotal = price !== '' && price != null ? Number(price) * Number(item.quantity) : null
              return (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.spec || '—'}</td>
                  <td className="num">{item.quantity}</td>
                  <td>{item.unit}</td>
                  <td className="num">
                    {isDraft ? (
                      <input
                        type="number" step="0.01" placeholder="Price Missing"
                        style={{ width: 110 }}
                        value={priceDrafts[item.id]}
                        onChange={(e) => setPriceDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                      />
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
          <label className="eyebrow">Notes (delivery instructions, terms, etc.)</label>
          {isDraft ? (
            <textarea style={{ width: '100%' }} rows={3} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
          ) : (
            <p style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{detail.notes || '—'}</p>
          )}
        </div>

        <div style={styles.actionsRow} className="no-print">
          {detail.status === 'sent' && (
            <button className="btn btn-secondary" onClick={handleCreateGRN}>
              Create GRN / Delivery Challan
            </button>
          )}
          {isDraft ? (
            <>
              <button className="btn btn-primary" onClick={handleSaveDraft} disabled={saving}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                className="btn btn-success"
                onClick={handleMarkSent}
                disabled={detail.items_price_missing > 0}
                title={detail.items_price_missing > 0 ? 'Every item needs a price before sending' : ''}
              >
                Mark as Sent
              </button>
            </>
          ) : (
            <p style={styles.muted}>This purchase order is sent and locked.</p>
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
          eyebrow="Procurement"
          title="New Purchase Order"
          description="Order directly from a supplier — no prior RFQ needed."
          action={<button className="btn-link" onClick={() => setView('list')}>← Cancel</button>}
        />

        {error && <div className="banner banner-error">{error}</div>}

        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="eyebrow">Supplier</label>
              <select style={{ width: '100%' }} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select a supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eyebrow">Link to a customer quote (optional)</label>
              <select style={{ width: '100%' }} value={linkedQuoteId} onChange={(e) => setLinkedQuoteId(e.target.value)}>
                <option value="">Not linked to a specific quote</option>
                {quotesForLink.map((q) => (
                  <option key={q.id} value={q.id}>{q.quote_number} — {q.customer_name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <h3 style={{ marginBottom: 8 }}>Add items</h3>
        <input
          style={{ width: '100%', marginBottom: 8 }}
          placeholder="Search products by name, category, or spec…"
          value={productSearch}
          onChange={(e) => setProductSearch(e.target.value)}
        />
        <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-line)', borderRadius: 3, marginBottom: 16 }}>
          <table className="ledger-table">
            <thead><tr><th>Name</th><th>Spec</th><th>Unit</th><th>Last Cost</th><th></th></tr></thead>
            <tbody>
              {productResults.map((p) => {
                const latest = p.price_entries?.[0] || null
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.spec || '—'}</td>
                    <td>{p.unit || '—'}</td>
                    <td className="num">{latest?.cost_price != null ? money(latest.cost_price) : '—'}</td>
                    <td><button className="btn-link" onClick={() => addProductLine(p)}>+ Add</button></td>
                  </tr>
                )
              })}
              {productResults.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--color-muted)' }}>No products match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <button className="btn btn-secondary" onClick={addManualLine} style={{ marginBottom: 16 }}>
          + Add a custom line (not in product master)
        </button>

        {lines.length > 0 && (
          <>
            <h3 style={{ marginBottom: 8 }}>Order lines</h3>
            <table className="ledger-table" style={{ marginBottom: 16 }}>
              <thead>
                <tr><th>Description</th><th>Spec</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>GST %</th><th></th></tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.key}>
                    <td>
                      {l.product_id ? l.description : (
                        <input style={{ width: 160 }} value={l.description} onChange={(e) => updateLine(l.key, 'description', e.target.value)} placeholder="Description" />
                      )}
                    </td>
                    <td>
                      {l.product_id ? (l.spec || '—') : (
                        <input style={{ width: 100 }} value={l.spec} onChange={(e) => updateLine(l.key, 'spec', e.target.value)} placeholder="Spec" />
                      )}
                    </td>
                    <td><input type="number" style={{ width: 70 }} value={l.quantity} onChange={(e) => updateLine(l.key, 'quantity', e.target.value)} /></td>
                    <td>
                      {l.product_id ? l.unit : (
                        <input style={{ width: 70 }} value={l.unit} onChange={(e) => updateLine(l.key, 'unit', e.target.value)} placeholder="Unit" />
                      )}
                    </td>
                    <td><input type="number" step="0.01" style={{ width: 100 }} placeholder="Price Missing" value={l.unit_price} onChange={(e) => updateLine(l.key, 'unit_price', e.target.value)} /></td>
                    <td><input type="number" step="0.01" style={{ width: 70 }} value={l.gst_percent} onChange={(e) => updateLine(l.key, 'gst_percent', e.target.value)} /></td>
                    <td><button className="btn-link btn-link-danger" onClick={() => removeLine(l.key)}>Remove</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <label className="eyebrow">Notes (delivery instructions, terms, etc.)</label>
        <textarea style={{ width: '100%', marginBottom: 16 }} rows={3} value={createNotes} onChange={(e) => setCreateNotes(e.target.value)} />

        <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
          {creating ? 'Creating…' : 'Create Draft Purchase Order'}
        </button>
      </div>
    )
  }

  // ---- List view ----
  return (
    <div>
      <PageHeader
        eyebrow="Procurement"
        title="Purchase Orders"
        description="Orders placed with your suppliers — created straight from a supplier, with or without a prior RFQ."
        action={<button className="btn btn-primary" onClick={openCreate}>+ New Purchase Order</button>}
      />

      {error && <div className="banner banner-error">{error}</div>}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {loading ? (
        <p>Loading…</p>
      ) : pos.length === 0 ? (
        <p style={styles.muted}>No purchase orders yet.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr><th>PO #</th><th>Supplier</th><th>Status</th><th>Total</th><th>Created</th><th></th></tr>
          </thead>
          <tbody>
            {pos.map((po) => (
              <tr key={po.id}>
                <td className="num">{po.po_number}</td>
                <td>{po.supplier_name}</td>
                <td><StatusBadge status={po.status} /></td>
                <td className="num">{money(po.grand_total)}</td>
                <td>{new Date(po.created_at).toLocaleString()}</td>
                <td><button className="btn-link" onClick={() => openDetail(po.id)}>View</button></td>
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
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  totalsBlock: { maxWidth: 300, marginLeft: 'auto', marginTop: 12, fontFamily: 'var(--font-mono)' },
  totalsRow: { display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13 },
  actionsRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--color-line)' },
}
