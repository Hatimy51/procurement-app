import { useState, useEffect, useRef } from 'react'
import { PackageCheck, FileText, Download, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, Printer } from 'lucide-react'

const BASE = '/api'

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    credentials: 'include',
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text)
  }
  return res.json()
}

const s = {
  page: { padding: 24, maxWidth: 960, margin: '0 auto' },
  title: { fontSize: 22, fontWeight: 700, color: '#1e2330', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#6b7280', marginBottom: 24 },
  card: { background: '#fff', borderRadius: 12, border: '1px solid #e8ebf0', marginBottom: 16, overflow: 'hidden' },
  cardHead: { padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f9fafb', borderBottom: '1px solid #e8ebf0', cursor: 'pointer' },
  cardBody: { padding: '16px 20px' },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#3b5bdb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnSm: { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, background: '#fff' },
  btnGreen: { background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 14 },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '8px 10px', background: '#f3f4f6', fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' },
  input: { width: 90, padding: '6px 8px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, textAlign: 'right' },
  badge: { fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 },
  docRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8faff', border: '1px solid #e0e7ff', borderRadius: 8, marginBottom: 6 },
  error: { color: '#ef4444', fontSize: 13, marginTop: 8 },
}

function DownloadButton({ href, label }) {
  return (
    <a href={href} download style={{ ...s.btnSm, color: '#374151', textDecoration: 'none' }}>
      <Download size={12} /> {label}
    </a>
  )
}

function GRNCard({ po, onConfirmed }) {
  const [open, setOpen] = useState(false)
  const [lines, setLines] = useState([])
  const [challans, setChallans] = useState([])
  const [quantities, setQuantities] = useState({})
  const [loadingLines, setLoadingLines] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [grnResult, setGrnResult] = useState(null)
  const [err, setErr] = useState('')

  async function loadDetails() {
    if (open) { setOpen(false); return }
    setOpen(true)
    if (lines.length > 0) return
    setLoadingLines(true)
    try {
      const [lineData, challanData] = await Promise.all([
        apiFetch(`/grns/po/${po.id}/lines`),
        apiFetch(`/grns/po/${po.id}/challans`),
      ])
      setLines(lineData)
      setChallans(challanData)
      // Pre-fill: default received = quantity_remaining (full PO amount on first GRN)
      const prefill = {}
      lineData.forEach(l => {
        prefill[l.po_line_item_id] = parseFloat(l.quantity_remaining)
      })
      setQuantities(prefill)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setLoadingLines(false)
    }
  }

  async function confirmReceipt() {
    setConfirming(true)
    setErr('')
    const items = lines
      .filter(l => (quantities[l.po_line_item_id] || 0) > 0)
      .map(l => ({
        po_line_item_id: l.po_line_item_id,
        description: l.description,
        spec: l.spec,
        unit: l.unit,
        quantity_received: parseFloat(quantities[l.po_line_item_id] || 0),
      }))
    if (items.length === 0) { setErr('Enter at least one received quantity.'); setConfirming(false); return }
    try {
      const result = await apiFetch('/grns', {
        method: 'POST',
        body: JSON.stringify({ po_id: po.id, items }),
      })
      // Mark received immediately
      const received = await apiFetch(`/grns/${result.id}/mark-received`, { method: 'POST' })
      setGrnResult(received)
      setConfirmed(true)
      onConfirmed && onConfirmed(po.id)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setConfirming(false)
    }
  }

  function printGRN() {
    const win = window.open('', '_blank')
    win.document.write(`<html><head><title>GRN ${grnResult?.grn_number}</title></head><body>
      <h2>Goods Receipt Note</h2>
      <p><b>GRN #:</b> ${grnResult?.grn_number}</p>
      <p><b>PO #:</b> ${po.po_number}</p>
      <p><b>Supplier:</b> ${po.supplier_name}</p>
      <p><b>Store:</b> ${po.store_location || '—'}</p>
      <p><b>Date:</b> ${new Date().toLocaleDateString('en-IN')}</p>
      <table border="1" style="width:100%;border-collapse:collapse">
        <tr><th>Item</th><th>Spec</th><th>Unit</th><th>Qty Received</th></tr>
        ${(grnResult?.items || []).map(i => `<tr><td>${i.description}</td><td>${i.spec || ''}</td><td>${i.unit}</td><td>${i.quantity_received}</td></tr>`).join('')}
      </table>
    </body></html>`)
    win.document.close()
    win.print()
  }

  return (
    <div style={s.card}>
      <div style={s.cardHead} onClick={loadDetails}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {confirmed
            ? <CheckCircle2 size={18} color="#16a34a" />
            : <PackageCheck size={18} color="#6366f1" />}
          <div>
            <span style={{ fontWeight: 700, fontSize: 14 }}>PO #{po.po_number}</span>
            <span style={{ marginLeft: 10, fontSize: 12, color: '#6b7280' }}>{po.supplier_name}</span>
            {po.store_location && (
              <span style={{ marginLeft: 8, ...s.badge, background: '#ede9fe', color: '#7c3aed' }}>{po.store_location}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {confirmed && <span style={{ ...s.badge, background: '#dcfce7', color: '#16a34a' }}>✓ Received</span>}
          {!confirmed && (
            <span style={{ ...s.badge, background: '#fef9c3', color: '#854d0e' }}>{po.lines_remaining} line{po.lines_remaining !== 1 ? 's' : ''} pending</span>
          )}
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {open && (
        <div style={s.cardBody}>
          {/* Document action bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <DownloadButton href={`/api/purchase-orders/${po.id}/pdf`} label="Download PO" />
            {challans.length > 0 && challans.map(c => (
              <a key={c.id} href={c.download_url} download style={{ ...s.btnSm, color: '#374151', textDecoration: 'none' }}>
                <Download size={12} /> DC: {c.file_name}
              </a>
            ))}
            {confirmed && grnResult && (
              <button style={s.btnSm} onClick={printGRN}>
                <Printer size={12} /> Print GRN
              </button>
            )}
          </div>

          {loadingLines && <div style={{ color: '#9ca3af', fontSize: 13 }}>Loading…</div>}

          {/* Delivery Challans */}
          {challans.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionTitle}>Vendor Delivery Challans</div>
              {challans.map(c => (
                <div key={c.id} style={s.docRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={14} color="#6366f1" />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{c.file_name}</span>
                    {c.notes && <span style={{ fontSize: 12, color: '#6b7280' }}>— {c.notes}</span>}
                  </div>
                  <DownloadButton href={c.download_url} label="View / Download" />
                </div>
              ))}
            </div>
          )}

          {challans.length === 0 && !loadingLines && (
            <div style={{ ...s.section, color: '#9ca3af', fontSize: 13, fontStyle: 'italic' }}>
              No vendor delivery challan uploaded yet.
            </div>
          )}

          {/* Line items */}
          {!confirmed && lines.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionTitle}>Confirm Received Quantities</div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Item</th>
                    <th style={s.th}>Spec</th>
                    <th style={s.th}>Unit</th>
                    <th style={s.th} align="right">PO Qty</th>
                    <th style={s.th} align="right">Already Received</th>
                    <th style={s.th} align="right">Receiving Now</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.po_line_item_id}>
                      <td style={s.td}>{l.description}</td>
                      <td style={s.td}>{l.spec || '—'}</td>
                      <td style={s.td}>{l.unit}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>{parseFloat(l.quantity_ordered)}</td>
                      <td style={{ ...s.td, textAlign: 'right', color: '#6b7280' }}>{parseFloat(l.quantity_already_received)}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>
                        <input
                          style={s.input}
                          type="number"
                          min={0}
                          max={parseFloat(l.quantity_remaining)}
                          step="0.01"
                          value={quantities[l.po_line_item_id] ?? parseFloat(l.quantity_remaining)}
                          onChange={e => setQuantities(q => ({ ...q, [l.po_line_item_id]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {err && <div style={s.error}>{err}</div>}

              <div style={{ marginTop: 16 }}>
                <button style={s.btnGreen} onClick={confirmReceipt} disabled={confirming}>
                  {confirming ? 'Confirming…' : '✓ Confirm Receipt'}
                </button>
              </div>
            </div>
          )}

          {/* Confirmed GRN summary */}
          {confirmed && grnResult && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <CheckCircle2 size={18} color="#16a34a" />
                <span style={{ fontWeight: 700, color: '#16a34a' }}>GRN #{grnResult.grn_number} created & confirmed</span>
              </div>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Item</th>
                    <th style={s.th} align="right">Qty Received</th>
                  </tr>
                </thead>
                <tbody>
                  {(grnResult.items || []).map(i => (
                    <tr key={i.id}>
                      <td style={s.td}>{i.description}</td>
                      <td style={{ ...s.td, textAlign: 'right', fontWeight: 600 }}>{parseFloat(i.quantity_received)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function GoodsReceipt() {
  const [pos, setPos] = useState([])
  const [search, setSearch] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  function load() {
    setLoading(true)
    apiFetch('/grns/ready-pos')
      .then(setPos)
      .catch(ex => setErr(ex.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading receiving queue…</div>
  if (err) return <div style={{ padding: 40, color: '#ef4444' }}>{err}</div>

  const q = search.trim().toLowerCase()
  const filtered = pos.filter(po => {
    if (q) {
      const matchPO = po.po_number?.toLowerCase().includes(q)
      const matchSup = po.supplier_name?.toLowerCase().includes(q)
      const matchLoc = po.store_location?.toLowerCase().includes(q)
      if (!matchPO && !matchSup && !matchLoc) return false
    }
    if (supplierFilter !== 'all' && po.supplier_name !== supplierFilter) return false
    return true
  })

  return (
    <div style={s.page}>
      <h1 style={s.title}>Goods Receiving Queue</h1>
      <p style={s.subtitle}>Review incoming deliveries, verify quantities against the PO, and confirm receipt.</p>

      {/* Search and Filters */}
      {pos.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6 }}
            placeholder="Search by PO #, supplier, or location…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, background: '#fff' }}
            value={supplierFilter}
            onChange={e => setSupplierFilter(e.target.value)}
          >
            <option value="all">All Suppliers</option>
            {[...new Set(pos.map(p => p.supplier_name).filter(Boolean))].map(sup => (
              <option key={sup} value={sup}>{sup}</option>
            ))}
          </select>
        </div>
      )}

      {pos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <PackageCheck size={48} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div>No deliveries pending for your location.</div>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
          No incoming orders match your filter criteria.
        </div>
      ) : (
        filtered.map(po => (
          <GRNCard key={po.id} po={po} onConfirmed={load} />
        ))
      )}
    </div>
  )
}

