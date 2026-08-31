import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [supplierFormOpen, setSupplierFormOpen] = useState(false)
  const [editingSupplierId, setEditingSupplierId] = useState(null)
  const [supplierForm, setSupplierForm] = useState({
    name: '', email: '', phone: '', linked_product_ids: [], linked_categories: [],
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

  async function submitSupplierForm(e) {
    e.preventDefault()
    setError(null)
    try {
      if (editingSupplierId) {
        await api.updateSupplier(editingSupplierId, supplierForm)
      } else {
        await api.createSupplier(supplierForm)
      }
      setSupplierForm({ name: '', email: '', phone: '', linked_product_ids: [], linked_categories: [] })
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
      linked_product_ids: supplier.linked_product_ids || [],
      linked_categories: supplier.linked_categories || [],
    })
    setSupplierFormOpen(true)
  }

  function openNewSupplierForm() {
    setEditingSupplierId(null)
    setSupplierForm({ name: '', email: '', phone: '', linked_product_ids: [], linked_categories: [] })
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

      {suppliers.length === 0 ? (
        <p style={styles.muted}>No suppliers yet — add one to start creating RFQs.</p>
      ) : (
        <table className="ledger-table">
          <thead>
            <tr><th>Name</th><th>Contact</th><th>Linked to</th><th></th></tr>
          </thead>
          <tbody>
            {suppliers.map((s) => {
              const linkCount = (s.linked_product_ids?.length || 0) + (s.linked_categories?.length || 0)
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td className="num">
                    {s.email && <div>{s.email}</div>}
                    {s.phone && <div>{s.phone}</div>}
                  </td>
                  <td style={styles.muted}>
                    {linkCount > 0
                      ? `${s.linked_categories?.length || 0} categor${s.linked_categories?.length === 1 ? 'y' : 'ies'}, ${s.linked_product_ids?.length || 0} product(s)`
                      : '—'}
                  </td>
                  <td>
                    <button className="btn-link" onClick={() => openEditSupplierForm(s)}>Edit</button>
                    <button className="btn-link btn-link-danger" style={{ marginLeft: 8 }} onClick={() => handleDeleteSupplier(s)}>Delete</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
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
