/**
 * Consistent page-header pattern used at the top of every screen:
 * a small tracked-caps eyebrow (module context), the page title, an
 * optional one-line description, and an optional primary action button
 * aligned to the right. Mirrors the header pattern Zoho's apps use
 * consistently across every module.
 */
export default function PageHeader({ eyebrow, title, description, action }) {
  return (
    <div style={styles.wrap}>
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 style={styles.title}>{title}</h1>
        {description && <p style={styles.description}>{description}</p>}
      </div>
      {action && <div style={styles.actionSlot}>{action}</div>}
    </div>
  )
}

const styles = {
  wrap: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottom: '1px solid var(--color-line)',
  },
  title: { fontSize: 19, margin: '2px 0 0 0', color: 'var(--color-ink)' },
  description: { color: 'var(--color-ink-soft)', fontSize: 13, margin: '6px 0 0 0', maxWidth: 620 },
  actionSlot: { flexShrink: 0, paddingTop: 2 },
}
