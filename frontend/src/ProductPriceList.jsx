import { useState, useEffect, useCallback } from 'react'
import { api } from './api'

const EMPTY_FORM = { name: '', category: '', spec: '', unit: '' }
const EMPTY_PRICE_FORM = { cost_price: '', selling_price: '' }

export default function ProductPriceList() {
  const [products, setProducts] = useState([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [editingId, setEditingId] = useState(null)

  const [priceFormFor, setPriceFormFor] = useState(null) // product id currently adding a price for
  const [priceForm, setPriceForm] = useState(EMPTY_PRICE_FORM)

  const [expandedId, setExpandedId] = useState(null)
  const [history, setHistory] = useState({}) // productId -> [PriceEntry]

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

  function openCreateForm() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setFormOpen(true)
  }

  function openEditForm(product) {
    setEditingId(product.id)
    setForm({
      name: product.name,
      category: product.category || '',
      spec: product.spec || '',
      unit: product.unit || '',
    })
    setFormOpen(true)
  }

  async function submitProductForm(e) {
    e.preventDefault()
    try {
      if (editingId) {
        await api.updateProduct(editingId, form)
      } else {
        await api.createProduct(form)
      }
      setFormOpen(false)
      loadProducts(search)
    } catch (e) {
      setError(e.message)
    }
  }

  async function submitPriceForm(e, productId) {
    e.preventDefault()
    try {
      await api.addPrice({
        product_id: productId,
        cost_price: priceForm.cost_price || null,
        selling_price: priceForm.selling_price || null,
        source: 'manual',
      })
      setPriceFormFor(null)
      setPriceForm(EMPTY_PRICE_FORM)
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

  function latestPrice(product) {
    return product.price_entries?.[0] || null
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

      {formOpen && (
        <form style={styles.formCard} onSubmit={submitProductForm}>
          <h3 style={{ marginTop: 0 }}>{editingId ? 'Edit Product' : 'New Product'}</h3>
          <div style={styles.formGrid}>
            <input
              style={styles.input}
              placeholder="Name (e.g. Cotton Pipe 4 inch)"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="Category (e.g. Pipes)"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="Spec (e.g. 110mm Red)"
              value={form.spec}
              onChange={(e) => setForm({ ...form, spec: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="Unit (e.g. Mtrs)"
              value={form.unit}
              onChange={(e) => setForm({ ...form, unit: e.target.value })}
            />
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
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Category</th>
              <th style={styles.th}>Spec</th>
              <th style={styles.th}>Unit</th>
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
                    <td style={styles.td}>{product.name}</td>
                    <td style={styles.td}>{product.category || '—'}</td>
                    <td style={styles.td}>{product.spec || '—'}</td>
                    <td style={styles.td}>{product.unit || '—'}</td>
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
                      <button
                        style={styles.linkButton}
                        onClick={() =>
                          setPriceFormFor(priceFormFor === product.id ? null : product.id)
                        }
                      >
                        Add Price
                      </button>
                      <button style={styles.linkButton} onClick={() => toggleHistory(product.id)}>
                        {expandedId === product.id ? 'Hide History' : 'History'}
                      </button>
                    </td>
                  </tr>

                  {priceFormFor === product.id && (
                    <tr>
                      <td colSpan={6} style={styles.subRow}>
                        <form
                          style={styles.inlinePriceForm}
                          onSubmit={(e) => submitPriceForm(e, product.id)}
                        >
                          <input
                            style={styles.inputSmall}
                            placeholder="Cost price"
                            type="number"
                            step="0.01"
                            value={priceForm.cost_price}
                            onChange={(e) =>
                              setPriceForm({ ...priceForm, cost_price: e.target.value })
                            }
                          />
                          <input
                            style={styles.inputSmall}
                            placeholder="Selling price"
                            type="number"
                            step="0.01"
                            value={priceForm.selling_price}
                            onChange={(e) =>
                              setPriceForm({ ...priceForm, selling_price: e.target.value })
                            }
                          />
                          <button type="submit" style={styles.primaryButtonSmall}>
                            Save Price
                          </button>
                        </form>
                      </td>
                    </tr>
                  )}

                  {expandedId === product.id && (
                    <tr>
                      <td colSpan={6} style={styles.subRow}>
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
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '8px 6px', color: '#555' },
  tr: { borderBottom: '1px solid #eee' },
  td: { padding: '8px 6px' },
  subRow: { padding: '8px 6px', background: '#fafafa' },
  muted: { color: '#888', fontSize: 12 },
  missingPrice: { color: '#b45309', background: '#fff7ed', padding: '2px 8px', borderRadius: 4, fontSize: 12 },
  emptyState: { color: '#666' },
  formCard: { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16, background: '#f9fafb' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 },
  formActions: { display: 'flex', gap: 8 },
  input: { padding: 8, border: '1px solid #ccc', borderRadius: 6, fontSize: 14 },
  inputSmall: { padding: 6, border: '1px solid #ccc', borderRadius: 6, fontSize: 13, width: 120 },
  inlinePriceForm: { display: 'flex', gap: 8, alignItems: 'center' },
  primaryButton: { background: '#2563eb', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  primaryButtonSmall: { background: '#2563eb', color: 'white', border: 'none', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  secondaryButton: { background: 'white', color: '#333', border: '1px solid #ccc', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  linkButton: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, marginRight: 10, padding: 0 },
  historyList: { margin: 0, paddingLeft: 20 },
}
