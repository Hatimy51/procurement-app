import { useState, useMemo, useEffect } from 'react'
import { api } from './api'

export default function RequestQuoteWizard({ products, suppliers, onDone, onCancel }) {
  const [step, setStep] = useState(1)
  const [mode, setMode] = useState('products') // 'products' | 'categories' — mutually exclusive per the spec
  const [search, setSearch] = useState('')

  const [selectedProductIds, setSelectedProductIds] = useState(new Set())
  const [quantities, setQuantities] = useState({}) // productId -> quantity string
  const [selectedCategories, setSelectedCategories] = useState(new Set())

  // Resolved once, when moving to step 2 — the fixed working set for the
  // group-builder below. [{product_id, name, quantity}]
  const [resolvedItems, setResolvedItems] = useState([])

  // Groups built so far: [{ id, productIds: Set, supplierIds: Set }]
  const [groups, setGroups] = useState([])
  const [builderProductIds, setBuilderProductIds] = useState(new Set())
  const [builderSupplierIds, setBuilderSupplierIds] = useState(new Set())
  const [suggestedSuppliers, setSuggestedSuppliers] = useState(suppliers.map((s) => ({ ...s, linked: false })))

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

  function goToStep2() {
    const items =
      mode === 'products'
        ? [...selectedProductIds].map((id) => {
            const p = products.find((pr) => pr.id === id)
            return { product_id: id, name: p?.name || id, quantity: quantities[id] || null }
          })
        : products
            .filter((p) => selectedCategories.has(p.category))
            .map((p) => ({ product_id: p.id, name: p.name, quantity: null }))

    setResolvedItems(items)
    setGroups([])
    setBuilderProductIds(new Set())
    setBuilderSupplierIds(new Set())
    setError(null)
    setStep(2)
  }

  // Items not yet claimed by any existing group.
  const assignedProductIds = useMemo(
    () => new Set(groups.flatMap((g) => [...g.productIds])),
    [groups]
  )
  const unassignedItems = useMemo(
    () => resolvedItems.filter((i) => !assignedProductIds.has(i.product_id)),
    [resolvedItems, assignedProductIds]
  )

  // Re-rank the supplier picker (linked-first) whenever the builder's
  // currently-checked items change — the more specific the selection,
  // the more relevant the ordering gets.
  useEffect(() => {
    if (builderProductIds.size === 0) {
      setSuggestedSuppliers(suppliers.map((s) => ({ ...s, linked: false })))
      return
    }
    api
      .getSuggestedSuppliers([...builderProductIds])
      .then(setSuggestedSuppliers)
      .catch(() => setSuggestedSuppliers(suppliers.map((s) => ({ ...s, linked: false }))))
  }, [builderProductIds, suppliers])

  function toggleBuilderProduct(id) {
    setBuilderProductIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleBuilderSupplier(id) {
    setBuilderSupplierIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function addGroup() {
    if (builderProductIds.size === 0) {
      setError('Select at least one item for this group.')
      return
    }
    if (builderSupplierIds.size === 0) {
      setError('Select at least one supplier for this group.')
      return
    }
    setError(null)
    setGroups((prev) => [
      ...prev,
      { id: crypto.randomUUID(), productIds: new Set(builderProductIds), supplierIds: new Set(builderSupplierIds) },
    ])
    setBuilderProductIds(new Set())
    setBuilderSupplierIds(new Set())
  }

  function removeGroup(groupId) {
    setGroups((prev) => prev.filter((g) => g.id !== groupId))
  }

  function itemName(productId) {
    return resolvedItems.find((i) => i.product_id === productId)?.name || productId
  }
  function supplierName(supplierId) {
    return suppliers.find((s) => s.id === supplierId)?.name || supplierId
  }

  async function submit() {
    setError(null)
    if (unassignedItems.length > 0) {
      setError(
        `${unassignedItems.length} item(s) haven't been assigned to a supplier yet: ` +
          unassignedItems.map((i) => i.name).join(', ')
      )
      return
    }
    if (groups.length === 0) {
      setError('Add at least one group before submitting.')
      return
    }

    const payload = {
      groups: groups.map((g) => ({
        items: [...g.productIds].map((pid) => ({
          product_id: pid,
          quantity: resolvedItems.find((i) => i.product_id === pid)?.quantity || null,
        })),
        supplier_ids: [...g.supplierIds],
      })),
    }

    setSubmitting(true)
    try {
      const result = await api.createRfqsBulkGrouped(payload)
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
        <span style={step === 2 ? styles.stepActive : styles.step}>2. Assign suppliers</span>
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
                <ul style={styles.plainList}>
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
            <button style={styles.primaryButton} onClick={goToStep2} disabled={itemCount === 0}>
              Next ({itemCount} item{itemCount === 1 ? '' : 's'} selected) →
            </button>
            <button style={styles.secondaryButton} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <p style={styles.muted}>
            Build one or more groups — pick a subset of the items below, pick the supplier(s) to
            send that subset to, then "Add Group" and repeat for whatever's left.
          </p>

          {groups.length > 0 && (
            <div style={styles.groupsList}>
              <h4 style={{ margin: '0 0 6px 0', fontSize: 14 }}>Groups so far</h4>
              {groups.map((g) => (
                <div key={g.id} style={styles.groupCard}>
                  <div>
                    <strong>{[...g.supplierIds].map(supplierName).join(', ')}</strong>
                    <span style={styles.muted}> ← {[...g.productIds].map(itemName).join(', ')}</span>
                  </div>
                  <button style={styles.dangerLinkButton} onClick={() => removeGroup(g.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}

          <div style={styles.builderCard}>
            <h4 style={{ margin: '0 0 6px 0', fontSize: 14 }}>
              {unassignedItems.length > 0
                ? `Build a group — ${unassignedItems.length} item(s) still unassigned`
                : 'All items assigned'}
            </h4>

            {unassignedItems.length === 0 ? (
              <p style={styles.muted}>Every item has a group. Submit below, or remove a group to reassign.</p>
            ) : (
              <>
                <p style={styles.mutedSmall}>Pick items for this group:</p>
                <ul style={styles.plainList}>
                  {unassignedItems.map((item) => (
                    <li key={item.product_id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={builderProductIds.has(item.product_id)}
                          onChange={() => toggleBuilderProduct(item.product_id)}
                        />{' '}
                        {item.name}
                      </label>
                    </li>
                  ))}
                </ul>

                <p style={styles.mutedSmall}>
                  Pick supplier(s) for this group{' '}
                  {builderProductIds.size > 0 && (
                    <span>— linked suppliers for these items are listed first</span>
                  )}
                  :
                </p>
                <ul style={styles.plainList}>
                  {suggestedSuppliers.map((s) => (
                    <li key={s.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={builderSupplierIds.has(s.id)}
                          onChange={() => toggleBuilderSupplier(s.id)}
                        />{' '}
                        {s.name}
                        {s.linked && <span style={styles.linkedBadge}> linked</span>}
                        {s.email && <span style={styles.muted}> — {s.email}</span>}
                      </label>
                    </li>
                  ))}
                </ul>

                <button style={styles.secondaryButton} onClick={addGroup}>+ Add Group</button>
              </>
            )}
          </div>

          <div style={styles.formActions}>
            <button style={styles.secondaryButton} onClick={() => setStep(1)}>← Back</button>
            <button style={styles.primaryButton} onClick={submit} disabled={submitting || groups.length === 0}>
              {submitting ? 'Creating…' : `Submit All RFQs (${groups.length} group${groups.length === 1 ? '' : 's'})`}
            </button>
            <button style={styles.secondaryButton} onClick={onCancel}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  wizard: { border: '1px solid var(--color-line)', borderRadius: 5, padding: 18, marginBottom: 16, background: 'var(--color-surface)' },
  stepIndicator: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13, fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  step: { color: 'var(--color-muted)' },
  stepActive: { color: 'var(--color-accent)', fontWeight: 600 },
  stepArrow: { color: 'var(--color-line-strong)' },
  errorBanner: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-danger)' },
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  mutedSmall: { color: 'var(--color-muted)', fontSize: 12, marginTop: 10, marginBottom: 4 },
  modeToggle: { display: 'flex', gap: 4, marginBottom: 12 },
  modeButton: { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', padding: '6px 12px', borderRadius: 3, cursor: 'pointer', fontSize: 12.5, color: 'var(--color-ink-soft)', fontFamily: 'var(--font-sans)' },
  modeButtonActive: { background: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '6px 12px', borderRadius: 3, cursor: 'pointer', fontSize: 12.5, color: 'white', fontFamily: 'var(--font-sans)' },
  search: { width: '100%', padding: 8, fontSize: 13, marginBottom: 8, boxSizing: 'border-box' },
  tableScroll: { maxHeight: 360, overflowY: 'auto', border: '1px solid var(--color-line)', borderRadius: 3 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '1px solid var(--color-line-strong)', padding: '8px', color: 'var(--color-muted)', position: 'sticky', top: 0, background: 'var(--color-paper)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500 },
  tr: { borderBottom: '1px solid var(--color-line)' },
  td: { padding: '8px' },
  missingPrice: { color: 'var(--color-warning)', background: 'var(--color-warning-soft)', padding: '2px 6px', borderRadius: 2, fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' },
  qtyInput: { width: 70, padding: 5, fontSize: 12.5 },
  plainList: { listStyle: 'none', padding: 0, fontSize: 14, display: 'flex', flexDirection: 'column', gap: 6, margin: 0 },
  groupsList: { marginBottom: 16 },
  groupCard: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)', borderRadius: 3, padding: '8px 10px', marginBottom: 6, fontSize: 13 },
  builderCard: { border: '1px dashed var(--color-line-strong)', borderRadius: 3, padding: 12, background: 'var(--color-surface)' },
  linkedBadge: { background: 'var(--color-success-soft)', color: 'var(--color-success)', fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '2px 6px', borderRadius: 2, marginLeft: 4 },
  formActions: { display: 'flex', gap: 8, marginTop: 16 },
  primaryButton: { background: 'var(--color-rust)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500 },
  secondaryButton: { background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)' },
  dangerLinkButton: { background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 12.5, padding: 0, fontFamily: 'var(--font-sans)' },
}
