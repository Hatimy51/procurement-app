import { useState, useEffect } from 'react'
import { MapPin, Plus, Link, Trash2, User } from 'lucide-react'

const BASE = '/api'

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
  page: { padding: 24, maxWidth: 900, margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 700, color: '#1e2330', margin: 0 },
  btn: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#3b5bdb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  btnSm: { padding: '5px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600 },
  card: { background: '#fff', borderRadius: 10, border: '1px solid #e8ebf0', marginBottom: 14, overflow: 'hidden' },
  cardHead: { padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f0f2f5' },
  cardBody: { padding: '14px 18px' },
  badge: { fontSize: 11, padding: '2px 8px', borderRadius: 20, fontWeight: 600 },
  input: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' },
  label: { fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 4, display: 'block' },
  row: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 },
  select: { width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13 },
  error: { color: '#ef4444', fontSize: 13, marginTop: 8 },
  empty: { textAlign: 'center', padding: 48, color: '#9ca3af', fontSize: 14 },
}

function CreateForm({ onCreated, onCancel }) {
  const [name, setName] = useState('')
  const [area, setArea] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    if (!name.trim()) { setErr('Location name is required.'); return }
    setLoading(true)
    setErr('')
    try {
      const result = await apiFetch('/store-locations', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), area: area.trim() || null, address: address.trim() || null }),
      })
      onCreated(result)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ background: '#f8faff', border: '1px solid #c7d2fe', borderRadius: 10, padding: 18, marginBottom: 20 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 15, color: '#3730a3' }}>New Store Location</h3>
      <form onSubmit={handleSubmit}>
        <div style={s.row}>
          <div>
            <label style={s.label}>Location Name *</label>
            <input style={s.input} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Site A – Nagpur" />
          </div>
          <div>
            <label style={s.label}>Area / Zone</label>
            <input style={s.input} value={area} onChange={e => setArea(e.target.value)} placeholder="e.g. West Zone" />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={s.label}>Full Address</label>
          <input style={s.input} value={address} onChange={e => setAddress(e.target.value)} placeholder="Plot 12, MIDC, Nagpur 440013" />
        </div>
        {err && <div style={s.error}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button type="submit" style={s.btn} disabled={loading}>{loading ? 'Creating…' : 'Create Location'}</button>
          <button type="button" onClick={onCancel} style={{ ...s.btn, background: '#6b7280' }}>Cancel</button>
        </div>
      </form>
    </div>
  )
}

function LinkUserModal({ location, storeUsers, onLinked, onClose }) {
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  async function handleLink() {
    if (!userId) { setErr('Select a user first.'); return }
    setLoading(true)
    setErr('')
    try {
      const result = await apiFetch(`/store-locations/${location.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ linked_user_id: userId }),
      })
      onLinked(result)
    } catch (ex) {
      setErr(ex.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, width: 380, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>Link Store User</h3>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#6b7280' }}>Assign a store-role user to <strong>{location.name}</strong></p>
        <label style={s.label}>Store User</label>
        <select style={s.select} value={userId} onChange={e => setUserId(e.target.value)}>
          <option value="">Select a store user…</option>
          {storeUsers.map(u => (
            <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
          ))}
        </select>
        {err && <div style={s.error}>{err}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button style={s.btn} onClick={handleLink} disabled={loading}>{loading ? 'Linking…' : 'Link User'}</button>
          <button style={{ ...s.btn, background: '#6b7280' }} onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}

export default function StoreLocations() {
  const [locations, setLocations] = useState([])
  const [allUsers, setAllUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [linkTarget, setLinkTarget] = useState(null)

  useEffect(() => {
    Promise.all([
      apiFetch('/store-locations'),
      apiFetch('/auth/users'),
    ]).then(([locs, users]) => {
      setLocations(locs)
      setAllUsers(users)
    }).catch(console.error).finally(() => setLoading(false))
  }, [])

  const storeUsers = allUsers.filter(u => u.role === 'store')

  function handleCreated(loc) {
    setLocations(prev => [loc, ...prev])
    setShowCreate(false)
  }

  function handleLinked(updated) {
    setLocations(prev => prev.map(l => l.id === updated.id ? updated : l))
    setLinkTarget(null)
  }

  async function handleDelete(locId) {
    if (!window.confirm('Delete this store location?')) return
    try {
      await apiFetch(`/store-locations/${locId}`, { method: 'DELETE' })
      setLocations(prev => prev.filter(l => l.id !== locId))
    } catch (ex) {
      alert(ex.message)
    }
  }

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>Loading store locations…</div>

  return (
    <div style={s.page}>
      <div style={s.header}>
        <h1 style={s.title}>Store Locations</h1>
        <button style={s.btn} onClick={() => setShowCreate(true)}>
          <Plus size={15} /> New Location
        </button>
      </div>

      {showCreate && (
        <CreateForm onCreated={handleCreated} onCancel={() => setShowCreate(false)} />
      )}

      {locations.length === 0 ? (
        <div style={s.empty}>
          <MapPin size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
          <div>No store locations yet. Create one to link it to POs and store users.</div>
        </div>
      ) : (
        locations.map(loc => (
          <div key={loc.id} style={s.card}>
            <div style={s.cardHead}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <MapPin size={16} color="#6366f1" />
                <span style={{ fontWeight: 700, fontSize: 15 }}>{loc.name}</span>
                {loc.area && <span style={{ ...s.badge, background: '#ede9fe', color: '#7c3aed' }}>{loc.area}</span>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  style={{ ...s.btnSm, background: '#f0fdf4', color: '#16a34a' }}
                  onClick={() => setLinkTarget(loc)}
                >
                  <Link size={12} style={{ verticalAlign: 'middle' }} /> Link User
                </button>
                <button
                  style={{ ...s.btnSm, background: '#fef2f2', color: '#ef4444' }}
                  onClick={() => handleDelete(loc.id)}
                >
                  <Trash2 size={12} style={{ verticalAlign: 'middle' }} />
                </button>
              </div>
            </div>
            <div style={s.cardBody}>
              {loc.address && <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 10 }}>{loc.address}</div>}
              {loc.linked_users.length === 0 ? (
                <div style={{ fontSize: 13, color: '#9ca3af', fontStyle: 'italic' }}>No store user linked yet</div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {loc.linked_users.map(u => (
                    <span key={u.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 20, padding: '3px 10px', fontSize: 12 }}>
                      <User size={11} color="#0284c7" /> {u.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))
      )}

      {linkTarget && (
        <LinkUserModal
          location={linkTarget}
          storeUsers={storeUsers}
          onLinked={handleLinked}
          onClose={() => setLinkTarget(null)}
        />
      )}
    </div>
  )
}
