import { useState, useEffect, useCallback } from 'react'
import { api } from './api'

const EMPTY_FORM = { name: '', category: '', spec: '', unit: '', cost_price: '', selling_price: '', gst_percent: '' }
const EMPTY_BULK_PRICE_FORM = { cost_price: '', selling_price: '' }

export default function ProductPriceList() {
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)

  const [expandedId, setExpandedId] = useState(null)
  const [history, setHistory] = useState({}) // productId -> [PriceEntry]

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkPriceFormOpen, setBulkPriceFormOpen] = useState(false)
  const [bulkPriceForm, setBulkPriceForm] = useState(EMPTY_BULK_PRICE_FORM)
  const [bulkWorking, setBulkWorking] = useState(false)

  const loadProducts = useCallback(async (searchTerm) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listProducts(searchTerm)
      setProducts(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => loadProducts(search), 300) // debounce search typing
    return () => clearTimeout(t)
  }, [search, loadProducts])

  function latestPrice(product) {
    return product.price_entries?.[0] || null
  }

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditForm(product) {
    const price = latestPrice(product)
    setEditingId(product.id)
    setForm({
      name: product.name,
      category: product.category || '',
      spec: product.spec || '',
      unit: product.unit || '',
      cost_price: price?.cost_price ?? '',
      selling_price: price?.selling_price ?? '',
      gst_percent: product.gst_percent ?? '',
    })
    setFormOpen(true)
  }

  async function submitProductForm(e) {
    e.preventDefault()
    setError(null)
    try {
      const { cost_price, selling_price, ...productFields } = form
      productFields.gst_percent = productFields.gst_percent === '' ? null : productFields.gst_percent
      let productId = editingId
      if (editingId) {
        await api.updateProduct(editingId, productFields)
      } else {
        const created = await api.createProduct(productFields)
        productId = created.id
      }
      // A price is only recorded if at least one of the two fields was
      // actually filled in — editing a product without touching price
      // shouldn't create a new (empty) price-history entry.
      if (cost_price !== '' || selling_price !== '') {
        await api.addPrice({
          product_id: productId,
          cost_price: cost_price || null,
          selling_price: selling_price || null,
          source: 'manual',
        })
      }
      setFormOpen(false)
      loadProducts(search)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDeleteProduct(product) {
    if (
      !window.confirm(
        `Delete "${product.name}"? This also removes its price history. ` +
          `Any enquiry items linked to it will show as "not linked" instead of being deleted.`
      )
    )
      return
    setError(null)
    try {
      await api.deleteProduct(product.id)
      loadProducts(search)
    } catch (e) {
      setError(e.message)
    }
  }

  async function toggleHistory(productId) {
    if (expandedId === productId) {
      setExpandedId(null)
      return
    }
    setExpandedId(productId)
    if (!history[productId]) {
      try {
        const entries = await api.priceHistory(productId)
        setHistory((h) => ({ ...h, [productId]: entries }))
      } catch (e) {
        setError(e.message)
      }
    }
  }

  function toggleSelect(productId) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(productId)) next.delete(productId)
      else next.add(productId)
      return next
    })
  }

  function toggleSelectAll() {
    setSelectedIds((prev) =>
      prev.size === products.length ? new Set() : new Set(products.map((p) => p.id))
    )
  }

  async function handleBulkDelete() {
    if (
      !window.confirm(
        `Delete ${selectedIds.size} selected product(s)? This also removes their price history and cannot be undone.`
      )
    )
      return
    setError(null)
    setBulkWorking(true)
    try {
      await Promise.all([...selectedIds].map((id) => api.deleteProduct(id)))
      setInfoMessage(`${selectedIds.size} product(s) deleted.`)
      setSelectedIds(new Set())
      loadProducts(search)
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkWorking(false)
    }
  }

  async function submitBulkPriceUpdate(e) {
    e.preventDefault()
    if (bulkPriceForm.cost_price === '' && bulkPriceForm.selling_price === '') {
      setError('Enter at least a cost or selling price.')
      return
    }
    setError(null)
    setBulkWorking(true)
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          api.addPrice({
            product_id: id,
            cost_price: bulkPriceForm.cost_price || null,
            selling_price: bulkPriceForm.selling_price || null,
            source: 'manual',
          })
        )
      )
      setInfoMessage(`Price updated for ${selectedIds.size} product(s).`)
      setBulkPriceFormOpen(false)
      setBulkPriceForm(EMPTY_BULK_PRICE_FORM)
      setSelectedIds(new Set())
      loadProducts(search)
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkWorking(false)
    }
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>Product &amp; Price List</h1>
        <button style={styles.primaryButton} onClick={openCreateForm}>
          + Add Product
        </button>
      </header>

      <input
        style={styles.search}
        placeholder="Search by name, category, or spec…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div style={styles.errorBanner}>{error}</div>}
      {infoMessage && <div style={styles.infoBanner}>{infoMessage}</div>}

      {formOpen && (
        <form style={styles.formCard} onSubmit={submitProductForm}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Product' : 'New Product'}</h3>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                placeholder="e.g. Cotton Pipe 4 inch"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Category</label>
              <input
                style={styles.input}
                placeholder="e.g. Pipes"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Spec</label>
              <input
                style={styles.input}
                placeholder="e.g. 110mm Red"
                value={form.spec}
                onChange={(e) => setForm({ ...form, spec: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Unit</label>
              <input
                style={styles.input}
                placeholder="e.g. Mtrs"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Cost Price</label>
              <input
                style={styles.input}
                type="number"
                step="0.01"
                placeholder="e.g. 45.50"
                value={form.cost_price}
                onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Selling Price</label>
              <input
                style={styles.input}
                type="number"
                step="0.01"
                placeholder="e.g. 58.00"
                value={form.selling_price}
                onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>GST %</label>
              <input
                style={styles.input}
                type="number"
                step="0.01"
                placeholder="e.g. 18"
                value={form.gst_percent}
                onChange={(e) => setForm({ ...form, gst_percent: e.target.value })}
              />
            </div>
          </div>
          <div style={styles.formActions}>
            <button type="submit" style={styles.primaryButton}>
              {editingId ? 'Save Changes' : 'Create Product'}
            </button>
            <button type="button" style={styles.secondaryButton} onClick={() => setFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {selectedIds.size > 0 && (
        <div style={styles.bulkBar}>
          <span>{selectedIds.size} selected</span>
          <button style={styles.secondaryButtonSmall} onClick={() => setBulkPriceFormOpen(!bulkPriceFormOpen)}>
            Update Price
          </button>
          <button style={styles.dangerButtonSmall} onClick={handleBulkDelete} disabled={bulkWorking}>
            Delete Selected
          </button>
          <button style={styles.linkButton} onClick={() => setSelectedIds(new Set())}>
            Clear selection
          </button>
        </div>
      )}

      {bulkPriceFormOpen && (
        <form style={styles.formCard} onSubmit={submitBulkPriceUpdate}>
          <h3 style={{ marginTop: 0 }}>Update price for {selectedIds.size} product(s)</h3>
          <p style={styles.muted}>
            This sets the same price for every selected product — a new price-history entry is
            added for each. Leave a field blank to leave that side unchanged.
          </p>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Cost Price</label>
              <input
                style={styles.input}
                type="number"
                step="0.01"
                value={bulkPriceForm.cost_price}
                onChange={(e) => setBulkPriceForm({ ...bulkPriceForm, cost_price: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Selling Price</label>
              <input
                style={styles.input}
                type="number"
                step="0.01"
                value={bulkPriceForm.selling_price}
                onChange={(e) => setBulkPriceForm({ ...bulkPriceForm, selling_price: e.target.value })}
              />
            </div>
          </div>
          <div style={styles.formActions}>
            <button type="submit" style={styles.primaryButton} disabled={bulkWorking}>
              {bulkWorking ? 'Updating…' : 'Apply to Selected'}
            </button>
            <button type="button" style={styles.secondaryButton} onClick={() => setBulkPriceFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : products.length === 0 ? (
        <p style={styles.emptyState}>
          No products yet. {search ? 'Try a different search.' : 'Add one to get started — the price list builds up from here as enquiries and supplier quotes come in.'}
        </p>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === products.length && products.length > 0}
                  onChange={toggleSelectAll}
                />
              </th>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Spec</th>
              <th style={styles.th}>Unit</th>
              <th style={styles.th}>GST %</th>
              <th style={styles.th}>Latest Price</th>
              <th style={styles.th}></th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const price = latestPrice(product)
              return (
                <>
                  <tr key={product.id} style={styles.tr}>
                    <td style={styles.td}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                      />
                    </td>
                    <td style={styles.td}>{product.name}</td>
                    <td style={styles.td}>{product.category || '—'}</td>
                    <td style={styles.td}>{product.spec || '—'}</td>
                    <td style={styles.td}>{product.unit || '—'}</td>
                    <td style={styles.td}>{product.gst_percent != null ? `${product.gst_percent}%` : '—'}</td>
                    <td style={styles.td}>
                      {price ? (
                        <span>
                          ₹{price.selling_price ?? '—'}{' '}
                          <span style={styles.muted}>(cost ₹{price.cost_price ?? '—'})</span>
                        </span>
                      ) : (
                        <span style={styles.missingPrice}>Price Missing</span>
                      )}
                    </td>
                    <td style={{ ...styles.td, whiteSpace: 'nowrap' }}>
                      <button style={styles.linkButton} onClick={() => openEditForm(product)}>
                        Edit
                      </button>
                      <button style={styles.linkButton} onClick={() => toggleHistory(product.id)}>
                        {expandedId === product.id ? 'Hide History' : 'History'}
                      </button>
                      <button style={styles.dangerLinkButton} onClick={() => handleDeleteProduct(product)}>
                        Delete
                      </button>
                    </td>
                  </tr>

                  {expandedId === product.id && (
                    <tr>
                      <td colSpan={8} style={styles.subRow}>
                        {!history[product.id] ? (
                          <span style={styles.muted}>Loading history…</span>
                        ) : history[product.id].length === 0 ? (
                          <span style={styles.muted}>No price history yet.</span>
                        ) : (
                          <ul style={styles.historyList}>
                            {history[product.id].map((entry) => (
                              <li key={entry.id}>
                                {new Date(entry.date).toLocaleDateString()} — Selling ₹
                                {entry.selling_price ?? '—'}, Cost ₹{entry.cost_price ?? '—'}{' '}
                                <span style={styles.muted}>({entry.source})</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

const styles = {
  page: { fontFamily: 'system-ui, sans-serif', maxWidth: 1000, margin: '0 auto', padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, margin: 0 },
  search: { width: '100%', padding: 10, fontSize: 14, marginBottom: 16, boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: 6 },
  errorBanner: { background: '#fdecea', color: '#611a15', padding: 10, borderRadius: 6, marginBottom: 12 },
  infoBanner: { background: '#eff6ff', color: '#1e3a8a', padding: 10, borderRadius: 6, marginBottom: 12 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '8px 6px', color: '#555' },
  tr: { borderBottom: '1px solid #eee' },
  td: { padding: '8px 6px' },
  subRow: { padding: '8px 6px', background: '#fafafa' },
  muted: { color: '#888', fontSize: 12 },
  missingPrice: { color: '#b45309', background: '#fff7ed', padding: '2px 8px', borderRadius: 4, fontSize: 12 },
  emptyState: { color: '#666' },
  formCard: { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16, background: '#f9fafb' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 12, color: '#555', fontWeight: 600 },
  formActions: { display: 'flex', gap: 8 },
  input: { padding: 8, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  primaryButton: { background: '#2563eb', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  secondaryButton: { background: 'white', color: '#333', border: '1px solid #ccc', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  secondaryButtonSmall: { background: 'white', color: '#333', border: '1px solid #ccc', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  dangerButtonSmall: { background: '#b91c1c', color: 'white', border: 'none', padding: '5px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  linkButton: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, marginRight: 10, padding: 0 },
  dangerLinkButton: { background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13, padding: 0 },
  historyList: { margin: 0, paddingLeft: 20 },
  bulkBar: { display: 'flex', alignItems: 'center', gap: 10, background: '#f0f4ff', border: '1px solid #c7d7fe', borderRadius: 6, padding: '8px 12px', marginBottom: 12, fontSize: 13 },
}
