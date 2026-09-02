import { useState } from 'react'
import { Truck, Package, Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronUp, FileText, X } from 'lucide-react'

const BASE = '/api/vendor-portal'

const s = {
  page: { minHeight: '100vh', background: '#f0f4ff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', padding: '40px 16px', fontFamily: 'system-ui, sans-serif' },
  loginCard: { background: '#fff', borderRadius: 16, padding: 36, width: '100%', maxWidth: 420, boxShadow: '0 10px 40px rgba(0,0,0,0.1)' },
  logo: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 },
  logoIcon: { background: '#3b5bdb', borderRadius: 10, padding: 10, color: '#fff' },
  title: { fontSize: 20, fontWeight: 700, color: '#1e2330' },
  sub: { fontSize: 13, color: '#6b7280', marginBottom: 24, lineHeight: 1.6 },
  label: { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6, display: 'block' },
  input: { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', marginBottom: 16 },
  btn: { width: '100%', padding: '11px', background: '#3b5bdb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 15 },
  error: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 13, marginBottom: 16 },
  container: { width: '100%', maxWidth: 860 },
  header: { background: '#fff', borderRadius: 12, padding: '20px 24px', marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
  card: { background: '#fff', borderRadius: 12, border: '1px solid #e8ebf0', marginBottom: 14, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
  cardHead: { padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', borderBottom: '1px solid #f3f4f6' },
  cardBody: { padding: '16px 20px' },
  bar: { display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid #e5e7eb', width: '100%', marginBottom: 16 },
  step: { flex: 1, padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, borderRight: '1px solid #e5e7eb' },
  badge: { fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 },
  uploadBox: { border: '2px dashed #c7d2fe', borderRadius: 10, padding: '20px', textAlign: 'center', cursor: 'pointer', background: '#f8faff' },
  docRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8faff', border: '1px solid #e0e7ff', borderRadius: 8, marginBottom: 6 },
  select: { padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 10, width: '100%' },
  btnSm: { padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700 },
}

function LifecycleBar({ lifecycle }) {
  const steps = [
    { label: 'PO Sent', done: lifecycle.po_sent },
    { label: `Received ${lifecycle.receipt_pct}%`, done: lifecycle.receipt_pct >= 100 },
    { label: 'Invoice Uploaded', done: lifecycle.invoice_uploaded },
    { label: lifecycle.payment_status === 'paid' ? 'Paid ✓' : `Payment: ${lifecycle.payment_status}`, done: lifecycle.payment_status === 'paid' },
  ]
  return (
    <div style={s.bar}>
      {steps.map((st, i) => (
        <div key={i} style={{
          ...s.step,
          background: st.done ? '#dcfce7' : '#f9fafb',
          color: st.done ? '#15803d' : '#6b7280',
          borderRight: i < 3 ? '1px solid #e5e7eb' : 'none',
        }}>
          {st.done ? '✓ ' : ''}{st.label}
        </div>
      ))}
    </div>
  )
}

function UploadModal({ po, vendorToken, onClose, onUploaded }) {
  const [docType, setDocType] = useState('delivery_challan')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleUpload() {
    if (!file) { setErr('Please select a file to upload.'); return }
    setLoading(true); setErr('')
    const fd = new FormData()
    fd.append('vendor_token', vendorToken)
    fd.append('po_id', po.po_id)
    fd.append('document_type', docType)
    fd.append('notes', notes)
    fd.append('file', file)
    try {
      const res = await fetch(`${BASE}/upload`, { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      onUploaded && onUploaded()
      onClose()
    } catch (ex) { setErr(ex.message) } finally { setLoading(false) }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: 28, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Upload Document</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>PO #{po.po_number}</p>
        <label style={s.label}>Document Type</label>
        <select style={s.select} value={docType} onChange={e => setDocType(e.target.value)}>
          <option value="delivery_challan">Delivery Challan</option>
          <option value="invoice">Invoice</option>
          <option value="other">Other</option>
        </select>
        <label style={s.label}>Notes (optional)</label>
        <input style={{ ...s.input, marginBottom: 12 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Invoice #INV-2024-001" />
        <label style={s.label}>Select File</label>
        <div style={s.uploadBox} onClick={() => document.getElementById('vp-file').click()}>
          <Upload size={24} style={{ marginBottom: 8, color: '#6366f1' }} />
          <div style={{ fontSize: 13, color: '#6b7280' }}>{file ? file.name : 'Click to select PDF, Excel, or Image'}</div>
          <input id="vp-file" type="file" style={{ display: 'none' }} accept=".pdf,.xlsx,.xls,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files[0])} />
        </div>
        {err && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={{ ...s.btnSm, background: '#3b5bdb', color: '#fff', flex: 1, padding: '10px' }} onClick={handleUpload} disabled={loading}>
            {loading ? 'Uploading…' : 'Upload'}
          </button>
          <button style={{ ...s.btnSm, background: '#f3f4f6', color: '#374151' }} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

function POCard({ order, vendorToken, onRefresh }) {
  const [open, setOpen] = useState(false)
  const [showUpload, setShowUpload] = useState(false)

  return (
    <div style={s.card}>
      <div style={s.cardHead} onClick={() => setOpen(o => !o)}>
        <div>
          <span style={{ fontWeight: 700, fontSize: 15 }}>PO #{order.po_number}</span>
          {order.store_location && (
            <span style={{ marginLeft: 10, ...s.badge, background: '#ede9fe', color: '#7c3aed' }}>{order.store_location}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ ...s.badge, background: order.lifecycle.po_sent ? '#dbeafe' : '#f3f4f6', color: order.lifecycle.po_sent ? '#1d4ed8' : '#6b7280' }}>
            {order.status}
          </span>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </div>

      {open && (
        <div style={s.cardBody}>
          <LifecycleBar lifecycle={order.lifecycle} />

          {/* Documents already uploaded */}
          {(order.documents.challans.length > 0 || order.documents.invoices.length > 0) && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Your Uploads</div>
              {[...order.documents.challans, ...order.documents.invoices].map(d => (
                <div key={d.id} style={s.docRow}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={13} color="#6366f1" />
                    <span style={{ fontSize: 13 }}>{d.file_name}</span>
                  </div>
                  <a href={`/api/vendor-portal/download/${d.id}`} download style={{ fontSize: 12, color: '#3b5bdb', textDecoration: 'none', fontWeight: 600 }}>Download</a>
                </div>
              ))}
            </div>
          )}

          {/* Line items */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Line Items</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '6px 8px', background: '#f9fafb', fontWeight: 600, color: '#374151' }}>Item</th>
                  <th style={{ textAlign: 'right', padding: '6px 8px', background: '#f9fafb', fontWeight: 600, color: '#374151' }}>Qty</th>
                  <th style={{ textAlign: 'left', padding: '6px 8px', background: '#f9fafb', fontWeight: 600, color: '#374151' }}>Unit</th>
                </tr>
              </thead>
              <tbody>
                {order.line_items.map((li, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '6px 8px' }}>{li.description}{li.spec ? ` — ${li.spec}` : ''}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{li.quantity}</td>
                    <td style={{ padding: '6px 8px' }}>{li.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button style={{ ...s.btnSm, background: '#3b5bdb', color: '#fff', padding: '8px 16px' }} onClick={() => setShowUpload(true)}>
            <Upload size={13} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Upload Challan / Invoice
          </button>
        </div>
      )}

      {showUpload && (
        <UploadModal
          po={order}
          vendorToken={vendorToken}
          onClose={() => setShowUpload(false)}
          onUploaded={onRefresh}
        />
      )}
    </div>
  )
}

export default function VendorPortal() {
  const [identifier, setIdentifier] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [session, setSession] = useState(null)   // { vendor_token, supplier_name }
  const [ordersData, setOrdersData] = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setErr('')
    try {
      const res = await fetch(`${BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: identifier.trim() }),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = text
        try { msg = JSON.parse(text).detail || text } catch {}
        throw new Error(msg)
      }
      const data = await res.json()
      setSession(data)
      await loadOrders(data.vendor_token)
    } catch (ex) { setErr(ex.message) } finally { setLoading(false) }
  }

  async function loadOrders(token) {
    const res = await fetch(`${BASE}/orders?vendor_token=${encodeURIComponent(token)}`)
    if (!res.ok) throw new Error(await res.text())
    setOrdersData(await res.json())
  }

  function handleRefresh() {
    if (session) loadOrders(session.vendor_token).catch(console.error)
  }

  if (!session) {
    return (
      <div style={s.page}>
        <div style={s.loginCard}>
          <div style={s.logo}>
            <div style={s.logoIcon}><Truck size={22} /></div>
            <div>
              <div style={s.title}>Vendor Portal</div>
              <div style={{ fontSize: 12, color: '#9ca3af' }}>Self-service order & document centre</div>
            </div>
          </div>
          <p style={s.sub}>
            Enter your registered <strong>email address</strong> or <strong>GST number</strong> to view your purchase orders, track delivery status, and upload delivery challans & invoices.
          </p>
          {err && <div style={s.error}>{err}</div>}
          <form onSubmit={handleLogin}>
            <label style={s.label}>Email or GST Number</label>
            <input
              style={s.input}
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              placeholder="yourname@company.com or 27ABCDE1234F1Z5"
              autoFocus
            />
            <button style={s.btn} type="submit" disabled={loading}>
              {loading ? 'Checking…' : 'Access My Orders →'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={s.page}>
      <div style={s.container}>
        <div style={s.header}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Welcome, {ordersData?.supplier_name || session.supplier_name}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{ordersData?.orders?.length || 0} purchase order(s)</div>
          </div>
          <button onClick={() => { setSession(null); setOrdersData(null) }} style={{ ...s.btnSm, background: '#f3f4f6', color: '#374151' }}>
            Log Out
          </button>
        </div>

        {!ordersData || ordersData.orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, background: '#fff', borderRadius: 12 }}>
            <Package size={40} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ color: '#9ca3af' }}>No purchase orders found for your account.</div>
          </div>
        ) : (
          ordersData.orders.map(order => (
            <POCard key={order.po_id} order={order} vendorToken={session.vendor_token} onRefresh={handleRefresh} />
          ))
        )}
      </div>
    </div>
  )
}
