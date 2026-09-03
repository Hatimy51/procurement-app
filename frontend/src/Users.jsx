import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const ROLE_LABEL = { purchase: 'Purchase', accounts: 'Accounts', manager: 'Manager', admin: 'Admin', store: 'Store' }

export default function Users() {
  const [users, setUsers] = useState([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'purchase' })

  const load = useCallback(async () => {
    try {
      setUsers(await api.listUsers())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function submitForm(e) {
    e.preventDefault()
    setError(null)
    try {
      await api.createUser(form)
      setForm({ name: '', email: '', password: '', role: 'purchase' })
      setFormOpen(false)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete(u) {
    if (!window.confirm(`Remove ${u.name}'s account? They won't be able to log in anymore.`)) return
    setError(null)
    try {
      await api.deleteUser(u.id)
      setInfoMessage('Account removed.')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        description="Manage user accounts and assign roles: Admin, Manager, Purchase, Accounts, or Store."
        action={<button className="btn btn-primary" onClick={() => setFormOpen(!formOpen)}>+ Add User</button>}
      />

      {error && <div className="banner banner-error">{error}</div>}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {formOpen && (
        <form style={styles.formCard} onSubmit={submitForm}>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label className="eyebrow">Name</label>
              <input style={{ width: '100%' }} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Email</label>
              <input style={{ width: '100%' }} type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Password</label>
              <input style={{ width: '100%' }} type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Role</label>
              <select style={{ width: '100%' }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="purchase">Purchase</option>
                <option value="accounts">Accounts</option>
                <option value="manager">Manager (Full Access)</option>
                <option value="admin">Admin (User Mgmt Only)</option>
                <option value="store">Store (Receiving Queue)</option>
              </select>
            </div>
          </div>
          <div style={styles.formActions}>
            <button type="submit" className="btn btn-primary">Create Account</button>
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Search and Role Filter */}
      {users.length > 0 && (
        <div style={{ display: 'flex', gap: 10, margin: '14px 0', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 220, padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            placeholder="Search users by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            style={{ padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
          >
            <option value="all">All Roles</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
            <option value="purchase">Purchase</option>
            <option value="accounts">Accounts</option>
            <option value="store">Store</option>
          </select>
        </div>
      )}

      {(() => {
        const qStr = search.trim().toLowerCase()
        const filtered = users.filter((u) => {
          if (qStr && !u.name?.toLowerCase().includes(qStr) && !u.email?.toLowerCase().includes(qStr)) return false
          if (roleFilter !== 'all' && u.role !== roleFilter) return false
          return true
        })

        if (filtered.length === 0) {
          return <p style={{ color: 'var(--color-muted)', fontSize: 13, padding: '16px 0' }}>No users match your search and filter criteria.</p>
        }

        return (
          <table className="ledger-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td><span className="stamp stamp-accent">{ROLE_LABEL[u.role] || u.role}</span></td>
                  <td><button className="btn-link btn-link-danger" onClick={() => handleDelete(u)}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      })()}
    </div>
  )
}

const styles = {
  formCard: { border: '1px solid var(--color-line)', borderRadius: 5, padding: 18, margin: '12px 0', background: 'var(--color-surface)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  formActions: { display: 'flex', gap: 8 },
}
