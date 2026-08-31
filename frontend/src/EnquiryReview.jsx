import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from './api'
import { getConvertibleUnits, convertQuantity } from './units'
import PageHeader from './PageHeader'

const EMPTY_INGEST_FORM = { customer_name: '', site_name: '', raw_text: '' }

/**
 * When you copy content out of an email, the clipboard carries an HTML
 * version alongside the plain-text one. This walks that HTML in document
 * order — converting any <table> into clean "cell | cell | cell" rows
 * (matching the Excel upload's format) while keeping all the surrounding
 * plain text (greetings, notes, etc.) exactly where it was. Returns null
 * if there's no table at all, so the caller can fall back to a normal paste.
 */
function htmlToTextPreservingTables(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const tables = doc.querySelectorAll('table')
  if (tables.length === 0) return null

  tables.forEach((table) => {
    const lines = []
    table.querySelectorAll('tr').forEach((row) => {
      const cells = Array.from(row.querySelectorAll('td, th')).map((cell) =>
        cell.textContent.trim().replace(/\s+/g, ' ')
      )
      if (cells.some((c) => c)) lines.push(cells.join(' | '))
    })
    // Swap the table node in place with its converted text, so it stays
    // exactly where it was relative to the surrounding paragraphs.
    const replacement = doc.createElement('pre')
    replacement.textContent = `\n${lines.join('\n')}\n`
    table.replaceWith(replacement)
  })

  const BLOCK_TAGS = new Set(['div', 'p', 'tr', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
  function walk(node) {
    let text = ''
    node.childNodes.forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        text += child.textContent
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase()
        if (tag === 'br') text += '\n'
        else if (tag === 'pre') text += child.textContent
        else {
          text += walk(child)
          if (BLOCK_TAGS.has(tag)) text += '\n'
        }
      }
    })
    return text
  }

  return walk(doc.body)
    .replace(/[ \t]+\n/g, '\n')  // trailing spaces before line breaks
    .replace(/\n{3,}/g, '\n\n')  // collapse excess blank lines
    .trim()
}

const STATUS_LABEL = {
  new: 'New',
  reviewed: 'Reviewed',
  quoted: 'Quoted',
  approved: 'Approved',
  sent: 'Sent',
}

const PRICE_STATUS_LABEL = {
  matched: 'Priced',
  price_missing: 'Price Missing',
  unmatched: 'Not linked to a product',
}

