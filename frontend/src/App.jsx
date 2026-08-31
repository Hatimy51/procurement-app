import { useState } from 'react'
import {
  Inbox as InboxIcon, Package, Truck, History, FileText, Upload, ClipboardList,
  PackageCheck, Receipt, TrendingUp, ShoppingCart, ChevronDown, ChevronRight, FileQuestion, Mail,
} from 'lucide-react'
import ProductPriceList from './ProductPriceList'
import EnquiryReview from './EnquiryReview'
import Import from './Import'
import Suppliers from './Suppliers'
import Quotations from './Quotations'
import QuoteHistory from './QuoteHistory'
import CustomerQuotes from './CustomerQuotes'
import PurchaseOrders from './PurchaseOrders'
import DeliveryChallans from './DeliveryChallans'
import Invoices from './Invoices'
import Inbox from './Inbox'

// Two kinds of sidebar entries:
//  - { type: 'item' }  a standalone screen
//  - { type: 'group' } a Zoho-style collapsible category holding several
//    related screens (Sales: the customer-facing cycle; Purchases: the
//    supplier-facing cycle)
const NAV = [
  { type: 'item', key: 'inbox', label: 'Inbox', icon: Mail, component: Inbox },
  { type: 'item', key: 'enquiries', label: 'Enquiries', icon: InboxIcon, component: EnquiryReview },
  { type: 'item', key: 'products', label: 'Product & Price List', icon: Package, component: ProductPriceList },
  {
    type: 'group', key: 'sales', label: 'Sales', icon: TrendingUp,
    items: [
      { key: 'customer-quotes', label: 'Customer Quotes', icon: FileText, component: CustomerQuotes },
      { key: 'delivery-challans', label: 'Delivery Challans', icon: PackageCheck, component: DeliveryChallans },
      { key: 'invoices', label: 'Invoices', icon: Receipt, component: Invoices },
    ],
  },
  {
    type: 'group', key: 'purchases', label: 'Purchases', icon: ShoppingCart,
    items: [
      { key: 'suppliers', label: 'Suppliers', icon: Truck, component: Suppliers },
      { key: 'quotations', label: 'Quotations', icon: FileQuestion, component: Quotations },
      { key: 'supplier-quotes', label: 'Quote History', icon: History, component: QuoteHistory },
      { key: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList, component: PurchaseOrders },
    ],
  },
  { type: 'item', key: 'import', label: 'Import', icon: Upload, component: Import },
]

// Flat lookup of every screen, regardless of group nesting — used to find
// the active component and its label without caring how it's grouped.
const FLAT = NAV.flatMap((entry) => (entry.type === 'group' ? entry.items : [entry]))

export default function App() {
  const [active, setActive] = useState('enquiries')
  const [expanded, setExpanded] = useState({ sales: true, purchases: true })

  const activeEntry = FLAT.find((t) => t.key === active)
  const ActiveComponent = activeEntry.component

  function toggleGroup(key) {
    setExpanded((e) => ({ ...e, [key]: !e[key] }))
  }

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar} className="no-print">
        <div style={styles.brandRow}>
          <div style={styles.mark}>PA</div>
          <div style={styles.brandTitle}>Procurement<br />Automation</div>
        </div>
        <nav style={styles.nav}>
          {NAV.map((entry) => {
            if (entry.type === 'item') {
              const Icon = entry.icon
              const isActive = active === entry.key
              return (
                <button
                  key={entry.key}
                  onClick={() => setActive(entry.key)}
                  style={isActive ? styles.navItemActive : styles.navItem}
                >
                  <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                  <span>{entry.label}</span>
                </button>
              )
            }

            // Collapsible category
            const GroupIcon = entry.icon
            const isOpen = !!expanded[entry.key]
            const Chevron = isOpen ? ChevronDown : ChevronRight
            return (
              <div key={entry.key}>
                <button onClick={() => toggleGroup(entry.key)} style={styles.navGroupHeader}>
                  <GroupIcon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>{entry.label}</span>
                  <Chevron size={14} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.6 }} />
                </button>
                {isOpen && (
                  <div style={styles.navGroupChildren}>
                    {entry.items.map((tab) => {
                      const Icon = tab.icon
                      const isActive = active === tab.key
                      return (
                        <button
                          key={tab.key}
                          onClick={() => setActive(tab.key)}
                          style={isActive ? styles.navSubItemActive : styles.navSubItem}
                        >
                          <Icon size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
                          <span>{tab.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>
      </aside>

      <div style={styles.contentArea}>
        <div style={styles.topbar} className="no-print">
          <span className="eyebrow" style={{ marginBottom: 0 }}>{activeEntry.label}</span>
        </div>
        <main style={styles.main}>
          <ActiveComponent />
        </main>
      </div>
    </div>
  )
}

const styles = {
  shell: { display: 'flex', minHeight: '100vh' },
  sidebar: {
    width: 224, flexShrink: 0, background: 'var(--color-ink)',
    display: 'flex', flexDirection: 'column', position: 'sticky', top: 0, height: '100vh',
  },
  brandRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '20px 18px 18px' },
  mark: {
    width: 32, height: 32, borderRadius: 3, flexShrink: 0,
    background: 'var(--color-rust)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 12.5,
  },
  brandTitle: { fontSize: 12.5, fontWeight: 600, color: '#fff', lineHeight: 1.35 },
  nav: { display: 'flex', flexDirection: 'column', gap: 1, padding: '8px 10px', overflowY: 'auto' },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
    background: 'none', border: 'none', borderLeft: '2px solid transparent',
    padding: '9px 10px', cursor: 'pointer', borderRadius: 3,
    fontSize: 13, fontFamily: 'var(--font-sans)', color: '#aab3c0',
  },
  navItemActive: {
    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
    background: 'rgba(255,255,255,0.06)', border: 'none', borderLeft: '2px solid var(--color-rust)',
    padding: '9px 10px', cursor: 'pointer', borderRadius: 3,
    fontSize: 13, fontFamily: 'var(--font-sans)', color: '#fff', fontWeight: 500,
  },
  navGroupHeader: {
    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
    background: 'none', border: 'none', padding: '9px 10px', cursor: 'pointer', borderRadius: 3,
    fontFamily: 'var(--font-sans)', color: '#e4e7eb', fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 11.5, marginTop: 6,
  },
  navGroupChildren: { display: 'flex', flexDirection: 'column', gap: 1, marginLeft: 4 },
  navSubItem: {
    display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', width: '100%',
    background: 'none', border: 'none', borderLeft: '2px solid transparent',
    padding: '8px 10px 8px 18px', cursor: 'pointer', borderRadius: 3,
    fontSize: 12.5, fontFamily: 'var(--font-sans)', color: '#aab3c0',
  },
  navSubItemActive: {
    display: 'flex', alignItems: 'center', gap: 9, textAlign: 'left', width: '100%',
    background: 'rgba(255,255,255,0.06)', border: 'none', borderLeft: '2px solid var(--color-rust)',
    padding: '8px 10px 8px 18px', cursor: 'pointer', borderRadius: 3,
    fontSize: 12.5, fontFamily: 'var(--font-sans)', color: '#fff', fontWeight: 500,
  },
  contentArea: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: {
    background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)',
    padding: '12px 28px',
  },
  main: { flex: 1, padding: '24px 28px', maxWidth: 1100 },
}
