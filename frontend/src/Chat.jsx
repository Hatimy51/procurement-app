import { useState, useEffect, useRef, useCallback } from 'react'
import { Paperclip, FileText, Download, X, Image as ImageIcon } from 'lucide-react'
import { api } from './api'
import { useAuth } from './AuthContext'
import PageHeader from './PageHeader'

const ROLE_LABEL = { purchase: 'Purchase', accounts: 'Accounts', manager: 'Manager' }

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function isImageType(fileName, fileType) {
  if (fileType && fileType.startsWith('image/')) return true
  if (!fileName) return false
  const ext = fileName.split('.').pop().toLowerCase()
  return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)
}

export default function Chat() {
  const { user } = useAuth()
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [selectedFile, setSelectedFile] = useState(null)
  const [error, setError] = useState(null)
  const [sending, setSending] = useState(false)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)

  const load = useCallback(async () => {
    try {
      setMessages(await api.listChatMessages())
    } catch (e) {
      setError(e.message)
    }
  }, [])

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
    if (!text.trim() && !selectedFile) return
    setSending(true)
    setError(null)
    try {
      await api.sendChatMessage(text, selectedFile)
      setText('')
      setSelectedFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 25 * 1024 * 1024) {
        setError('File is too large (max limit is 25 MB).')
        return
      }
      setError(null)
      setSelectedFile(file)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 120px)' }}>
      <PageHeader
        eyebrow="Team"
        title="Chat"
        description="Shared between Purchase, Accounts, and Manager — share messages, documents, images, and spreadsheets."
      />

      {error && <div className="banner banner-error" style={{ marginBottom: 8 }}>{error}</div>}

      <div style={styles.messageArea}>
        {messages.length === 0 ? (
          <p style={styles.muted}>No messages yet — say hello.</p>
        ) : (
          messages.map((m) => {
            const isMine = m.sender_name === user.name
            const isImg = isImageType(m.file_name, m.file_type)

            return (
              <div key={m.id} style={{ ...styles.messageRow, alignSelf: isMine ? 'flex-end' : 'flex-start' }}>
                <div style={styles.messageMeta}>
                  <strong>{m.sender_name}</strong>{' '}
                  <span className="stamp stamp-neutral" style={{ marginLeft: 4 }}>{ROLE_LABEL[m.sender_role] || m.sender_role}</span>
                  {' · '}{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>

                <div style={{ ...styles.bubble, background: isMine ? 'var(--color-accent-soft)' : 'var(--color-paper)' }}>
                  {m.message && <div style={{ marginBottom: m.file_url ? 8 : 0 }}>{m.message}</div>}

                  {m.file_url && (
                    <div style={styles.attachmentBox}>
                      {isImg ? (
                        <a href={m.file_url} target="_blank" rel="noreferrer" title="Click to view full image">
                          <img
                            src={m.file_url}
                            alt={m.file_name || 'Attachment'}
                            style={styles.imageThumbnail}
                          />
                        </a>
                      ) : (
                        <div style={styles.fileCard}>
                          <FileText size={20} style={{ color: 'var(--color-rust)', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={styles.fileName} title={m.file_name}>{m.file_name}</div>
                            <div style={styles.fileSize}>{formatBytes(m.file_size)}</div>
                          </div>
                          <a
                            href={m.file_url}
                            download={m.file_name || 'attachment'}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}
                          >
                            <Download size={13} />
                            Download
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {selectedFile && (
        <div style={styles.filePreviewBadge}>
          {isImageType(selectedFile.name, selectedFile.type) ? (
            <ImageIcon size={16} style={{ color: 'var(--color-rust)' }} />
          ) : (
            <FileText size={16} style={{ color: 'var(--color-rust)' }} />
          )}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>
            {selectedFile.name} ({formatBytes(selectedFile.size)})
          </span>
          <button
            type="button"
            onClick={() => {
              setSelectedFile(null)
              if (fileInputRef.current) fileInputRef.current.value = ''
            }}
            style={styles.clearFileBtn}
            title="Remove attachment"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <form onSubmit={handleSend} style={styles.inputRow}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          title="Attach file or image"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px' }}
        >
          <Paperclip size={16} />
        </button>

        <input
          style={{ flex: 1 }}
          placeholder="Type a message or attach a file…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-primary" type="submit" disabled={sending || (!text.trim() && !selectedFile)}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

const styles = {
  muted: { color: 'var(--color-muted)', fontSize: 13 },
  messageArea: {
    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12,
    padding: '8px 12px', border: '1px solid var(--color-line)', borderRadius: 5, marginBottom: 8,
  },
  messageRow: { maxWidth: '75%', display: 'flex', flexDirection: 'column', gap: 2 },
  messageMeta: { fontSize: 11, color: 'var(--color-muted)' },
  bubble: { padding: '8px 12px', borderRadius: 5, fontSize: 13, whiteSpace: 'pre-wrap' },
  attachmentBox: { marginTop: 4 },
  imageThumbnail: { maxWidth: 280, maxHeight: 220, borderRadius: 4, display: 'block', objectFit: 'cover', cursor: 'pointer', border: '1px solid var(--color-line)' },
  fileCard: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
    background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 4, minWidth: 240,
  },
  fileName: { fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  fileSize: { fontSize: 11, color: 'var(--color-muted)' },
  filePreviewBadge: {
    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
    background: 'var(--color-paper)', border: '1px solid var(--color-line)', borderRadius: 4, marginBottom: 8,
  },
  clearFileBtn: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-muted)', padding: 2, display: 'flex' },
  inputRow: { display: 'flex', gap: 8 },
}
