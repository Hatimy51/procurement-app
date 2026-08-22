import { useState } from 'react'
import { api } from './api'

const TARGET_FIELDS = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'spec', label: 'Spec', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'cost_price', label: 'Cost Price', required: false },
  { key: 'selling_price', label: 'Selling Price', required: false },
]

export default function Import() {
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [mapping, setMapping] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  async function handleFileSelect(e) {
    const selected = e.target.files?.[0]
    if (!selected) return
    setFile(selected)
    setResult(null)
    setError(null)
    setLoading(true)
    try {
      const data = await api.importPreview(selected)
      setPreview(data)
      // best-effort auto-guess: if a header matches a target field name closely, pre-select it
      const guessed = {}
      TARGET_FIELDS.forEach(({ key, label }) => {
        const match = data.headers.find(
          (h) => h.toLowerCase().replace(/[^a-z]/g, '') === label.toLowerCase().replace(/[^a-z]/g, '')
        )
        if (match) guessed[key] = match
      })
      setMapping(guessed)
    } catch (e) {
      setError(e.message)
      setPreview(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleCommit() {
    if (!mapping.name) {
      setError("You must map a column to 'Product Name' at minimum.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      const data = await api.importCommit(file, mapping)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function reset() {
    setFile(null)
    setPreview(null)
    setMapping({})
    setResult(null)
    setError(null)
  }

  return (
    <div>
      <h1 style={styles.title}>Import Products & Prices</h1>
      <p style={styles.muted}>
        For bringing in an existing product/price list — from an ERP export, Excel, or CSV —
        instead of starting empty. Matches against products by name, so re-importing an
        updated file won't create duplicates, it adds fresh price history instead.
      </p>

      {error && <div style={styles.errorBanner}>{error}</div>}

      {!preview && (
        <div style={styles.uploadBox}>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFileSelect} />
          {loading && <p style={styles.muted}>Reading file…</p>}
        </div>
      )}

      {preview && !result && (
        <div>
          <p style={styles.muted}>
            Found {preview.total_rows} row{preview.total_rows === 1 ? '' : 's'} with{' '}
            {preview.headers.length} column{preview.headers.length === 1 ? '' : 's'}. Map each
            field below to the matching column from your file (or leave as "— skip —").
          </p>

          <table style={styles.mappingTable}>
            <thead>
              <tr>
                <th style={styles.th}>Our field</th>
                <th style={styles.th}>Your column</th>
              </tr>
            </thead>
            <tbody>
              {TARGET_FIELDS.map(({ key, label, required }) => (
                <tr key={key} style={styles.tr}>
                  <td style={styles.td}>
                    {label}
                    {required && <span style={styles.requiredMark}> *</span>}
                  </td>
                  <td style={styles.td}>
                    <select
                      style={styles.select}
                      value={mapping[key] || ''}
                      onChange={(e) => setMapping({ ...mapping, [key]: e.target.value || undefined })}
                    >
                      <option value="">— skip —</option>
                      {preview.headers.map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 style={{ marginTop: 20 }}>Preview (first {preview.sample_rows.length} rows)</h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={styles.previewTable}>
              <thead>
                <tr>
                  {preview.headers.map((h) => <th key={h} style={styles.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.sample_rows.map((row, i) => (
                  <tr key={i} style={styles.tr}>
                    {row.map((cell, j) => <td key={j} style={styles.td}>{cell || '—'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={styles.formActions}>
            <button style={styles.primaryButton} onClick={handleCommit} disabled={loading}>
              {loading ? 'Importing…' : `Import all ${preview.total_rows} rows`}
            </button>
            <button style={styles.secondaryButton} onClick={reset}>Cancel</button>
          </div>
        </div>
      )}

      {result && (
        <div>
          <div style={styles.resultCard}>
            <h3 style={{ marginTop: 0 }}>Import complete</h3>
            <ul style={styles.resultList}>
              <li>{result.rows_processed} rows processed</li>
              <li>{result.products_created} new products created</li>
              <li>{result.products_matched} existing products matched (updated with a new price entry)</li>
              <li>{result.price_entries_created} price entries added</li>
              {result.rows_skipped > 0 && (
                <li style={styles.warningText}>
                  {result.rows_skipped} row(s) skipped
                  {result.skipped_reason_sample.length > 0 && (
                    <ul>
                      {result.skipped_reason_sample.map((r, i) => <li key={i}>{r}</li>)}
                    </ul>
                  )}
                </li>
              )}
            </ul>
          </div>
          <button style={styles.primaryButton} onClick={reset}>Import another file</button>
        </div>
      )}
    </div>
  )
}

const styles = {
  title: { fontSize: 22, margin: '0 0 4px 0' },
  muted: { color: '#888', fontSize: 13 },
  errorBanner: { background: '#fdecea', color: '#611a15', padding: 10, borderRadius: 6, marginBottom: 12 },
  uploadBox: { border: '2px dashed #ccc', borderRadius: 8, padding: 30, textAlign: 'center', marginTop: 16 },
  mappingTable: { width: '100%', borderCollapse: 'collapse', fontSize: 14, marginTop: 12, maxWidth: 500 },
  previewTable: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', borderBottom: '2px solid #ddd', padding: '8px 6px', color: '#555' },
  tr: { borderBottom: '1px solid #eee' },
  td: { padding: '8px 6px' },
  select: { padding: 6, border: '1px solid #ccc', borderRadius: 6, fontSize: 13, width: '100%' },
  requiredMark: { color: '#b45309' },
  formActions: { display: 'flex', gap: 8, marginTop: 16 },
  primaryButton: { background: '#2563eb', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  secondaryButton: { background: 'white', color: '#333', border: '1px solid #ccc', padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 14 },
  resultCard: { border: '1px solid #ddd', borderRadius: 8, padding: 16, marginBottom: 16, background: '#f0fdf4' },
  resultList: { paddingLeft: 20, fontSize: 14 },
  warningText: { color: '#b45309' },
}
