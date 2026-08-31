import { useState } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const TARGET_FIELDS = [
  { key: 'name', label: 'Product Name', required: true },
  { key: 'category', label: 'Category', required: false },
  { key: 'spec', label: 'Spec', required: false },
  { key: 'unit', label: 'Unit', required: false },
  { key: 'cost_price', label: 'Cost Price', required: false },
  { key: 'selling_price', label: 'Selling Price', required: false },
  { key: 'gst_percent', label: 'GST %', required: false },
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
      <PageHeader
        eyebrow="Onboarding"
        title="Import Products & Prices"
        description="Bring in an existing product/price list — from an ERP export, Excel, or CSV — instead of starting empty. Matches by name, so re-importing an updated file adds fresh price history instead of creating duplicates."
      />

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
  title: { fontSize: 20, margin: '0 0 4px 0', color: 'var(--color-ink)' },
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  errorBanner: { background: 'var(--color-danger-soft)', color: 'var(--color-danger)', padding: '10px 14px', borderRadius: 3, marginBottom: 12, fontSize: 13, borderLeft: '3px solid var(--color-danger)' },
  uploadBox: { border: '2px dashed var(--color-line-strong)', borderRadius: 5, padding: 32, textAlign: 'center', marginTop: 16, background: 'var(--color-surface)' },
  mappingTable: { width: '100%', borderCollapse: 'collapse', fontSize: 13, marginTop: 12, maxWidth: 500 },
  previewTable: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', borderBottom: '1px solid var(--color-line-strong)', padding: '10px 10px', color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 500, background: 'var(--color-paper)' },
  tr: { borderBottom: '1px solid var(--color-line)' },
  td: { padding: '10px 10px' },
  select: { padding: 7, fontSize: 12.5, width: '100%' },
  requiredMark: { color: 'var(--color-warning)' },
  formActions: { display: 'flex', gap: 8, marginTop: 16 },
  primaryButton: { background: 'var(--color-rust)', color: 'white', border: 'none', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)', fontWeight: 500 },
  secondaryButton: { background: 'var(--color-surface)', color: 'var(--color-accent)', border: '1px solid var(--color-accent)', padding: '8px 14px', borderRadius: 3, cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-sans)' },
  resultCard: { border: '1px solid var(--color-success)', borderRadius: 5, padding: 18, marginBottom: 16, background: 'var(--color-success-soft)' },
  resultList: { paddingLeft: 20, fontSize: 13 },
  warningText: { color: 'var(--color-warning)' },
}
