import { useState, useMemo, useEffect } from 'react'
import {
  Inbox as InboxIcon, Package, Truck, History, FileText, Upload, ClipboardList,
  PackageCheck, Receipt, TrendingUp, ShoppingCart, ChevronDown, ChevronRight,
  FileQuestion, Mail, Users as UsersIcon, LogOut,
} from 'lucide-react'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './Login'
import ProductPriceList from './ProductPriceList'
import EnquiryReview from './EnquiryReview'
import Import from './Import'
import Suppliers from './Suppliers'
import Customers from './Customers'
import Quotations from './Quotations'
import QuoteHistory from './QuoteHistory'
import CustomerQuotes from './CustomerQuotes'
import PurchaseOrders from './PurchaseOrders'
import DeliveryChallans from './DeliveryChallans'
import Invoices from './Invoices'
import Inbox from './Inbox'
import Users from './Users'

// `roles` on each leaf item lists who may even SEE it in the sidebar,
// matching the backend's require_router_access rules exactly:
//   - purchase: every screen except Invoices
//   - accounts: Invoices only
//   - manager: can view everything (oversight), but can only ever DO
//     anything on Customer Quotes' Approve action — every screen still
//     enforces that server-side regardless of what the sidebar shows.
const NAV = [
  { type: 'item', key: 'inbox', label: 'Inbox', icon: Mail, component: Inbox, roles: ['purchase', 'manager'] },
  { type: 'item', key: 'enquiries', label: 'Enquiries', icon: InboxIcon, component: EnquiryReview, roles: ['purchase', 'manager'] },
  { type: 'item', key: 'products', label: 'Product & Price List', icon: Package, component: ProductPriceList, roles: ['purchase', 'manager'] },
  {
    type: 'group', key: 'sales', label: 'Sales', icon: TrendingUp,
    items: [
      { key: 'customers', label: 'Customers', icon: UsersIcon, component: Customers, roles: ['purchase', 'manager'] },
      { key: 'customer-quotes', label: 'Customer Quotes', icon: FileText, component: CustomerQuotes, roles: ['purchase', 'manager'] },
      { key: 'delivery-challans', label: 'Delivery Challans', icon: PackageCheck, component: DeliveryChallans, roles: ['purchase', 'manager'] },
      { key: 'invoices', label: 'Invoices', icon: Receipt, component: Invoices, roles: ['accounts', 'manager'] },
    ],
  },
  {
    type: 'group', key: 'purchase', label: 'Purchase', icon: ShoppingCart,
    items: [
      { key: 'suppliers', label: 'Suppliers', icon: Truck, component: Suppliers, roles: ['purchase', 'manager'] },
      { key: 'quotations', label: 'Quotations', icon: FileQuestion, component: Quotations, roles: ['purchase', 'manager'] },
      { key: 'supplier-quotes', label: 'Quote History', icon: History, component: QuoteHistory, roles: ['purchase', 'manager'] },
      { key: 'purchase-orders', label: 'Purchase Orders', icon: ClipboardList, component: PurchaseOrders, roles: ['purchase', 'manager'] },
    ],
  },
  { type: 'item', key: 'import', label: 'Import', icon: Upload, component: Import, roles: ['purchase', 'manager'] },
  { type: 'item', key: 'users', label: 'Users', icon: UsersIcon, component: Users, roles: ['manager'] },
]

function filterNavByRole(nav, role) {
  return nav
    .map((entry) => {
      if (entry.type === 'item') {
        return entry.roles.includes(role) ? entry : null
      }
      const items = entry.items.filter((i) => i.roles.includes(role))
      return items.length > 0 ? { ...entry, items } : null
    })
    .filter(Boolean)
}

function AppShell() {
  const { user, logout } = useAuth()
  const visibleNav = useMemo(() => filterNavByRole(NAV, user.role), [user.role])
  const flat = useMemo(
    () => visibleNav.flatMap((entry) => (entry.type === 'group' ? entry.items : [entry])),
    [visibleNav]
  )

  const [active, setActive] = useState(flat[0]?.key)
  const [expanded, setExpanded] = useState({ sales: true, purchase: true })

  useEffect(() => {
    // If the current selection isn't visible for this role (e.g. right
    // after login), fall back to the first screen this role can see.
    if (!flat.find((t) => t.key === active) && flat[0]) setActive(flat[0].key)
  }, [flat, active])

  const activeEntry = flat.find((t) => t.key === active) || flat[0]
  if (!activeEntry) {
    return <div style={{ padding: 24 }}>Your account doesn't have access to any screens yet.</div>
  }
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
          {visibleNav.map((entry) => {
            if (entry.type === 'item') {
              const Icon = entry.icon
              const isActive = active === entry.key
              return (
                <button key={entry.key} onClick={() => setActive(entry.key)} style={isActive ? styles.navItemActive : styles.navItem}>
                  <Icon size={16} strokeWidth={2} style={{ flexShrink: 0 }} />
                  <span>{entry.label}</span>
                </button>
              )
            }
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
                        <button key={tab.key} onClick={() => setActive(tab.key)} style={isActive ? styles.navSubItemActive : styles.navSubItem}>
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
        <div style={styles.userFooter}>
          <div>
            <div style={styles.userName}>{user.name}</div>
            <div style={styles.userRole}>{user.role}</div>
          </div>
          <button onClick={logout} style={styles.logoutButton} title="Log out">
            <LogOut size={15} strokeWidth={2} />
          </button>
        </div>
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

function Gate() {
  const { status } = useAuth()
  if (status === 'loading') return null
  if (status === 'needs-setup' || status === 'logged-out') return <Login />
  return <AppShell />
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
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
  nav: { display: 'flex', flexDirection: 'column', gap: 1, padding: '8px 10px', overflowY: 'auto', flex: 1 },
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
  userFooter: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '12px 16px', borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  userName: { fontSize: 12.5, color: '#fff', fontWeight: 500 },
  userRole: { fontSize: 11, color: '#8891a0', textTransform: 'capitalize' },
  logoutButton: { background: 'none', border: 'none', color: '#aab3c0', cursor: 'pointer', padding: 4 },
  contentArea: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 },
  topbar: {
    background: 'var(--color-surface)', borderBottom: '1px solid var(--color-line)',
    padding: '12px 28px',
  },
  main: { flex: 1, padding: '24px 28px', maxWidth: 1100 },
}
