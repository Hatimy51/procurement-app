import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'
import SyncToERPButton from './SyncToERPButton'
import { useAuth } from './AuthContext'
import DocumentTemplate from './DocumentTemplate'

const STATUS_LABEL = { draft: 'Draft', sent: 'Sent' }
const STATUS_STAMP = { draft: 'stamp-neutral', sent: 'stamp-success' }

function StatusBadge({ status }) {
  return (
    <span className={`stamp ${STATUS_STAMP[status] || 'stamp-neutral'}`}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

function LifecycleProgressBar({ po }) {
  const isSent = po.status === 'sent'
  const receiptPct = po.receipt_pct || 0
  const isReceived = receiptPct >= 100
  const isPartial = receiptPct > 0 && receiptPct < 100
  const paymentStatus = po.erp_payment_status || 'pending'
  const isPaid = paymentStatus === 'paid'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, margin: '8px 0', fontSize: 11, fontWeight: 600 }}>
      <span style={{ padding: '3px 8px', borderRadius: 4, background: isSent ? '#dbeafe' : '#f3f4f6', color: isSent ? '#1e40af' : '#9ca3af' }}>
        {isSent ? '✓ PO Sent' : 'Draft'}
      </span>
      <span>→</span>
      <span style={{ padding: '3px 8px', borderRadius: 4, background: isReceived ? '#dcfce7' : isPartial ? '#fef9c3' : '#f3f4f6', color: isReceived ? '#15803d' : isPartial ? '#854d0e' : '#9ca3af' }}>
        {isReceived ? '✓ Goods Received (100%)' : isPartial ? `Receiving (${receiptPct}%)` : 'Goods Pending'}
      </span>
      <span>→</span>
      <span style={{ padding: '3px 8px', borderRadius: 4, background: isPaid ? '#dcfce7' : '#f3f4f6', color: isPaid ? '#15803d' : '#9ca3af' }}>
        {isPaid ? '✓ Paid' : `Payment: ${paymentStatus}`}
      </span>
    </div>
  )
}

function emptyManualLine() {
  return { key: crypto.randomUUID(), product_id: null, description: '', spec: '', quantity: '', unit: '', unit_price: '', gst_percent: '' }
}

