import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [editingSupplierId, setEditingSupplierId] = useState(null)
  const [activeLedgerSupplier, setActiveLedgerSupplier] = useState(null)
  const [ledgerData, setLedgerData] = useState(null)
  const [loadingLedger, setLoadingLedger] = useState(false)
  const [supplierForm, setSupplierForm] = useState({
    name: '', email: '', phone: '', gst_number: '', linked_product_ids: [], linked_categories: [],
  })

  const categories = useMemo(
    () => [...new Set(products.map((p) => p.category).filter(Boolean))].sort(),
    [products]
  )

  const loadAll = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([api.listSuppliers(), api.listProducts()])
      setSuppliers(s)
      setProducts(p)
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function openSupplierLedger(s) {
    setActiveLedgerSupplier(s)
    setLoadingLedger(true)
    setLedgerData(null)
    try {
      const data = await api.getSupplierLedger(s.id)
      setLedgerData(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingLedger(false)
    }
  }

  async function submitSupplierForm(e) {
    e.preventDefault()
    setError(null)
    try {
      if (editingSupplierId) {
        await api.updateSupplier(editingSupplierId, supplierForm)
      } else {
        await api.createSupplier(supplierForm)
      }
      setSupplierForm({ name: '', email: '', phone: '', gst_number: '', linked_product_ids: [], linked_categories: [] })
      setEditingSupplierId(null)
      setSupplierFormOpen(false)
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  function openEditSupplierForm(supplier) {
    setEditingSupplierId(supplier.id)
    setSupplierForm({
      name: supplier.name,
      email: supplier.email || '',
      phone: supplier.phone || '',
      gst_number: supplier.gst_number || '',
      linked_product_ids: supplier.linked_product_ids || [],
      linked_categories: supplier.linked_categories || [],
    })
    setSupplierFormOpen(true)
  }

  function openNewSupplierForm() {
    setEditingSupplierId(null)
    setSupplierForm({ name: '', email: '', phone: '', gst_number: '', linked_product_ids: [], linked_categories: [] })
    setSupplierFormOpen(!supplierFormOpen)
  }

  async function handleDeleteSupplier(supplier) {
    if (
      !window.confirm(
        `Delete "${supplier.name}"? Any pending or resolved RFQs sent to them will be removed too. Products and their price history are unaffected.`
      )
    )
      return
    setError(null)
    try {
      const result = await api.deleteSupplier(supplier.id)
      setInfoMessage(
        `Supplier deleted.` + (result.rfqs_removed > 0 ? ` ${result.rfqs_removed} associated RFQ(s) also removed.` : '')
      )
      loadAll()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Sourcing"
        title="Suppliers"
        description="Your supplier directory — who you buy from, their contact details, and which products or categories they're your go-to for."
        action={
          <button className="btn btn-primary" onClick={openNewSupplierForm}>
            + Add Supplier
          </button>
        }
      />

      {error && <div className="banner banner-error">{error}</div>}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {supplierFormOpen && (
        <form style={styles.formCard} onSubmit={submitSupplierForm}>
          <h4 style={{ marginTop: 0 }}>{editingSupplierId ? 'Edit Supplier' : 'New Supplier'}</h4>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label className="eyebrow">Name</label>
              <input
                style={{ width: '100%' }}
                placeholder="Supplier name"
                required
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Email</label>
              <input
                style={{ width: '100%' }}
                type="email"
                placeholder="e.g. sales@supplier.com"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Phone No.</label>
              <input
                style={{ width: '100%' }}
                type="tel"
                placeholder="e.g. 98765 43210"
                value={supplierForm.phone}
                onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">GST Number (for Vendor Portal)</label>
              <input
                style={{ width: '100%' }}
                placeholder="e.g. 27ABCDE1234F1Z5"
                value={supplierForm.gst_number}
                onChange={(e) => setSupplierForm({ ...supplierForm, gst_number: e.target.value })}
              />
            </div>
          </div>

          <div style={styles.field}>
            <label className="eyebrow">Linked Categories</label>
            <p style={styles.muted}>This supplier is your go-to for everything in these categories.</p>
            {categories.length === 0 ? (
              <p style={styles.muted}>No categories yet — add products with a category first.</p>
            ) : (
              <div style={styles.checkboxGrid}>
                {categories.map((cat) => (
                  <label key={cat} style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={supplierForm.linked_categories.includes(cat)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...supplierForm.linked_categories, cat]
                          : supplierForm.linked_categories.filter((c) => c !== cat)
                        setSupplierForm({ ...supplierForm, linked_categories: next })
                      }}
                    />{' '}
                    {cat}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={styles.field}>
            <label className="eyebrow">Linked Products</label>
            <p style={styles.muted}>Specific products this supplier handles (in addition to any category above).</p>
            {products.length === 0 ? (
              <p style={styles.muted}>No products yet.</p>
            ) : (
              <div style={styles.checkboxGridScroll}>
                {products.map((p) => (
                  <label key={p.id} style={styles.checkboxLabel}>
                    <input
                      type="checkbox"
                      checked={supplierForm.linked_product_ids.includes(p.id)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...supplierForm.linked_product_ids, p.id]
                          : supplierForm.linked_product_ids.filter((id) => id !== p.id)
                        setSupplierForm({ ...supplierForm, linked_product_ids: next })
                      }}
                    />{' '}
                    {p.name}{p.category ? ` (${p.category})` : ''}
                  </label>
                ))}
              </div>
            )}
          </div>

          <div style={styles.formActions}>
            <button type="submit" className="btn btn-primary">Save Supplier</button>
            <button type="button" className="btn btn-secondary" onClick={() => setSupplierFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Search and Category Filter */}
      {suppliers.length > 0 && (
        <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            placeholder="Search suppliers by name, email, phone, or GST…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All Categories</option>
            {categories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>
      )}

      {suppliers.length === 0 ? (
        <p style={styles.muted}>No suppliers yet — add one to start creating RFQs.</p>
      ) : (
        (() => {
          const q = search.trim().toLowerCase()
          const filtered = suppliers.filter((s) => {
            if (q) {
              const matchName = s.name?.toLowerCase().includes(q)
              const matchEmail = s.email?.toLowerCase().includes(q)
              const matchPhone = s.phone?.toLowerCase().includes(q)
              const matchGST = s.gst_number?.toLowerCase().includes(q)
              if (!matchName && !matchEmail && !matchPhone && !matchGST) return false
            }
            if (categoryFilter !== 'all' && !(s.linked_categories || []).includes(categoryFilter)) {
              return false
            }
            return true
          })

          if (filtered.length === 0) {
            return <p style={{ ...styles.muted, padding: '20px 0' }}>No suppliers match your search or category filter.</p>
          }

          return (
            <table className="ledger-table">
              <thead>
                <tr><th>Name</th><th>Contact &amp; GST</th><th>Linked to</th><th>Added By</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const linkCount = (s.linked_product_ids?.length || 0) + (s.linked_categories?.length || 0)
                  return (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.name}</strong>
                        {s.gst_number && <div style={{ fontSize: 11, color: '#6b7280' }}>GST: {s.gst_number}</div>}
                      </td>
                      <td className="num">
                        {s.email && <div>{s.email}</div>}
                        {s.phone && <div>{s.phone}</div>}
                      </td>
                      <td style={styles.muted}>
                        {linkCount > 0
                          ? `${s.linked_categories?.length || 0} categor${s.linked_categories?.length === 1 ? 'y' : 'ies'}, ${s.linked_product_ids?.length || 0} product(s)`
                          : '—'}
                      </td>
                      <td style={styles.muted}>{s.created_by || '—'}</td>
                      <td>
                        <button className="btn-link" style={{ fontWeight: 600, color: '#4f46e5' }} onClick={() => openSupplierLedger(s)}>Orders &amp; Ledger</button>
                        <button className="btn-link" style={{ marginLeft: 8 }} onClick={() => openEditSupplierForm(s)}>Edit</button>
                        <button className="btn-link btn-link-danger" style={{ marginLeft: 8 }} onClick={() => handleDeleteSupplier(s)}>Delete</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        })()
      )}

      {/* Active Orders & Payment Ledger Modal */}
      {activeLedgerSupplier && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 24, width: '90%', maxWidth: 840, maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18 }}>Active Orders &amp; Payment Ledger</h3>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Supplier: <strong>{activeLedgerSupplier.name}</strong> {activeLedgerSupplier.gst_number ? `· GST: ${activeLedgerSupplier.gst_number}` : ''}</p>
              </div>
              <button className="btn btn-secondary" onClick={() => setActiveLedgerSupplier(null)}>✕ Close</button>
            </div>

            {loadingLedger && <p>Loading orders ledger…</p>}

            {!loadingLedger && ledgerData && ledgerData.orders?.length === 0 && (
              <p style={{ color: '#9ca3af', fontStyle: 'italic', padding: 20 }}>No purchase orders on record for this supplier.</p>
            )}

            {!loadingLedger && ledgerData && ledgerData.orders?.length > 0 && (
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>PO #</th>
                    <th>Site / Store</th>
                    <th>Status</th>
                    <th>Delivery (GRN)</th>
                    <th>Payment</th>
                    <th>Docs</th>
                    <th className="num">Total Value</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerData.orders.map((po) => (
                    <tr key={po.po_id}>
                      <td className="num"><strong>{po.po_number}</strong></td>
                      <td>{po.store_location || '—'}</td>
                      <td><span className="stamp stamp-neutral">{po.status}</span></td>
                      <td>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: po.receipt_pct >= 100 ? '#dcfce7' : po.receipt_pct > 0 ? '#fef3c7' : '#f3f4f6',
                          color: po.receipt_pct >= 100 ? '#15803d' : po.receipt_pct > 0 ? '#b45309' : '#6b7280',
                        }}>
                          {po.receipt_pct >= 100 ? '✓ Recv 100%' : po.receipt_pct > 0 ? `Recv ${po.receipt_pct}%` : 'Pending'}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                          background: po.erp_payment_status === 'paid' ? '#dcfce7' : '#f3f4f6',
                          color: po.erp_payment_status === 'paid' ? '#15803d' : '#6b7280',
                        }}>
                          {po.erp_payment_status}
                        </span>
                      </td>
                      <td>{po.document_count > 0 ? `📄 ${po.document_count}` : '—'}</td>
                      <td className="num">₹{Number(po.total_value).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  formCard: { border: '1px solid var(--color-line)', borderRadius: 5, padding: 18, margin: '12px 0', background: 'var(--color-surface)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 },
  checkboxGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 13 },
  checkboxGridScroll: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13, maxHeight: 180, overflowY: 'auto', border: '1px solid var(--color-line)', borderRadius: 3, padding: 8 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 4 },
  formActions: { display: 'flex', gap: 8 },
}
