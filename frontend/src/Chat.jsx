import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from './api'
import { useAuth } from './AuthContext'
import PageHeader from './PageHeader'

const ROLE_LABEL = { purchase: 'Purchase', accounts: 'Accounts', manager: 'Manager' }

export default function Chat() {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)

  const load = useCallback(async () => {
    try {
      setMessages(await api.listChatMessages())
    } catch (e) {
      setError(e.message)
    }
  }, [])

  // Simple polling, not a websocket — this is a small internal team tool,
  // not worth the added complexity of a live push connection.
  useEffect(() => {
    load()
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
  }, [load])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSend(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSending(true)
    setError(null)
    try {
      await api.sendChatMessage(text)
      setText('')
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <PageHeader
        eyebrow="Team"
        title="Chat"
        description="Shared between Purchase, Accounts, and Manager — open to everyone regardless of role."
      />

      {error && <div className="banner banner-error">{error}</div>}

      <div style={styles.messageArea}>
        {messages.length === 0 ? (
          <p style={styles.muted}>No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_name === user.name
            return (
              <div key={m.id} style={{ ...styles.messageRow, alignSelf: isMine ? 'flex-end' : 'flex-start' }}>
                <div style={styles.messageMeta}>
                  <strong>{m.sender_name}</strong>{' '}
                  <span className="stamp stamp-neutral" style={{ marginLeft: 4 }}>{ROLE_LABEL[m.sender_role] || m.sender_role}</span>
                  {' · '}{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ ...styles.bubble, background: isMine ? 'var(--color-accent-soft)' : 'var(--color-paper)' }}>
                  {m.message}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} style={styles.inputRow}>
        <input
          style={{ flex: 1 }}
          placeholder="Type a message…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}

const styles = {
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  messageArea: {
    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
    padding: '4px 4px 12px', border: '1px solid var(--color-line)', borderRadius: 5, marginBottom: 12,
  },
  messageRow: { maxWidth: '70%', display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 12px' },
  messageMeta: { fontSize: 11, color: 'var(--color-muted)' },
  bubble: { padding: '8px 12px', borderRadius: 5, fontSize: 13, whiteSpace: 'pre-wrap' },
  inputRow: { display: 'flex', gap: 8 },
}
