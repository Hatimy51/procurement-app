import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

const ROLE_LABEL = { purchase: 'Purchase', accounts: 'Accounts', manager: 'Manager' }

export default function Users() {
  const [users, setUsers] = useState([])
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
        description="Who has a login, and what role they have — Purchase, Accounts, or Manager."
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
                <option value="manager">Manager</option>
              </select>
            </div>
          </div>
          <div style={styles.formActions}>
            <button type="submit" className="btn btn-primary">Create Account</button>
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      <table className="ledger-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td><span className="stamp stamp-accent">{ROLE_LABEL[u.role] || u.role}</span></td>
              <td><button className="btn-link btn-link-danger" onClick={() => handleDelete(u)}>Remove</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const styles = {
  formCard: { border: '1px solid var(--color-line)', borderRadius: 5, padding: 18, margin: '12px 0', background: 'var(--color-surface)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  formActions: { display: 'flex', gap: 8 },
}
