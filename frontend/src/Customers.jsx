import { useState, useEffect, useCallback } from 'react'
import { api } from './api'
import PageHeader from './PageHeader'

export default function Customers() {
  const [customers, setCustomers] = useState([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)
  const [infoMessage, setInfoMessage] = useState(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', phone: '' })

  const load = useCallback(async () => {
    try {
      setCustomers(await api.listCustomers())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function openNewForm() {
    setEditingId(null)
    setForm({ name: '', email: '', phone: '' })
    setFormOpen(!formOpen)
  }

  function openEditForm(c) {
    setEditingId(c.id)
    setForm({ name: c.name, email: c.email || '', phone: c.phone || '' })
    setFormOpen(true)
  }

  async function submitForm(e) {
    e.preventDefault()
    setError(null)
    try {
      if (editingId) {
        await api.updateCustomer(editingId, form)
      } else {
        await api.createCustomer(form)
      }
      setFormOpen(false)
      setEditingId(null)
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleDelete(c) {
    if (!window.confirm(`Delete "${c.name}"?`)) return
    setError(null)
    try {
      await api.deleteCustomer(c.id)
      setInfoMessage('Customer deleted.')
      load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Sales"
        title="Customers"
        description="Who you sell to — their contact details and every site/project they've raised enquiries for."
        action={
          <button className="btn btn-primary" onClick={openNewForm}>
            + Add Customer
          </button>
        }
      />

      {error && <div className="banner banner-error">{error}</div>}
      {infoMessage && <div className="banner banner-info">{infoMessage}</div>}

      {formOpen && (
        <form style={styles.formCard} onSubmit={submitForm}>
          <h4 style={{ marginTop: 0 }}>{editingId ? 'Edit Customer' : 'New Customer'}</h4>
          <div style={styles.formGrid}>
            <div style={styles.field}>
              <label className="eyebrow">Name</label>
              <input
                style={{ width: '100%' }}
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Email</label>
              <input
                style={{ width: '100%' }}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div style={styles.field}>
              <label className="eyebrow">Phone No.</label>
              <input
                style={{ width: '100%' }}
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
          </div>
          <div style={styles.formActions}>
            <button type="submit" className="btn btn-primary">Save Customer</button>
            <button type="button" className="btn btn-secondary" onClick={() => setFormOpen(false)}>Cancel</button>
          </div>
        </form>
      )}

      {/* Search Bar */}
      {customers.length > 0 && (
        <div style={{ margin: '14px 0' }}>
          <input
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 13, border: '1px solid var(--color-line)', borderRadius: 4 }}
            placeholder="Search customers by name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {customers.length === 0 ? (
        <p style={styles.muted}>No customers yet.</p>
      ) : (
        (() => {
          const qStr = search.trim().toLowerCase()
          const filtered = customers.filter((c) => {
            if (qStr) {
              const matchName = c.name?.toLowerCase().includes(qStr)
              const matchEmail = c.email?.toLowerCase().includes(qStr)
              const matchPhone = c.phone?.toLowerCase().includes(qStr)
              if (!matchName && !matchEmail && !matchPhone) return false
            }
            return true
          })

          if (filtered.length === 0) {
            return <p style={{ ...styles.muted, padding: '16px 0' }}>No customers match your search query.</p>
          }

          return (
            <table className="ledger-table">
              <thead>
                <tr><th>Name</th><th>Contact</th><th>Sites</th><th>Added By</th><th></th></tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="num">
                      {c.email && <div>{c.email}</div>}
                      {c.phone && <div>{c.phone}</div>}
                      {!c.email && !c.phone && '—'}
                    </td>
                    <td className="num">{c.site_count}</td>
                    <td style={{ color: 'var(--color-muted)', fontSize: 13 }}>{c.created_by || '—'}</td>
                    <td>
                      <button className="btn-link" onClick={() => openEditForm(c)}>Edit</button>
                      <button className="btn-link btn-link-danger" style={{ marginLeft: 8 }} onClick={() => handleDelete(c)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        })()
      )}
    </div>
  )
}

const styles = {
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  formCard: { border: '1px solid var(--color-line)', borderRadius: 5, padding: 18, margin: '12px 0', background: 'var(--color-surface)' },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  formActions: { display: 'flex', gap: 8 },
}
