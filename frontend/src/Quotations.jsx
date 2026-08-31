import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import RequestQuoteWizard from './RequestQuoteWizard'
import PageHeader from './PageHeader'

const STATUS_LABEL = {
  pending: 'Awaiting reply',
  quote_received: 'Quote received',
  cancelled: 'Cancelled',
}

export default function Quotations() {
  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [rfqs, setRfqs] = useState([])
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [wizardOpen, setWizardOpen] = useState(false)

  const [ingestingSupplierId, setIngestingSupplierId] = useState(null)
  const [ingestMode, setIngestMode] = useState('paste')
  const [ingestText, setIngestText] = useState('')
  const [ingestFile, setIngestFile] = useState(null)
  const [ingesting, setIngesting] = useState(false)
  const [lastIngestResult, setLastIngestResult] = useState(null)

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

  async function handleDeleteRfq(rfqId) {
    if (!window.confirm('Remove this RFQ? This cannot be undone.')) return
    setError(null)
    try {
      await api.deleteRfq(rfqId)
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
      setLastIngestResult(result)
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
      <PageHeader
        eyebrow="Sourcing"
        title="Quotations"
        description="For missing-price items: request a quote from a supplier, send it yourself, then paste or upload their reply — it's read the same way enquiries are, and the price is added automatically."
        action={
          <button className="btn btn-primary" onClick={() => setWizardOpen(!wizardOpen)}>
            {wizardOpen ? 'Close' : '+ Request Quote'}
          </button>
        }
      />

      {error && <div className="banner banner-error">{error}</div>}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {lastIngestResult && (
        <div className="card" style={{ padding: 14, marginBottom: 16, borderColor: 'var(--color-success)', background: 'var(--color-success-soft)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h4 style={{ margin: 0 }}>Reply results</h4>
            <button className="btn-link" onClick={() => setLastIngestResult(null)}>Dismiss</button>
          </div>

          {lastIngestResult.priced.length > 0 && (
            <ul style={{ fontSize: 13, paddingLeft: 20, margin: '4px 0' }}>
              {lastIngestResult.priced.map((p) => (
                <li key={p.price_entry_id}>
                  {p.product_name} — cost ₹{p.cost_price}
                </li>
              ))}
            </ul>
          )}
          <p style={styles.muted}>
            Full details, editable prices, and per-item removal are on the{' '}
            <strong>Quote History</strong> tab.
          </p>

          {lastIngestResult.still_pending.length > 0 && (
            <p style={styles.muted}>
              Still awaiting a price: {lastIngestResult.still_pending.join(', ')}.
            </p>
          )}
          {lastIngestResult.extra_items_in_reply_not_matched.length > 0 && (
            <p style={styles.muted}>
              Mentioned in the reply but not matched to anything we asked about:{' '}
              {lastIngestResult.extra_items_in_reply_not_matched.join(', ')}.
            </p>
          )}
        </div>
      )}

      {wizardOpen && (
        <RequestQuoteWizard
          products={products}
          suppliers={suppliers}
          onDone={handleWizardDone}
          onCancel={() => setWizardOpen(false)}
        />
      )}

      <h3 style={{ marginTop: wizardOpen ? 20 : 0 }}>Awaiting reply</h3>
      {Object.keys(pendingBySupplier).length === 0 ? (
        <p style={styles.muted}>Nothing pending.</p>
      ) : (
        Object.entries(pendingBySupplier).map(([supplierId, group]) => (
          <div key={supplierId} style={styles.supplierGroup}>
            <div style={styles.supplierGroupHeader}>
              <strong>{group.supplier_name}</strong>
              <span style={styles.muted}> — {group.items.length} item(s) awaiting a price</span>
              <button className="btn-link" onClick={() => openIngestFor(supplierId)}>
                {ingestingSupplierId === supplierId ? 'Cancel' : 'Ingest their reply'}
              </button>
            </div>
            <ul style={styles.pendingItemList}>
              {group.items.map((r) => (
                <li key={r.id}>
                  {r.product_name}
                  {r.quantity != null && <span style={styles.muted}> (qty {r.quantity})</span>}
                  {' '}
                  <button className="btn-link btn-link-danger" style={{ fontSize: 11 }} onClick={() => handleDeleteRfq(r.id)}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>

            {ingestingSupplierId === supplierId && (
              <div style={{ padding: '10px 10px', background: 'var(--color-paper)', borderRadius: 3, marginTop: 8 }}>
                <p style={styles.muted}>
                  Paste or upload the supplier's ONE reply — it can cover any number of the items
                  above. Whatever it prices gets matched and updated; anything it doesn't mention
                  stays pending.
                </p>
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  <button
                    type="button"
                    className={ingestMode === 'paste' ? 'btn btn-secondary' : 'btn'}
                    style={ingestMode !== 'paste' ? { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink-soft)' } : {}}
                    onClick={() => setIngestMode('paste')}
                  >
                    Paste text
                  </button>
                  <button
                    type="button"
                    className={ingestMode === 'file' ? 'btn btn-secondary' : 'btn'}
                    style={ingestMode !== 'file' ? { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', color: 'var(--color-ink-soft)' } : {}}
                    onClick={() => setIngestMode('file')}
                  >
                    Upload file
                  </button>
                </div>
                {ingestMode === 'paste' ? (
                  <textarea
                    style={{ width: '100%' }}
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
                    className="btn btn-primary"
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
          <h3 style={{ marginTop: 20 }}>Resolved</h3>
          <table className="ledger-table">
            <tbody>
              {resolved.map((r) => (
                <tr key={r.id}>
                  <td>{r.product_name}</td>
                  <td>{r.supplier_name}</td>
                  <td>{STATUS_LABEL[r.status] || r.status}</td>
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
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  supplierGroup: { border: '1px solid var(--color-line)', borderRadius: 3, padding: 12, marginBottom: 10 },
  supplierGroupHeader: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontSize: 14 },
  pendingItemList: { margin: '4px 0 0 0', paddingLeft: 20, fontSize: 13, color: 'var(--color-ink-soft)' },
}
