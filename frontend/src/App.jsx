import { useState } from 'react'
import ProductPriceList from './ProductPriceList'
import EnquiryReview from './EnquiryReview'

const TABS = [
  { key: 'enquiries', label: 'Enquiries', component: EnquiryReview },
  { key: 'products', label: 'Product & Price List', component: ProductPriceList },
]

export default function App() {
  const [active, setActive] = useState('enquiries')
  const ActiveComponent = TABS.find((t) => t.key === active).component

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1000, margin: '0 auto', padding: 24 }}>
      <nav style={styles.nav}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            style={active === tab.key ? styles.tabActive : styles.tab}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <ActiveComponent />
    </div>
  )
}

const styles = {
  nav: { display: 'flex', gap: 4, marginBottom: 20, borderBottom: '1px solid #eee' },
  tab: {
    background: 'none', border: 'none', padding: '10px 16px', cursor: 'pointer',
    fontSize: 14, color: '#666', borderBottom: '2px solid transparent',
  },
  tabActive: {
    background: 'none', border: 'none', padding: '10px 16px', cursor: 'pointer',
    fontSize: 14, color: '#2563eb', fontWeight: 600, borderBottom: '2px solid #2563eb',
  },
}
