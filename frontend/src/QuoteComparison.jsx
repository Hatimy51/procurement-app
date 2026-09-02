import { useState } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const SAMPLE = JSON.stringify({
  quotes: [
    {
      supplier_name: 'Supplier A',
      payment_terms: '30 days',
      estimated_delivery_days: 7,
      items: [
        { description: 'Cement 50kg', quantity: 100, unit_price: 390, unit_of_measure: 'bag' },
        { description: 'Steel 12mm', quantity: 50, unit_price: 62000, unit_of_measure: 'tonne' }
      ]
    },
    {
      supplier_name: 'Supplier B',
      payment_terms: '15 days',
      estimated_delivery_days: 10,
      items: [
        { description: 'Cement 50kg', quantity: 100, unit_price: 380, unit_of_measure: 'bag' },
        { description: 'Steel 12mm', quantity: 50, unit_price: 60000, unit_of_measure: 'tonne' }
      ]
    }
  ]
}, null, 2)

export default function QuoteComparison() {
  const [json, setJson] = useState(SAMPLE)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function analyze() {
    setError(null)
    setResult(null)
    let payload
    try {
      payload = JSON.parse(json)
    } catch {
      setError('The quote payload is not valid JSON.')
      return
    }

    setLoading(true)
    try {
      setResult(await api.analyzeQuoteComparison(payload))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

  return (
    <div>
      <PageHeader
        eyebrow="Purchase"
        title="Quote Comparison Engine"
        description="Compare supplier quotes, select the cheapest complete supplier, and calculate the savings from splitting the award."
        action={<button className="btn btn-primary" onClick={analyze} disabled={loading}>{loading ? 'Analyzing…' : 'Analyze Quotes'}</button>}
      />

      {error && <div className="banner banner-error">{error}</div>}

      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <label className="eyebrow">Quote payload (JSON)</label>
        <textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          spellCheck={false}
          style={{ width: '100%', minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 12, marginTop: 8 }}
        />
        <p style={{ marginBottom: 0, color: 'var(--color-muted)', fontSize: 12 }}>
          Item descriptions are normalized case-insensitively, so the same SKU/item can be matched across suppliers.
        </p>
      </div>

      {result && (
        <>
          <div style={styles.summaryGrid}>
            <div className="card" style={styles.summaryCard}>
              <p className="eyebrow">Lowest Single Vendor</p>
              <strong style={styles.big}>{result.lowest_single_vendor.supplier_name}</strong>
              <span style={styles.amount}>{money(result.lowest_single_vendor.total_cost)}</span>
            </div>
            <div className="card" style={styles.summaryCard}>
              <p className="eyebrow">Optimal Split Award</p>
              <strong style={styles.big}>{money(result.optimal_split_award.total_cost)}</strong>
              <span style={styles.amount}>Potential savings: {money(result.optimal_split_award.potential_savings)}</span>
            </div>
          </div>

          <div className="card" style={{ padding: 18, marginBottom: 18 }}>
            <h3 style={{ marginTop: 0 }}>Supplier Totals</h3>
            <table className="ledger-table">
              <thead><tr><th>Supplier</th><th>Total Cost</th></tr></thead>
              <tbody>
                {Object.entries(result.vendor_totals).map(([vendor, total]) => (
                  <tr key={vendor}><td>{vendor}</td><td className="num">{money(total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <h3 style={{ marginTop: 0 }}>Split-Award Breakdown</h3>
            <table className="ledger-table">
              <thead><tr><th>Item</th><th>Cheapest Vendor</th><th>Unit Price</th><th>Qty</th><th>Line Cost</th></tr></thead>
              <tbody>
                {result.optimal_split_award.item_breakdown.map((item) => (
                  <tr key={`${item.item_name}-${item.cheapest_vendor}`}>
                    <td>{item.item_name}</td>
                    <td>{item.cheapest_vendor}</td>
                    <td className="num">{money(item.unit_price)}</td>
                    <td className="num">{item.quantity} {item.unit_of_measure}</td>
                    <td className="num">{money(item.total_line_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  summaryGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 18 },
  summaryCard: { padding: 18, display: 'flex', flexDirection: 'column', gap: 6 },
  big: { fontSize: 22, color: 'var(--color-ink)' },
  amount: { fontSize: 13, color: 'var(--color-muted)', fontFamily: 'var(--font-mono)' },
}
