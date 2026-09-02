import { useEffect, useState } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

export default function Dashboard() {
  const [metrics, setMetrics] = useState({
    total_pos_issued: 0,
    total_invoices_processed: 0,
    total_active_suppliers: 0,
    auto_match_rate_percentage: '0%',
    open_po_value: 0,
    estimated_time_saved_hours: 0,
    matched_invoices: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getDashboardMetrics()
      if (data?.kpis) setMetrics(data.kpis)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  if (loading) return <div className="p-6" style={{ color: 'var(--color-muted)' }}>Loading Dashboard Metrics…</div>

  return (
    <div>
      <PageHeader
        eyebrow="Executive"
        title="Procurement Dashboard"
        description="Live operating metrics across purchase orders, suppliers and invoice matching."
        action={<button className="btn btn-secondary" onClick={load}>Refresh</button>}
      />

      {error && <div className="banner banner-error">{error}</div>}

      <div style={styles.grid}>
        <div className="card" style={styles.card}>
          <p className="eyebrow">3-Way Match Rate</p>
          <p style={styles.value}>{metrics.auto_match_rate_percentage}</p>
          <p style={styles.help}>{metrics.matched_invoices} invoices currently match dispatch/price checks.</p>
        </div>

        <div className="card" style={styles.card}>
          <p className="eyebrow">Estimated Hours Saved</p>
          <p style={styles.value}>{metrics.estimated_time_saved_hours} hrs</p>
          <p style={styles.help}>Based on ~27 minutes saved per processed invoice.</p>
        </div>

        <div className="card" style={styles.card}>
          <p className="eyebrow">Purchase Orders</p>
          <p style={styles.value}>{metrics.total_pos_issued}</p>
          <p style={styles.help}>PO records currently in the system.</p>
        </div>

        <div className="card" style={styles.card}>
          <p className="eyebrow">Open PO Value</p>
          <p style={styles.value}>{money(metrics.open_po_value)}</p>
          <p style={styles.help}>Value of POs already sent and still open.</p>
        </div>
      </div>

      <div style={styles.twoCol}>
        <div className="card" style={styles.panel}>
          <h3 style={styles.heading}>Core Operational Health</h3>
          <div style={styles.row}><span>Total Invoices Processed</span><strong>{metrics.total_invoices_processed}</strong></div>
          <div style={styles.row}><span>Active Suppliers</span><strong>{metrics.total_active_suppliers}</strong></div>
          <div style={styles.row}><span>System Processing Status</span><span className="stamp stamp-success">Healthy</span></div>
        </div>

        <div className="card" style={styles.panel}>
          <h3 style={styles.heading}>What to Do Next</h3>
          <p style={styles.body}>Use Quote Comparison to identify a lowest-cost supplier or split award.</p>
          <p style={styles.body}>Use a sent PO's “Create GRN / Delivery Challan” action to pre-fill warehouse receipt lines.</p>
        </div>
      </div>
    </div>
  )
}

const styles = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 14, marginBottom: 18 },
  twoCol: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  card: { padding: 18 },
  panel: { padding: 18 },
  value: { margin: '8px 0 4px', fontSize: 30, fontWeight: 700, color: 'var(--color-ink)', fontFamily: 'var(--font-mono)' },
  help: { margin: 0, fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.45 },
  heading: { marginTop: 0, marginBottom: 14, fontSize: 16 },
  row: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--color-line)', fontSize: 13 },
  body: { fontSize: 13, color: 'var(--color-muted)', lineHeight: 1.5 },
}