export default function EnquiryReview() {
  const [enquiries, setEnquiries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)

  const [ingestOpen, setIngestOpen] = useState(false)
  const [ingestMode, setIngestMode] = useState('paste') // 'paste' | 'file'
  const [ingestForm, setIngestForm] = useState(EMPTY_INGEST_FORM)
  const [ingestFile, setIngestFile] = useState(null)
  const [ingesting, setIngesting] = useState(false)
  const [ingestElapsed, setIngestElapsed] = useState(0)

  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [products, setProducts] = useState([])

  // Keeps the paste textarea auto-sized to its content. Using an effect
  // (rather than only resizing on the onChange event) fixes the case where
  // switching to the file-upload tab and back unmounts/remounts the
  // textarea — a fresh DOM node has no memory of the previous height, so
  // this recalculates it from the current text whenever it reappears.
  const pasteTextareaRef = useRef(null)
  useEffect(() => {
    const el = pasteTextareaRef.current
    if (ingestMode === 'paste' && el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [ingestMode, ingestForm.raw_text])

  const loadEnquiries = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.listEnquiries()
      setEnquiries(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadEnquiries()
    // preload products, so the "link to product" dropdown in the review form is ready
    api.listProducts().then(setProducts).catch(() => {})
  }, [loadEnquiries])

  async function submitIngest(e) {
    e.preventDefault()
    setIngesting(true)
    setIngestElapsed(0)
    setError(null)

    // Ticks up every second so the button shows real progress instead of
    // sitting on a static "Reading enquiry…" that looks frozen — the free
    // local model can genuinely take a few minutes on ordinary laptop
    // hardware, and without this it's indistinguishable from being stuck.
    const timer = setInterval(() => setIngestElapsed((s) => s + 1), 1000)

    try {
      let created
      if (ingestMode === 'file') {
        if (!ingestFile) {
          setError('Choose a file to upload first.')
          setIngesting(false)
          clearInterval(timer)
          return
        }
        created = await api.ingestEnquiryFile(
          ingestForm.customer_name,
          ingestForm.site_name,
          ingestFile
        )
      } else {
        created = await api.ingestEnquiry(ingestForm)
      }
      setIngestOpen(false)
      setIngestForm(EMPTY_INGEST_FORM)
      setIngestFile(null)
      await loadEnquiries()
      openDetail(created.id)
    } catch (e) {
      // Show the real backend error directly now (see enquiries.py) instead
      // of guessing which AI provider is at fault — the message itself will
      // now say exactly what failed, whichever provider is configured.
      setError(e.message)
    } finally {
      setIngesting(false)
      clearInterval(timer)
    }
  }

  async function openDetail(id) {
    setSelectedId(id)
    setDetailLoading(true)
    try {
      const data = await api.getEnquiryDetail(id)
      setDetail(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setDetailLoading(false)
    }
  }

  async function saveItem(item) {
    try {
      const updated = await api.updateEnquiryItem(selectedId, item.id, {
        description: item.description,
        spec: item.spec,
        brand: item.brand,
        quantity: item.quantity,
        unit: item.unit,
        product_id: item.product_id,
      })
      setDetail((d) => ({
        ...d,
        items: d.items.map((i) => (i.id === item.id ? updated : i)),
      }))
    } catch (e) {
      setError(e.message)
    }
  }

  // Confirms a suggested match with one click — never applied automatically,
  // only ever in response to the Purchaser explicitly accepting it.
  async function confirmSuggestion(item) {
    await saveItem({ ...item, product_id: item.suggested_product_id })
  }

  async function markReviewed() {
    try {
      await api.markEnquiryReviewed(selectedId)
      await loadEnquiries()
      openDetail(selectedId)
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDeleteEnquiry(id) {
    if (!window.confirm('Delete this enquiry? This cannot be undone.')) return
    setError(null)
    try {
      await api.deleteEnquiry(id)
      await loadEnquiries()
      // if we deleted the one currently open, go back to the list
      if (selectedId === id) {
        setSelectedId(null)
        setDetail(null)
      }
    } catch (e) {
      setError(e.message)
    }
  }

  function toggleSelectEnquiry(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllEnquiries() {
    setSelectedIds((prev) =>
      prev.size === enquiries.length ? new Set() : new Set(enquiries.map((e) => e.id))
    )
  }

  async function handleBulkDeleteEnquiries() {
    if (
      !window.confirm(`Delete ${selectedIds.size} selected enquiry(ies)? This cannot be undone.`)
    )
      return
    setError(null)
    setBulkWorking(true)
    try {
      await Promise.all([...selectedIds].map((id) => api.deleteEnquiry(id)))
      setInfoMessage(`${selectedIds.size} enquiry(ies) deleted.`)
      setSelectedIds(new Set())
      await loadEnquiries()
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkWorking(false)
    }
  }

  async function handleBulkMarkReviewed() {
    const eligible = enquiries.filter((e) => selectedIds.has(e.id) && e.status === 'new')
    const skipped = selectedIds.size - eligible.length
    if (eligible.length === 0) {
      setError('None of the selected enquiries are eligible — only ones still marked "New" can be reviewed this way.')
      return
    }
    setError(null)
    setBulkWorking(true)
    try {
      const results = await Promise.allSettled(
        eligible.map((e) => api.markEnquiryReviewed(e.id))
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      setInfoMessage(
        `${eligible.length - failed} marked as reviewed.` +
          (failed > 0 ? ` ${failed} failed.` : '') +
          (skipped > 0 ? ` ${skipped} skipped (not in "New" status).` : '')
      )
      setSelectedIds(new Set())
      await loadEnquiries()
    } catch (e) {
      setError(e.message)
    } finally {
      setBulkWorking(false)
    }
  }

  async function saveItemAsNewProduct(item) {
    setError(null)
    try {
      const updated = await api.saveItemAsNewProduct(selectedId, item.id)
      setDetail((d) => ({
        ...d,
        items: d.items.map((i) => (i.id === item.id ? updated : i)),
      }))
      // so the "Linked product" dropdown shows the new product without a full refetch
      setProducts((prev) => [...prev, { id: updated.created_product_id, name: updated.created_product_name }])
      setInfoMessage(`Saved "${updated.created_product_name}" as a new product.`)
    } catch (e) {
      setError(e.message)
    }
  }

  async function saveAllAsNewProducts() {
    setError(null)
    try {
      const result = await api.saveAllAsProducts(selectedId)
      setInfoMessage(
        `${result.products_created} new product(s) created` +
          (result.items_already_linked_skipped > 0
            ? `, ${result.items_already_linked_skipped} item(s) were already linked and left as-is.`
            : '.')
      )
      await openDetail(selectedId)
      const freshProducts = await api.listProducts()
      setProducts(freshProducts)
    } catch (e) {
      setError(e.message)
    }
  }

  function updateLocalItem(itemId, field, value) {
    setDetail((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === itemId ? { ...i, [field]: value } : i)),
    }))
  }

  if (selectedId && detail) {
    return (
      <div>
        <div style={styles.detailHeader}>
          <button style={styles.linkButton} onClick={() => { setSelectedId(null); setDetail(null) }}>
            ← Back to list
          </button>
          <button
            style={styles.dangerLinkButton}
            onClick={() => handleDeleteEnquiry(selectedId)}
          >
            Delete this enquiry
          </button>
        </div>
        <h2 style={{ marginBottom: 4 }}>{detail.site_name}</h2>
        <p style={styles.muted}>
          {detail.customer_name} · Status: {STATUS_LABEL[detail.status] || detail.status}
          {detail.extraction_confidence != null && (
            <> · Extraction confidence: {Math.round(detail.extraction_confidence * 100)}%</>
          )}
        </p>

        {error && <div style={styles.errorBanner}>{error}</div>}
        {infoMessage && <div style={styles.infoBanner}>{infoMessage}</div>}

        <details style={{ marginBottom: 16 }}>
          <summary style={{ cursor: 'pointer', color: '#555' }}>View original enquiry text</summary>
          <pre style={styles.rawText}>{detail.raw_source}</pre>
        </details>

        <div style={styles.sectionHeaderRow}>
          <h3 style={{ margin: 0 }}>Extracted items — review and correct before pricing</h3>
          <button style={styles.secondaryButton} onClick={saveAllAsNewProducts}>
            Save all as new products
          </button>
        </div>
        <p style={styles.muted}>
          "Save as new" creates a fresh Product entry from that item — use this when it's
          genuinely something new. To link an item to something already in your Product list
          instead, use the dropdown. A confident suggestion shows inline for unmatched items —
          one click to accept, or ignore it and pick manually. For length/weight/volume units,
          a small "Convert to…" dropdown appears under the Unit field — e.g. switch a quantity
          from Feet to Meter depending on how the client you're quoting to prefers it.
        </p>
        {detailLoading ? (
          <p>Loading…</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Description</th>
                <th style={styles.th}>Spec</th>
                <th style={styles.th}>Brand</th>
                <th style={styles.th}>Qty</th>
                <th style={styles.th}>Unit</th>
                <th style={styles.th}>Linked product</th>
                <th style={styles.th}>Price</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item) => (
                <tr key={item.id} style={styles.tr}>
                  <td style={styles.td}>
                    <input
                      style={styles.cellInput}
                      value={item.description}
                      onChange={(e) => updateLocalItem(item.id, 'description', e.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={styles.cellInput}
                      value={item.spec || ''}
                      onChange={(e) => updateLocalItem(item.id, 'spec', e.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={styles.cellInput}
                      value={item.brand || ''}
                      onChange={(e) => updateLocalItem(item.id, 'brand', e.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.cellInput, width: 60 }}
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateLocalItem(item.id, 'quantity', e.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={{ ...styles.cellInput, width: 70 }}
                      value={item.unit}
                      onChange={(e) => updateLocalItem(item.id, 'unit', e.target.value)}
                    />
                    {getConvertibleUnits(item.unit).length > 0 && (
                      <select
                        style={styles.convertSelect}
                        value=""
                        onChange={(e) => {
                          const targetUnit = e.target.value
                          if (!targetUnit) return
                          const converted = convertQuantity(item.quantity, item.unit, targetUnit)
                          if (converted !== null) {
                            updateLocalItem(item.id, 'quantity', converted)
                            updateLocalItem(item.id, 'unit', targetUnit)
                          }
                          e.target.value = ''
                        }}
                      >
                        <option value="">Convert to…</option>
                        {getConvertibleUnits(item.unit)
                          .filter((u) => u.toLowerCase() !== (item.unit || '').trim().toLowerCase())
                          .map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                      </select>
                    )}
                  </td>
                  <td style={styles.td}>
                    <select
                      style={styles.cellInput}
                      value={item.product_id || ''}
                      onChange={(e) => updateLocalItem(item.id, 'product_id', e.target.value || null)}
                    >
                      <option value="">— not linked —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {!item.product_id && item.suggested_product_id && (
                      <div style={styles.suggestionRow}>
                        Did you mean <strong>{item.suggested_product_name}</strong>?{' '}
                        <span style={styles.muted}>({item.suggested_match_score}% match)</span>{' '}
                        <button style={styles.linkButton} onClick={() => confirmSuggestion(item)}>
                          Link it
                        </button>
                      </div>
                    )}
                  </td>
                  <td style={styles.td}>
                    {item.price_status === 'matched' ? (
                      <span>
                        ₹{item.suggested_price}
                        {item.gst_percent != null && (
                          <span style={styles.muted}> + {item.gst_percent}% GST</span>
                        )}
                      </span>
                    ) : item.price_status === 'price_missing' ? (
                      <span style={styles.missingPrice}>Price Missing</span>
                    ) : (
                      <span style={styles.muted}>{PRICE_STATUS_LABEL.unmatched}</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <button style={styles.linkButton} onClick={() => saveItem(item)}>Save</button>
                    <button style={styles.linkButton} onClick={() => saveItemAsNewProduct(item)}>
                      Save as new
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            style={styles.primaryButton}
            onClick={markReviewed}
            disabled={detail.status !== 'new'}
          >
            {detail.status === 'new' ? 'Mark Reviewed' : `Already ${STATUS_LABEL[detail.status]}`}
          </button>
          {detail.items.some((i) => i.price_status !== 'matched') && (
            <p style={styles.muted}>
              Note: some items still need pricing (missing or not yet linked to a product) —
              per the v1 flow, this is where you'd send an RFQ to a supplier or enter a price
              manually on the Product &amp; Price screen.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Intake"
        title="Enquiries"
        description="Turn an incoming customer enquiry — pasted text, an Excel file, or a screenshot — into structured, priceable line items."
        action={
          <button style={styles.primaryButton} onClick={() => setIngestOpen(!ingestOpen)}>
            + New Enquiry
          </button>
        }
      />

      {error && <div style={styles.errorBanner}>{error}</div>}

      {ingestOpen && (
        <form style={styles.formCard} onSubmit={submitIngest}>
          <h3 style={{ marginTop: 0 }}>Submit an enquiry</h3>
          <p style={styles.muted}>
            Stands in for the inbox auto-scan for now — paste the enquiry text, or upload an
            Excel file or a screenshot of the enquiry.
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
              Upload file (Excel or screenshot)
            </button>
          </div>

          <div style={styles.formGrid}>
            <input
              style={styles.input}
              placeholder="Customer name (e.g. Paradigm Realty)"
              required
              value={ingestForm.customer_name}
              onChange={(e) => setIngestForm({ ...ingestForm, customer_name: e.target.value })}
            />
            <input
              style={styles.input}
              placeholder="Site name (e.g. Midtown 71, Chembur)"
              required
              value={ingestForm.site_name}
              onChange={(e) => setIngestForm({ ...ingestForm, site_name: e.target.value })}
            />
          </div>

          {ingestMode === 'paste' ? (
            <textarea
              ref={pasteTextareaRef}
              style={styles.textarea}
              placeholder="Paste the raw enquiry email text here… (tables paste correctly too)"
              required
              rows={6}
              value={ingestForm.raw_text}
              onPaste={(e) => {
                const html = e.clipboardData.getData('text/html')
                const converted = html ? htmlToTextPreservingTables(html) : null
                if (converted) {
                  // it was a table (possibly with surrounding text) — use the
                  // structure-preserving conversion instead of the browser's
                  // own flattened text, and replace the current selection
                  // exactly like a normal paste would (so select-all + paste
                  // correctly replaces everything instead of appending)
                  e.preventDefault()
                  const textarea = e.target
                  const start = textarea.selectionStart
                  const end = textarea.selectionEnd
                  const current = ingestForm.raw_text
                  const newValue = current.slice(0, start) + converted + current.slice(end)
                  setIngestForm({ ...ingestForm, raw_text: newValue })
                  requestAnimationFrame(() => {
                    const cursorPos = start + converted.length
                    textarea.setSelectionRange(cursorPos, cursorPos)
                  })
                }
                // otherwise, not a table — let the normal paste happen as before
              }}
              onChange={(e) => setIngestForm({ ...ingestForm, raw_text: e.target.value })}
            />
          ) : (
            <div>
              <input
                type="file"
                accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setIngestFile(e.target.files?.[0] || null)}
                style={styles.fileInput}
              />
              {ingestFile && <p style={styles.muted}>Selected: {ingestFile.name}</p>}
              <p style={styles.muted}>
                Accepts .xlsx, .xls, .csv, or an image (.png/.jpg/.jpeg/.webp) — images go
                through OCR first, so results can be rougher than a typed file or pasted text.
              </p>
            </div>
          )}

          <div style={styles.formActions}>
            <button type="submit" style={styles.primaryButton} disabled={ingesting}>
              {ingesting ? `Reading enquiry… (${ingestElapsed}s)` : 'Submit & Extract'}
            </button>
            <button type="button" style={styles.secondaryButton} onClick={() => setIngestOpen(false)}>
              Cancel
            </button>
          </div>
          {ingesting && (
            <p style={styles.muted}>
              This runs on the free local AI model on your laptop, so it can genuinely take
              1–5 minutes depending on your hardware — this isn't necessarily stuck. If it
              runs past ~5 minutes, check the Terminal 1 window for errors, or visit{' '}
              <code>http://localhost:8000/api/diagnostics/ollama</code> in a new browser tab
              to test the connection directly.
            </p>
          )}
        </form>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : enquiries.length === 0 ? (
        <p style={styles.muted}>No enquiries yet — submit one to see the extraction in action.</p>
      ) : (
        <>
          {selectedIds.size > 0 && (
            <div style={styles.bulkBar}>
              <span>{selectedIds.size} selected</span>
              <button style={styles.secondaryButtonSmall} onClick={handleBulkMarkReviewed} disabled={bulkWorking}>
                Mark Reviewed
              </button>
              <button style={styles.dangerButtonSmall} onClick={handleBulkDeleteEnquiries} disabled={bulkWorking}>
                Delete Selected
              </button>
              <button style={styles.linkButton} onClick={() => setSelectedIds(new Set())}>
                Clear selection
              </button>
            </div>
          )}
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === enquiries.length && enquiries.length > 0}
                    onChange={toggleSelectAllEnquiries}
                  />
                </th>
                <th style={styles.th}>Site</th>
                <th style={styles.th}>Customer</th>
                <th style={styles.th}>Items</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {enquiries.map((e) => (
                <tr key={e.id} style={styles.tr}>
                  <td style={styles.td}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(e.id)}
                      onChange={() => toggleSelectEnquiry(e.id)}
                    />
                  </td>
                  <td style={styles.td}>{e.site_name}</td>
                  <td style={styles.td}>{e.customer_name}</td>
                  <td style={styles.td}>{e.item_count}</td>
                  <td style={styles.td}>{STATUS_LABEL[e.status] || e.status}</td>
                  <td style={styles.td}>
                    <button style={styles.linkButton} onClick={() => openDetail(e.id)}>Review</button>
                    <button style={styles.dangerLinkButton} onClick={() => handleDeleteEnquiry(e.id)}>
                      Delete
                    </button>
                  </td>
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
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 20, margin: 0, color: 'var(--color-ink)' },
  errorBanner: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-danger)' },
  infoBanner: { background: 'var(--color-accent-soft)', color: 'var(--color-accent)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-accent)' },
  detailHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  dangerLinkButton: { background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', fontSize: 12.5, padding: 0, marginLeft: 10, fontFamily: 'var(--font-sans)' },
  sectionHeaderRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  suggestionRow: { marginTop: 4, fontSize: 12, color: 'var(--color-accent)', background: 'var(--color-accent-soft)', padding: '4px 8px', borderRadius: 3 },
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '1px solid var(--color-line-strong)', padding: '10px 10px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, background: 'var(--color-paper)' },
  tr: { borderBottom: '1px solid var(--color-line)' },
  td: { padding: '10px 10px' },
  missingPrice: { color: 'var(--color-warning)', background: 'var(--color-warning-soft)', padding: '3px 8px', borderRadius: 2, fontSize: 10.5, fontFamily: 'var(--font-mono)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' },
  formCard: { border: '1px solid var(--color-line)', borderRadius: 5, padding: 18, marginBottom: 16, background: 'var(--color-surface)' },
  modeToggle: { display: 'flex', gap: 4, marginBottom: 12 },
  modeButton: { background: 'var(--color-surface)', border: '1px solid var(--color-line-strong)', padding: '6px 12px', borderRadius: 3, cursor: 'pointer', fontSize: 12.5, color: 'var(--color-ink-soft)', fontFamily: 'var(--font-sans)' },
  modeButtonActive: { background: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '6px 12px', borderRadius: 3, cursor: 'pointer', fontSize: 12.5, color: 'white', fontFamily: 'var(--font-sans)' },
  fileInput: { display: 'block', marginBottom: 4 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 },
  formActions: { display: 'flex', gap: 8, marginTop: 8 },
  input: { padding: 8, fontSize: 13 },
  textarea: { width: '100%', padding: 8, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit' },
  cellInput: { padding: 5, fontSize: 12.5, width: '100%', boxSizing: 'border-box' },
  convertSelect: { padding: 3, fontSize: 11, width: '100%', marginTop: 2, color: 'var(--color-ink-soft)' },
  primaryButton: { background: 'var(--color-rust)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500 },
  secondaryButton: { background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)' },
  linkButton: { background: 'none', border: 'none', color: 'var(--color-accent)', cursor: 'pointer', fontSize: 12.5, padding: 0, fontFamily: 'var(--font-sans)' },
  bulkBar: { display: 'flex', alignItems: 'center', gap: 10, background: 'var(--color-accent-soft)', border: '1px solid var(--color-accent)', borderRadius: 3, padding: '8px 12px', marginBottom: 12, fontSize: 13 },
  secondaryButtonSmall: { background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '5px 10px', borderRadius: 3, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-sans)' },
  dangerButtonSmall: { background: 'var(--color-surface)', color: 'var(--color-danger)', border: '1px solid var(--color-danger)', padding: '5px 10px', borderRadius: 3, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-sans)' },
  rawText: { background: 'var(--color-paper)', padding: 12, borderRadius: 3, whiteSpace: 'pre-wrap', fontSize: 12.5, fontFamily: 'var(--font-mono)', border: '1px solid var(--color-line)' },
}