export default function PurchaseOrders() {
  const { user } = useAuth()
  const [view, setView] = useState('list') // 'list' | 'create' | 'detail'
  const [pos, setPos] = useState([])
  const [listSearch, setListSearch] = useState('')
  const [listStatusFilter, setListStatusFilter] = useState('all')
  const [listStoreFilter, setListStoreFilter] = useState('all')
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
  const [storeLocations, setStoreLocations] = useState([])
  const [storeSearch, setStoreSearch] = useState('')
  const [selectedStoreId, setSelectedStoreId] = useState('')
  const [storeDropdownOpen, setStoreDropdownOpen] = useState(false)

  // ---- Detail state ----
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [poDocs, setPoDocs] = useState([])
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
    setStoreSearch('')
    setSelectedStoreId('')
    setLines([])
    setView('create')
    try {
      const [s, q, sl] = await Promise.all([
        api.listSuppliers(),
        api.listCustomerQuotes(),
        api.listStoreLocations(),
      ])
      setSuppliers(s)
      setQuotesForLink(q)
      setStoreLocations(sl)
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

  function toPayloadItems(ls) {
    return ls.map((l) => ({
      product_id: l.product_id,
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
        store_location_id: selectedStoreId || null,
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
      const [data, docs] = await Promise.all([
        api.getPurchaseOrderDetail(id),
        api.getPODocuments(id).catch(() => []),
      ])
      setDetail(data)
      setPoDocs(docs)
      setNotesDraft(data.notes || '')
      const drafts = {}
      data.items.forEach((i) => { drafts[i.id] = i.unit_price ?? '' })
      setPriceDrafts(drafts)
    } catch (e) {
      setError(e.message)
    }
  }

  async function refreshDetail() {
    const [data, docs] = await Promise.all([
      api.getPurchaseOrderDetail(selectedId),
      api.getPODocuments(selectedId).catch(() => []),
    ])
    setDetail(data)
    setPoDocs(docs)
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

  async function handleApprove() {
    if (!window.confirm('Approve this high-value Purchase Order?')) return
    setError(null)
    try {
      await api.approvePurchaseOrder(selectedId)
      setInfoMessage('Purchase Order approved.')
      await refreshDetail()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleReject() {
    if (!window.confirm('Reject this Purchase Order?')) return
    setError(null)
    try {
      await api.rejectPurchaseOrder(selectedId)
      setInfoMessage('Purchase Order rejected.')
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
        result.grn_number
          ? `GRN created: ${result.grn_number}`
          : (result.message || 'GRN created.')
      )
    } catch (e) {
      if (e.existing_id) {
        setError({ message: e.message, existing_id: e.existing_id, existing_number: e.existing_number, document_type: e.document_type })
      } else {
        setError(e.message)
      }
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
    const processedItems = detail.items.map((item) => {
      const price = isDraft ? priceDrafts[item.id] : item.unit_price
      return {
        ...item,
        unit_price: price !== '' && price != null ? price : null,
      }
    })

    const actionsHeader = (
      <>
        <button className="btn btn-secondary" onClick={() => setView('list')}>← Back to list</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary" onClick={() => window.print()}>Print / Export</button>
          {detail.status !== 'draft' && (
            <SyncToERPButton recordData={detail} recordType="po" />
          )}
          {isDraft && <button className="btn-link btn-link-danger" style={{ marginLeft: 10 }} onClick={handleDelete}>Delete draft</button>}
        </div>
      </>
    )

    const extraMeta = []
    if (detail.store_location_name) {
      extraMeta.push({ label: 'Delivery Site', value: `📍 ${detail.store_location_name}` })
    }
    if (detail.customer_quote_number) {
      extraMeta.push({ label: 'For Quote', value: detail.customer_quote_number })
    }

    return (
      <div>
        {/* 360° Lifecycle Progress Bar */}
        <div className="no-print" style={{ marginBottom: 12 }}>
          <LifecycleProgressBar po={detail} />
        </div>

        {/* Vendor Uploaded Documents Section */}
        {poDocs && poDocs.length > 0 && (
          <div className="no-print" style={{ background: '#f8faff', border: '1px solid #c7d2fe', borderRadius: 6, padding: '10px 14px', margin: '10px 0' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#3730a3', textTransform: 'uppercase' }}>Vendor Uploaded Documents ({poDocs.length})</span>
            <div style={{ display: 'flex', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
              {poDocs.map((d) => (
                <a
                  key={d.id}
                  href={d.download_url}
                  download
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', background: '#fff', border: '1px solid #c7d2fe', borderRadius: 4, fontSize: 12, textDecoration: 'none', color: '#1e40af', fontWeight: 600 }}
                >
                  📄 {d.document_type === 'delivery_challan' ? 'Challan: ' : d.document_type === 'invoice' ? 'Invoice: ' : ''}{d.file_name}
                </a>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="banner banner-error no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>{typeof error === 'object' ? error.message : error}</span>
            {typeof error === 'object' && error.existing_id && (
              <a
                href={`/grns/${error.existing_id}`}
                className="btn btn-sm btn-primary"
                style={{ padding: '4px 10px', fontSize: '12px', textDecoration: 'none' }}
              >
                Jump to Draft #{error.existing_number || ''} →
              </a>
            )}
          </div>
        )}
        {infoMessage && <div className="banner banner-info no-print">{infoMessage}</div>}
        {isDraft && detail.items_price_missing > 0 && (
          <div className="banner banner-warning no-print">
            {detail.items_price_missing} item(s) still have no price — fill those in before this can be sent.
          </div>
        )}

        <DocumentTemplate
          documentType="PURCHASE ORDER"
          documentNumber={detail.po_number}
          status={detail.status}
          statusBadge={<StatusBadge status={detail.status} />}
          dateLabel="PO Date"
          dateValue={detail.created_at}
          dueDateLabel="Sent Date"
          dueDateValue={detail.sent_at}
          extraMeta={extraMeta}
          partyTitle="Vendor / Supplier"
          partyName={detail.supplier_name}
          partyEmail={detail.supplier_email}
          partyPhone={detail.supplier_phone}
          shipToTitle="Delivery Location / Site"
          shipToName={detail.store_location_name || 'Central Warehouse'}
          createdBy={detail.created_by}
          updatedBy={detail.updated_by}
          items={processedItems}
          subtotal={detail.subtotal}
          totalGst={detail.total_gst}
          grandTotal={detail.grand_total}
          showBankDetails={false}
          notes={isDraft ? (
            <div>
              <label className="eyebrow">Notes (delivery instructions, terms, etc.)</label>
              <textarea style={{ width: '100%' }} rows={3} value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
            </div>
          ) : detail.notes}
          actions={actionsHeader}
        >
          {isDraft && (
            <div style={{ margin: '16px 0' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-rust)', marginBottom: 8 }} className="no-print">
                ✏️ Draft Mode: Fill in unit prices below and click &quot;Save Draft&quot;.
              </div>
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Description</th><th>Spec</th><th>Qty</th><th>Unit</th><th>Unit Price (₹)</th><th>GST %</th><th>Line Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item) => {
                    const price = priceDrafts[item.id]
                    const lineTotal = price !== '' && price != null ? Number(price) * Number(item.quantity) : null
                    return (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{item.spec || '—'}</td>
                        <td className="num">{item.quantity}</td>
                        <td>{item.unit}</td>
                        <td className="num">
                          <input
                            type="number" step="0.01" placeholder="Price Missing"
                            style={{ width: 110 }}
                            value={priceDrafts[item.id]}
                            onChange={(e) => setPriceDrafts((d) => ({ ...d, [item.id]: e.target.value }))}
                          />
                        </td>
                        <td className="num">{item.gst_percent != null ? `${item.gst_percent}%` : '—'}</td>
                        <td className="num">{lineTotal != null ? money(lineTotal) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </DocumentTemplate>

        <div style={styles.actionsRow} className="no-print">
          {detail.status === 'sent' && (
            <button className="btn btn-secondary" onClick={handleCreateGRN}>
              Create GRN / Delivery Challan
            </button>
          )}
          {detail.requires_manager_approval && detail.approval_status === 'pending_approval' && user?.role === 'manager' && (
            <div style={{ display: 'inline-flex', gap: 8 }}>
              <button className="btn btn-success" onClick={handleApprove}>
                ✓ Approve Spend (&gt;₹1L)
              </button>
              <button className="btn btn-danger" style={{ background: '#ef4444', color: '#fff', border: 'none' }} onClick={handleReject}>
                ✕ Reject Spend
              </button>
            </div>
          )}
          {isDraft ? (
            <>
              <button className="btn btn-primary" onClick={handleSaveDraft} disabled={saving}>
                {saving ? 'Saving…' : 'Save Draft'}
              </button>
              <button
                className="btn btn-success"
                onClick={handleMarkSent}
                disabled={detail.items_price_missing > 0 || (detail.requires_manager_approval && detail.approval_status !== 'approved')}
                title={
                  detail.items_price_missing > 0
                    ? 'Every item needs a price before sending'
                    : detail.requires_manager_approval && detail.approval_status !== 'approved'
                    ? 'Requires Manager spend approval before sending'
                    : ''
                }
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label className="eyebrow">Supplier</label>
              <select style={{ width: '100%' }} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Select a supplier…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="eyebrow">Link to customer quote</label>
              <select style={{ width: '100%' }} value={linkedQuoteId} onChange={(e) => setLinkedQuoteId(e.target.value)}>
                <option value="">Not linked to a quote</option>
                {quotesForLink.map((q) => (
                  <option key={q.id} value={q.id}>{q.quote_number} — {q.customer_name}</option>
                ))}
              </select>
            </div>
            <div style={{ position: 'relative' }}>
              <label className="eyebrow">Delivery Store / Site</label>
              <input
                style={{ width: '100%' }}
                placeholder="Type store name…"
                value={storeSearch}
                onChange={(e) => {
                  setStoreSearch(e.target.value)
                  setSelectedStoreId('')
                  setStoreDropdownOpen(true)
                }}
                onFocus={() => setStoreDropdownOpen(true)}
              />
              {storeDropdownOpen && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: '#fff', border: '1px solid var(--color-line)', borderRadius: 4,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)', maxHeight: 200, overflowY: 'auto',
                }}>
                  {storeSearch.trim() && !storeLocations.some((sl) => sl.name.toLowerCase() === storeSearch.trim().toLowerCase()) && (
                    <div
                      style={{ padding: '8px 12px', background: '#eff6ff', color: '#1d4ed8', fontWeight: 600, cursor: 'pointer', borderBottom: '1px solid #dbeafe', fontSize: 13 }}
                      onClick={async () => {
                        try {
                          const newLoc = await api.createStoreLocation({ name: storeSearch.trim() })
                          setStoreLocations((prev) => [newLoc, ...prev])
                          setSelectedStoreId(newLoc.id)
                          setStoreSearch(newLoc.name)
                          setStoreDropdownOpen(false)
                        } catch (err) {
                          setError(err.message)
                        }
                      }}
                    >
                      + Create: &ldquo;{storeSearch.trim()}&rdquo;
                    </div>
                  )}
                  {storeLocations
                    .filter((sl) => !storeSearch.trim() || sl.name.toLowerCase().includes(storeSearch.trim().toLowerCase()))
                    .map((sl) => (
                      <div
                        key={sl.id}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid #f3f4f6' }}
                        onClick={() => {
                          setSelectedStoreId(sl.id)
                          setStoreSearch(sl.name)
                          setStoreDropdownOpen(false)
                        }}
                      >
                        📍 {sl.name} {sl.area ? `(${sl.area})` : ''}
                      </div>
                    ))}
                  {storeLocations.filter((sl) => !storeSearch.trim() || sl.name.toLowerCase().includes(storeSearch.trim().toLowerCase())).length === 0 && !storeSearch.trim() && (
                    <div style={{ padding: '8px 12px', color: '#9ca3af', fontSize: 13 }}>No stores created yet. Type name to create.</div>
                  )}
                </div>
              )}
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

      {error && (
        <div className="banner banner-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <span>{typeof error === 'object' ? error.message : error}</span>
          {typeof error === 'object' && error.existing_id && (
            <a
              href={`/grns/${error.existing_id}`}
              className="btn btn-sm btn-primary"
              style={{ padding: '4px 10px', fontSize: '12px', textDecoration: 'none' }}
            >
              Jump to Draft #{error.existing_number || ''} →
            </a>
          )}
        </div>
      )}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {/* Filter and Search Bar */}
      <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
          placeholder="Search by PO #, supplier, or notes…"
          value={listSearch}
          onChange={(e) => setListSearch(e.target.value)}
        />
        <select
          style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
          value={listStatusFilter}
          onChange={(e) => setListStatusFilter(e.target.value)}
        >
          <option value="all">All Statuses</option>
          <option value="draft">Drafts Only</option>
          <option value="sent">Sent to Supplier</option>
          <option value="pending_approval">Pending Manager Approval</option>
        </select>
        <select
          style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
          value={listStoreFilter}
          onChange={(e) => setListStoreFilter(e.target.value)}
        >
          <option value="all">All Stores / Sites</option>
          {[...new Set(pos.map((p) => p.store_location_name).filter(Boolean))].map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : pos.length === 0 ? (
        <p style={styles.muted}>No purchase orders yet.</p>
      ) : (
        (() => {
          const q = listSearch.trim().toLowerCase()
          const filtered = pos.filter((po) => {
            if (q) {
              const matchPO = po.po_number?.toLowerCase().includes(q)
              const matchSup = po.supplier_name?.toLowerCase().includes(q)
              const matchStore = po.store_location_name?.toLowerCase().includes(q)
              if (!matchPO && !matchSup && !matchStore) return false
            }
            if (listStatusFilter === 'draft' && po.status !== 'draft') return false
            if (listStatusFilter === 'sent' && po.status !== 'sent') return false
            if (listStatusFilter === 'pending_approval' && (!po.requires_manager_approval || po.approval_status !== 'pending_approval')) return false
            if (listStoreFilter !== 'all' && po.store_location_name !== listStoreFilter) return false
            return true
          })

          if (filtered.length === 0) {
            return <p style={{ ...styles.muted, padding: '20px 0' }}>No purchase orders match your search and filter criteria.</p>
          }

          return (
            <table className="ledger-table">
              <thead>
                <tr><th>PO #</th><th>Supplier</th><th>Store / Site</th><th>Status</th><th>Lifecycle</th><th>Total</th><th>Created</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((po) => (
                  <tr key={po.id}>
                    <td className="num">{po.po_number}</td>
                    <td>{po.supplier_name}</td>
                    <td>
                      {po.store_location_name ? (
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#ede9fe', color: '#7c3aed', fontWeight: 600 }}>
                          📍 {po.store_location_name}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      <StatusBadge status={po.status} />
                      {po.requires_manager_approval && (
                        <div style={{ marginTop: 2 }}>
                          <span style={{
                            fontSize: 10, padding: '2px 5px', borderRadius: 4, fontWeight: 700,
                            background: po.approval_status === 'approved' ? '#dcfce7' : po.approval_status === 'rejected' ? '#fee2e2' : '#fef3c7',
                            color: po.approval_status === 'approved' ? '#15803d' : po.approval_status === 'rejected' ? '#b91c1c' : '#b45309',
                          }}>
                            {po.approval_status === 'approved' ? '✓ Approved' : po.approval_status === 'rejected' ? '✕ Rejected' : '⏳ >₹1L Approval'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontSize: 11 }}>
                        {po.status === 'sent' ? (
                          po.receipt_pct >= 100 ? (
                            <span style={{ color: '#15803d', fontWeight: 600 }}>✓ Recv 100%</span>
                          ) : po.receipt_pct > 0 ? (
                            <span style={{ color: '#b45309', fontWeight: 600 }}>Recv {po.receipt_pct}%</span>
                          ) : (
                            <span style={{ color: '#6b7280' }}>Pending Delivery</span>
                          )
                        ) : (
                          <span style={{ color: '#9ca3af' }}>Draft</span>
                        )}
                      </div>
                    </td>
                    <td className="num">{money(po.grand_total)}</td>
                    <td>{new Date(po.created_at).toLocaleString()}</td>
                    <td><button className="btn-link" onClick={() => openDetail(po.id)}>View</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })()
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
