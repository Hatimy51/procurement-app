import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

export default function QuoteHistory() {
  const [quotes, setQuotes] = useState([])
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [drafts, setDrafts] = useState({}) // price_entry_id -> {cost_price, selling_price}
  const [saving, setSaving] = useState(false)

  const loadQuotes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setQuotes(await api.listQuotes())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadQuotes() }, [loadQuotes])

  async function openDetail(id) {
    setSelectedId(id)
    setDetailLoading(true)
    setError(null)
    try {
      const data = await api.getQuoteDetail(id)
      setDetail(data)
      const initialDrafts = {}
      data.items.forEach((i) => {
        initialDrafts[i.price_entry_id] = {
          cost_price: i.cost_price ?? '',
          selling_price: i.selling_price ?? '',
        }
      })
      setDrafts(initialDrafts)
    } catch (e) {
      setError(e.message)
    } finally {
      setDetailLoading(false)
    }
  }

  function backToList() {
    setSelectedId(null)
    setDetail(null)
    setDrafts({})
  }

  async function handleDeleteQuote(id) {
    if (!window.confirm('Delete this entire quote? All its price entries will be removed too. This cannot be undone.')) return
    setError(null)
    try {
      await api.deleteQuote(id)
      setInfoMessage('Quote deleted.')
      if (selectedId === id) backToList()
      loadQuotes()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDeleteItem(priceEntryId) {
    if (!window.confirm('Remove this product from the quote?')) return
    setError(null)
    try {
      await api.deleteQuoteItem(selectedId, priceEntryId)
      setDetail((d) => ({ ...d, items: d.items.filter((i) => i.price_entry_id !== priceEntryId) }))
      setDrafts((d) => {
        const next = { ...d }
        delete next[priceEntryId]
        return next
      })
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleSaveAll() {
    setSaving(true)
    setError(null)
    try {
      const items = detail.items.map((i) => ({
        price_entry_id: i.price_entry_id,
        cost_price: drafts[i.price_entry_id]?.cost_price || null,
        selling_price: drafts[i.price_entry_id]?.selling_price || null,
      }))
      await api.bulkUpdateQuoteItems(selectedId, items)
      setInfoMessage('Saved.')
      openDetail(selectedId) // refresh with the saved values
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function updateDraft(priceEntryId, field, value) {
    setDrafts((d) => ({ ...d, [priceEntryId]: { ...d[priceEntryId], [field]: value } }))
  }

  if (selectedId && detail) {
    return (
      <div>
        <div style={styles.detailHeader}>
          <button style={styles.linkButton} onClick={backToList}>← Back to list</button>
          <button style={styles.dangerLinkButton} onClick={() => handleDeleteQuote(selectedId)}>
            Delete this quote
          </button>
        </div>
        <h2 style={{ marginBottom: 4 }}>{detail.supplier_name}</h2>
        <p style={styles.muted}>
          Received {new Date(detail.created_at).toLocaleString()}
          {detail.extraction_confidence != null && (
            <> · Extraction confidence: {Math.round(detail.extraction_confidence * 100)}%</>
          )}
        </p>

        {error && <div style={styles.errorBanner}>{error}</div>}
        {infoMessage && <div style={styles.infoBanner}>{infoMessage}</div>}

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', color: '#555' }}>View original quote text</summary>
          <pre style={styles.rawText}>{detail.raw_source}</pre>
        </details>

        <div style={styles.sectionHeaderRow}>
          <h3 style={{ margin: 0 }}>Products in this quote</h3>
          <button style={styles.primaryButton} onClick={handleSaveAll} disabled={saving || detail.items.length === 0}>
            {saving ? 'Saving…' : 'Save All'}
          </button>
        </div>

        {detailLoading ? (
          <p>Loading…</p>
        ) : detail.items.length === 0 ? (
          <p style={styles.muted}>No products left in this quote.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Product</th>
                <th style={styles.th}>Spec</th>
                <th style={styles.th}>Cost Price</th>
                <th style={styles.th}>Selling Price</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => {
                const draft = drafts[item.price_entry_id] || { cost_price: '', selling_price: '' }
                return (
                  <tr key={item.price_entry_id} style={styles.tr}>
                    <td style={styles.td}>{item.product_name}</td>
                    <td style={styles.td}>{item.spec || '—'}</td>
                    <td style={styles.td}>
                      <input
                        style={styles.priceInput}
                        type="number"
                        step="0.01"
                        value={draft.cost_price}
                        onChange={(e) => updateDraft(item.price_entry_id, 'cost_price', e.target.value)}
                      />
                    </td>
                    <td style={styles.td}>
                      <input
                        style={styles.priceInput}
                        type="number"
                        step="0.01"
                        placeholder="Enter selling price"
                        value={draft.selling_price}
                        onChange={(e) => updateDraft(item.price_entry_id, 'selling_price', e.target.value)}
                      />
                    </td>
                    <td style={styles.td}>
                      <button
                        style={styles.crossButton}
                        title="Remove this product from the quote"
                        onClick={() => handleDeleteItem(item.price_entry_id)}
                      >
                        ×
                      </button>
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

  return (
    <div>
      <PageHeader
        eyebrow="Supplier Replies"
        title="Quote History"
        description="Every supplier reply ever ingested — click one to see what it priced."
      />

      {error && <div style={styles.errorBanner}>{error}</div>}
      {infoMessage && <div style={styles.infoBanner}>{infoMessage}</div>}

      {/* Search and Supplier Filter */}
      {quotes.length > 0 && (
        <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            placeholder="Search quotes by supplier name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="all">All Suppliers</option>
            {[...new Set(quotes.map((q) => q.supplier_name).filter(Boolean))].map((sup) => (
              <option key={sup} value={sup}>{sup}</option>
            ))}
          </select>
        </div>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : quotes.length === 0 ? (
        <p style={styles.muted}>No quotes ingested yet — do that from the Suppliers &amp; RFQs tab.</p>
      ) : (
        (() => {
          const qStr = search.trim().toLowerCase()
          const filtered = quotes.filter((q) => {
            if (qStr && !q.supplier_name?.toLowerCase().includes(qStr)) return false
            if (supplierFilter !== 'all' && q.supplier_name !== supplierFilter) return false
            return true
          })

          if (filtered.length === 0) {
            return <p style={{ ...styles.muted, padding: '20px 0' }}>No ingested quotes match your search or filter.</p>
          }

          return (
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Supplier</th>
                  <th style={styles.th}>Items</th>
                  <th style={styles.th}>Received</th>
                  <th style={styles.th}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr key={q.id} style={styles.tr}>
                    <td style={styles.td}>{q.supplier_name}</td>
                    <td style={styles.td}>{q.item_count}</td>
                    <td style={styles.td}>{new Date(q.created_at).toLocaleString()}</td>
                    <td style={styles.td}>
                      <button style={styles.linkButton} onClick={() => openDetail(q.id)}>View</button>
                      <button style={styles.dangerLinkButton} onClick={() => handleDeleteQuote(q.id)}>Delete</button>
                    </td>
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
  title: { fontSize: 20, margin: '0 0 4px 0', color: 'var(--color-ink)' },
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  errorBanner: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-danger)' },
  infoBanner: { background: 'var(--color-accent-soft)', color: 'var(--color-accent)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-accent)' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  rawText: { background: 'var(--color-paper)', padding: 12, borderRadius: 3, whiteSpace: 'pre-wrap', fontSize: 12.5, fontFamily: 'var(--font-mono)', border: '1px solid var(--color-line)' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '1px solid var(--color-line-strong)', padding: '10px 10px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, background: 'var(--color-paper)' },
  tr: { borderBottom: '1px solid var(--color-line)' },
  td: { padding: '10px 10px' },
  priceInput: { width: 110, padding: 5, fontSize: 12.5, fontFamily: 'var(--font-mono)' },
  crossButton: { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', borderRadius: 2, color: 'var(--color-danger)', cursor: 'pointer', fontSize: 14, width: 26, height: 26, lineHeight: 1 },
  primaryButton: { background: 'var(--color-rust)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500 },
  linkButton: { background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12.5, padding: 0, marginRight: 10, fontFamily: 'var(--font-sans)' },
  dangerLinkButton: { background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 12.5, padding: 0, fontFamily: 'var(--font-sans)' },
}
