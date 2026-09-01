import { useState } from 'react'
import { api } from './api'
import { useAuth } from './AuthContext'

export default function Login() {
  const { status, refresh } = useAuth()
  const isSetup = status === 'needs-setup'

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      if (isSetup) {
        await api.setupFirstAccount({ name, email, password })
      } else {
        await api.login(email, password)
      }
      await refresh()
    } catch (e) {
      setError(isSetup ? e.message : 'Incorrect email or password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={styles.shell}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <div style={styles.mark}>PA</div>
        <h1 style={styles.title}>{isSetup ? 'Set up your Manager account' : 'Procurement Automation'}</h1>
        <p style={styles.subtitle}>
          {isSetup
            ? "This is the first time this app is being set up — create the Manager account. You can add Purchase and Accounts logins afterward."
            : 'Log in to continue.'}
        </p>

        {error && <div className="banner banner-error">{error}</div>}

        {isSetup && (
          <div style={styles.field}>
            <label className="eyebrow">Name</label>
            <input style={{ width: '100%' }} required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        )}
        <div style={styles.field}>
          <label className="eyebrow">Email</label>
          <input style={{ width: '100%' }} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div style={styles.field}>
          <label className="eyebrow">Password</label>
          <input style={{ width: '100%' }} type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>

        <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%', marginTop: 8 }}>
          {loading ? 'Please wait…' : isSetup ? 'Create Manager Account' : 'Log In'}
        </button>
      </form>
    </div>
  )
}

const styles = {
  shell: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-paper)' },
  card: { background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 5, padding: 32, width: 360 },
  mark: {
    width: 40, height: 40, borderRadius: 3, background: 'var(--color-rust)', color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 14, marginBottom: 16,
  },
  title: { fontSize: 18, margin: '0 0 6px 0', color: 'var(--color-ink)' },
  subtitle: { fontSize: 13, color: 'var(--color-ink-soft)', margin: '0 0 20px 0' },
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 },
}
