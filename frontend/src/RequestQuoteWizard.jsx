import { useState, useMemo } from 'react'
import { api } from './api'

export default function RequestQuoteWizard({ products, suppliers, onDone, onCancel }) {
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState('products') // 'products' | 'categories' — mutually exclusive per the spec
  const [search, setSearch] = useState('')

  const [selectedProductIds, setSelectedProductIds] = useState(new Set())
  const [quantities, setQuantities] = useState({}) // productId -> quantity string
  const [selectedCategories, setSelectedCategories] = useState(new Set())

  const [selectedSupplierIds, setSelectedSupplierIds] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category).filter(Boolean))
    return [...set].sort()
  }, [products])

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q) ||
        (p.spec || '').toLowerCase().includes(q)
    )
  }, [products, search])

  function switchMode(newMode) {
    // Switching modes clears the other's selections — products and
    // categories are mutually exclusive, per the spec.
    setMode(newMode)
    setSelectedProductIds(new Set())
    setSelectedCategories(new Set())
    setQuantities({})
  }

  function toggleProduct(id) {
    setSelectedProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCategory(cat) {
    setSelectedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const itemCount =
    mode === 'products'
      ? selectedProductIds.size
      : products.filter((p) => selectedCategories.has(p.category)).length

  function toggleSupplier(id) {
    setSelectedSupplierIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    setError(null)
    let items
    if (mode === 'products') {
      items = [...selectedProductIds].map((id) => ({
        product_id: id,
        quantity: quantities[id] || null,
      }))
    } else {
      // category mode expands to every product currently in the selected
      // categories — no per-item quantity, since the point is getting a
      // full-category price check rather than a specific order quantity
      items = products
        .filter((p) => selectedCategories.has(p.category))
        .map((p) => ({ product_id: p.id, quantity: null }))
    }

    if (items.length === 0) {
      setError('Select at least one product or category.')
      return
    }
    if (selectedSupplierIds.size === 0) {
      setError('Select at least one supplier.')
      return
    }

    setSubmitting(true)
    try {
      const result = await api.createRfqsBulk({ items, supplier_ids: [...selectedSupplierIds] })
      onDone(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={styles.wizard}>
      <div style={styles.stepIndicator}>
        <span style={step === 1 ? styles.stepActive : styles.step}>1. Select items</span>
        <span style={styles.stepArrow}>→</span>
        <span style={step === 2 ? styles.stepActive : styles.step}>2. Select suppliers</span>
      </div>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {step === 1 && (
        <div>
          <div style={styles.modeToggle}>
            <button
              type="button"
              style={mode === 'products' ? styles.modeButtonActive : styles.modeButton}
              onClick={() => switchMode('products')}
            >
              Select Products
            </button>
            <button
              type="button"
              style={mode === 'categories' ? styles.modeButtonActive : styles.modeButton}
              onClick={() => switchMode('categories')}
            >
              Select Categories
            </button>
          </div>

          {mode === 'products' ? (
            <>
              <input
                style={styles.search}
                placeholder="Search by name, category, or spec…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <div style={styles.tableScroll}>
                <table style={styles.table}>
                  <thead>
                    <tr>
                      <th style={styles.th}></th>
                      <th style={styles.th}>Name</th>
                      <th style={styles.th}>Category</th>
                      <th style={styles.th}>Spec</th>
                      <th style={styles.th}>Unit</th>
                      <th style={styles.th}>Latest Price</th>
                      <th style={styles.th}>Qty to request</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProducts.map((p) => {
                      const price = p.price_entries?.[0]
                      const checked = selectedProductIds.has(p.id)
                      return (
                        <tr key={p.id} style={styles.tr}>
                          <td style={styles.td}>
                            <input type="checkbox" checked={checked} onChange={() => toggleProduct(p.id)} />
                          </td>
                          <td style={styles.td}>{p.name}</td>
                          <td style={styles.td}>{p.category || '—'}</td>
                          <td style={styles.td}>{p.spec || '—'}</td>
                          <td style={styles.td}>{p.unit || '—'}</td>
                          <td style={styles.td}>
                            {price ? `₹${price.selling_price ?? price.cost_price ?? '—'}` : (
                              <span style={styles.missingPrice}>Missing</span>
                            )}
                          </td>
                          <td style={styles.td}>
                            <input
                              style={styles.qtyInput}
                              type="number"
                              placeholder="Qty"
                              disabled={!checked}
                              value={quantities[p.id] || ''}
                              onChange={(e) => setQuantities({ ...quantities, [p.id]: e.target.value })}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div>
              <p style={styles.muted}>
                Selecting a category sends an RFQ for every product currently in it — useful for
                getting a full price check across a whole category at once.
              </p>
              {categories.length === 0 ? (
                <p style={styles.muted}>No categories found — products need a Category set first.</p>
              ) : (
                <ul style={styles.categoryList}>
                  {categories.map((cat) => {
                    const count = products.filter((p) => p.category === cat).length
                    return (
                      <li key={cat}>
                        <label>
                          <input
                            type="checkbox"
                            checked={selectedCategories.has(cat)}
                            onChange={() => toggleCategory(cat)}
                          />{' '}
                          {cat} <span style={styles.muted}>({count} product{count === 1 ? '' : 's'})</span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          <div style={styles.formActions}>
            <button
              style={styles.primaryButton}
              onClick={() => setStep(2)}
              disabled={itemCount === 0}
            >
              Next ({itemCount} item{itemCount === 1 ? '' : 's'} selected) →
            </button>
            <button style={styles.secondaryButton} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p style={styles.muted}>
            Sending an RFQ for {itemCount} item{itemCount === 1 ? '' : 's'} — choose one or more
            suppliers to request quotes from. Selecting several sends the same request to all of
            them at once.
          </p>
          {suppliers.length === 0 ? (
            <p style={styles.muted}>No suppliers yet — add one first from the Suppliers list.</p>
          ) : (
            <ul style={styles.categoryList}>
              {suppliers.map((s) => (
                <li key={s.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedSupplierIds.has(s.id)}
                      onChange={() => toggleSupplier(s.id)}
                    />{' '}
                    {s.name}
                    {s.email && <span style={styles.muted}> — {s.email}</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div style={styles.formActions}>
            <button style={styles.secondaryButton} onClick={() => setStep(1)}>← Back</button>
            <button style={styles.primaryButton} onClick={submit} disabled={submitting}>
              {submitting ? 'Creating…' : `Create RFQs (${itemCount} × ${selectedSupplierIds.size})`}
            </button>
            <button style={styles.secondaryButton} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  wizard: { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16, background: '#f9fafb' },
  stepIndicator: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14 },
  step: { color: '#999' },
  stepActive: { color: '#2563eb', fontWeight: 600 },
  stepArrow: { color: '#ccc' },
  errorBanner: { background: '#fdecea', color: '#611a15', padding: 10, borderRadius: 6, marginBottom: 12 },
  muted: { color: '#888', fontSize: 13 },
  modeToggle: { display: 'flex', gap: 4, marginBottom: 12 },
  modeButton: { background: 'white', border: '1px solid #ccc', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555' },
  modeButtonActive: { background: '#2563eb', border: '1px solid #2563eb', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'white' },
  search: { width: '100%', padding: 8, fontSize: 14, marginBottom: 8, boxSizing: 'border-box', border: '1px solid #ccc', borderRadius: 6 },
  tableScroll: { maxHeight: 360, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '6px', color: '#555', position: 'sticky', top: 0, background: '#f9fafb' },
  tr: { borderBottom: '1px solid #eee' },
  td: { padding: '6px' },
  missingPrice: { color: '#b45309', background: '#fff7ed', padding: '1px 6px', borderRadius: 4, fontSize: 11 },
  qtyInput: { width: 70, padding: 4, border: '1px solid #ccc', borderRadius: 4, fontSize: 13 },
  categoryList: { listStyle: 'none', padding: 0, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  formActions: { display: 'flex', gap: 8, marginTop: 16 },
  primaryButton: { background: '#2563eb', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  secondaryButton: { background: 'white', color: '#333', border: '1px solid #ccc', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
}
