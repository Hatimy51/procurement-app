import { useState, useEffect, useCallback, useMemo } from 'react'
import { api } from './api'
import RequestQuoteWizard from './RequestQuoteWizard'

const STATUS_LABEL = {
  pending: 'Awaiting reply',
  quote_received: 'Quote received',
  cancelled: 'Cancelled',
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [rfqs, setRfqs] = useState([])
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

  const [wizardOpen, setWizardOpen] = useState(false)

  const [ingestingSupplierId, setIngestingSupplierId] = useState(null)
  const [ingestMode, setIngestMode] = useState('paste')
  const [ingestText, setIngestText] = useState('')
  const [ingestFile, setIngestFile] = useState(null)
  const [ingesting, setIngesting] = useState(false)

  const loadAll = useCallback(async () => {
    try {
      const [s, p, r] = await Promise.all([
        api.listSuppliers(),
        api.listProducts(),
        api.listRfqs(),
      ])
      setSuppliers(s)
      setProducts(p)
      setRfqs(r)
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
      setSupplierForm({ name: '', email: '', phone: '' })
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

  function handleWizardDone(result) {
    setWizardOpen(false)
    setInfoMessage(
      `Created ${result.rfqs_created} RFQ(s) — ${result.items_count} item(s) × ${result.suppliers_count} supplier(s). ` +
        `Send the actual request to each supplier yourself, then come back and ingest their replies below.`
    )
    loadAll()
  }

  function openIngestFor(supplierId) {
    setIngestingSupplierId(ingestingSupplierId === supplierId ? null : supplierId)
    setIngestText('')
    setIngestFile(null)
    setError(null)
  }

  async function submitIngest(supplierId) {
    setIngesting(true)
    setError(null)
    try {
      let result
      if (ingestMode === 'file') {
        if (!ingestFile) {
          setError('Choose a file first.')
          setIngesting(false)
          return
        }
        result = await api.ingestQuoteFileForSupplier(supplierId, ingestFile)
      } else {
        if (!ingestText.trim()) {
          setError('Paste the supplier\'s reply first.')
          setIngesting(false)
          return
        }
        result = await api.ingestQuoteForSupplierText(supplierId, ingestText)
      }
      const parts = []
      if (result.priced.length > 0) {
        parts.push(
          `Priced: ${result.priced.map((p) => `${p.product_name} (₹${p.price})`).join(', ')}.`
        )
      }
      if (result.still_pending.length > 0) {
        parts.push(`Still awaiting a price: ${result.still_pending.join(', ')}.`)
      }
      if (result.extra_items_in_reply_not_matched.length > 0) {
        parts.push(
          `Not matched to anything we asked about: ${result.extra_items_in_reply_not_matched.join(', ')}.`
        )
      }
      setInfoMessage(parts.join(' ') || 'No prices could be matched from that reply.')
      setIngestingSupplierId(null)
      loadAll()
    } catch (e) {
      setError(e.message)
    } finally {
      setIngesting(false)
    }
  }

  // Group pending RFQs by supplier — a supplier's reply is ingested once,
  // against everything currently pending for them, not one row at a time.
  const pendingBySupplier = rfqs
    .filter((r) => r.status === 'pending')
    .reduce((acc, r) => {
      if (!acc[r.supplier_id]) acc[r.supplier_id] = { supplier_name: r.supplier_name, items: [] }
      acc[r.supplier_id].items.push(r)
      return acc
    }, {})
  const resolved = rfqs.filter((r) => r.status !== 'pending')

  return (
    <div>
      <h1 style={styles.title}>Suppliers & RFQs</h1>
      <p style={styles.muted}>
        For missing-price items: create an RFQ, send the actual request to the supplier
        yourself (outside the app for now), then come back and paste or upload their reply —
        it gets read the same way enquiries do, and the price is added automatically.
      </p>

      {error && <div style={styles.errorBanner}>{error}</div>}
      {infoMessage && <div style={styles.infoBanner}>{infoMessage}</div>}

      <div style={styles.headerRow}>
        <h3 style={{ margin: 0 }}>Suppliers</h3>
        <button style={styles.secondaryButton} onClick={openNewSupplierForm}>
          + Add Supplier
        </button>
      </div>

      {supplierFormOpen && (
        <form style={styles.formCard} onSubmit={submitSupplierForm}>
          <h4 style={{ marginTop: 0 }}>{editingSupplierId ? 'Edit Supplier' : 'New Supplier'}</h4>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label style={styles.label}>Name</label>
              <input
                style={styles.input}
                placeholder="Supplier name"
                required
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Email</label>
              <input
                style={styles.input}
                type="email"
                placeholder="e.g. sales@supplier.com"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>Phone No.</label>
              <input
                style={styles.input}
                type="tel"
                placeholder="e.g. 98765 43210"
                value={supplierForm.phone}
                onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
              />
            </div>
          </div>

          <div style={styles.field}>
            <label style={styles.label}>Linked Categories</label>
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
            <label style={styles.label}>Linked Products</label>
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
            <button type="submit" style={styles.primaryButton}>Save Supplier</button>
            <button type="button" style={styles.secondaryButton} onClick={() => setSupplierFormOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {suppliers.length === 0 ? (
        <p style={styles.muted}>No suppliers yet — add one to start creating RFQs.</p>
      ) : (
        <ul style={styles.supplierList}>
          {suppliers.map((s) => {
            const linkCount = (s.linked_product_ids?.length || 0) + (s.linked_categories?.length || 0)
            return (
              <li key={s.id}>
                {s.name}
                {s.email && <span style={styles.muted}> — {s.email}</span>}
                {s.phone && <span style={styles.muted}> — {s.phone}</span>}
                {linkCount > 0 && (
                  <span style={styles.muted}> · linked to {s.linked_categories?.length || 0} categor{s.linked_categories?.length === 1 ? 'y' : 'ies'}, {s.linked_product_ids?.length || 0} product(s)</span>
                )}
                {' '}
                <button style={styles.linkButton} onClick={() => openEditSupplierForm(s)}>Edit</button>
                <button style={styles.dangerLinkButton} onClick={() => handleDeleteSupplier(s)}>Delete</button>
              </li>
            )
          })}
        </ul>
      )}

      <div style={styles.headerRow}>
        <h3 style={{ margin: 0 }}>Request a Quote (RFQ)</h3>
        <button style={styles.secondaryButton} onClick={() => setWizardOpen(!wizardOpen)}>
          {wizardOpen ? 'Close' : '+ Request Quote'}
        </button>
      </div>

      {wizardOpen && (
        <RequestQuoteWizard
          products={products}
          suppliers={suppliers}
          onDone={handleWizardDone}
          onCancel={() => setWizardOpen(false)}
        />
      )}

      <h4 style={{ marginTop: 20 }}>Awaiting reply</h4>
      {Object.keys(pendingBySupplier).length === 0 ? (
        <p style={styles.muted}>Nothing pending.</p>
      ) : (
        Object.entries(pendingBySupplier).map(([supplierId, group]) => (
          <div key={supplierId} style={styles.supplierGroup}>
            <div style={styles.supplierGroupHeader}>
              <strong>{group.supplier_name}</strong>
              <span style={styles.muted}> — {group.items.length} item(s) awaiting a price</span>
              <button style={styles.linkButton} onClick={() => openIngestFor(supplierId)}>
                {ingestingSupplierId === supplierId ? 'Cancel' : 'Ingest their reply'}
              </button>
            </div>
            <ul style={styles.pendingItemList}>
              {group.items.map((r) => (
                <li key={r.id}>
                  {r.product_name}
                  {r.quantity != null && <span style={styles.muted}> (qty {r.quantity})</span>}
                </li>
              ))}
            </ul>

            {ingestingSupplierId === supplierId && (
              <div style={styles.subRow}>
                <p style={styles.muted}>
                  Paste or upload the supplier's ONE reply — it can cover any number of the items
                  above. Whatever it prices gets matched and updated; anything it doesn't mention
                  stays pending.
                </p>
                <div style={styles.modeToggle}>
                  <button
                    type="button"
                    style={ingestMode === 'paste' ? styles.modeButtonActive : styles.modeButton}
                    onClick={() => setIngestMode('paste')}
                  >
                    Paste text
                  </button>
                  <button
                    type="button"
                    style={ingestMode === 'file' ? styles.modeButtonActive : styles.modeButton}
                    onClick={() => setIngestMode('file')}
                  >
                    Upload file
                  </button>
                </div>
                {ingestMode === 'paste' ? (
                  <textarea
                    style={styles.textarea}
                    rows={4}
                    placeholder="Paste the supplier's reply email here…"
                    value={ingestText}
                    onChange={(e) => setIngestText(e.target.value)}
                  />
                ) : (
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
                    onChange={(e) => setIngestFile(e.target.files?.[0] || null)}
                  />
                )}
                <div style={{ marginTop: 8 }}>
                  <button
                    style={styles.primaryButton}
                    onClick={() => submitIngest(supplierId)}
                    disabled={ingesting}
                  >
                    {ingesting ? 'Reading reply…' : 'Extract Prices'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))
      )}

      {resolved.length > 0 && (
        <>
          <h4 style={{ marginTop: 20 }}>Resolved</h4>
          <table style={styles.table}>
            <tbody>
              {resolved.map((r) => (
                <tr key={r.id} style={styles.tr}>
                  <td style={styles.td}>{r.product_name}</td>
                  <td style={styles.td}>{r.supplier_name}</td>
                  <td style={styles.td}>{STATUS_LABEL[r.status] || r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

const styles = {
  title: { fontSize: 22, margin: '0 0 4px 0' },
  muted: { color: '#888', fontSize: 13 },
  errorBanner: { background: '#fdecea', color: '#611a15', padding: 10, borderRadius: 6, marginBottom: 12 },
  infoBanner: { background: '#eff6ff', color: '#1e3a8a', padding: 10, borderRadius: 6, marginBottom: 12 },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20 },
  formCard: { border: '1px solid #ddd', borderRadius: 8, padding: 16, margin: '12px 0', background: '#f9fafb' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 },
  checkboxGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, fontSize: 13 },
  checkboxGridScroll: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 13, maxHeight: 180, overflowY: 'auto', border: '1px solid #eee', borderRadius: 6, padding: 8 },
  checkboxLabel: { display: 'flex', alignItems: 'center', gap: 4 },
  label: { fontSize: 12, color: '#555', fontWeight: 600 },
  input: { padding: 8, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' },
  textarea: { width: '100%', padding: 8, border: '1px solid #ccc', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' },
  supplierList: { fontSize: 14, paddingLeft: 20 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 8 },
  tr: { borderBottom: '1px solid #eee' },
  td: { padding: '8px 6px' },
  subRow: { padding: '8px 6px', background: '#fafafa' },
  supplierGroup: { border: '1px solid #eee', borderRadius: 6, padding: 12, marginBottom: 10 },
  supplierGroupHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 14 },
  pendingItemList: { margin: '4px 0 0 0', paddingLeft: 20, fontSize: 13, color: '#555' },
  modeToggle: { display: 'flex', gap: 4, marginBottom: 8 },
  modeButton: { background: 'white', border: '1px solid #ccc', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: '#555' },
  modeButtonActive: { background: '#2563eb', border: '1px solid #2563eb', padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'white' },
  primaryButton: { background: '#2563eb', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  secondaryButton: { background: 'white', color: '#333', border: '1px solid #ccc', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  linkButton: { background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: 13, padding: 0, marginRight: 8 },
  dangerLinkButton: { background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 13, padding: 0 },
}
