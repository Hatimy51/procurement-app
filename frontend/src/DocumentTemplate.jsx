import { COMPANY_PROFILE } from './companyProfile'
import { numberToRupeesWords } from './utils/numberToWords'

export default function DocumentTemplate({
  documentType, // 'QUOTATION' | 'PURCHASE ORDER' | 'DELIVERY CHALLAN' | 'TAX INVOICE'
  documentNumber,
  status,
  statusBadge,
  dateLabel = 'Date',
  dateValue,
  dueDateLabel,
  dueDateValue,
  extraMeta = [], // [{ label: 'For Quote', value: 'Q-1001' }]
  
  // Parties
  partyTitle = 'Billed To',
  partyName,
  partyEmail,
  partyPhone,
  partyGstin,
  partyAddress,
  
  shipToTitle = 'Shipped To / Site',
  shipToName,
  shipToAddress,
  
  // Audit metadata
  createdBy,
  updatedBy,
  
  // Items table
  items = [], // [{ description, spec, quantity, unit, unit_price, gst_percent }]
  
  // Totals
  subtotal,
  totalGst,
  grandTotal,
  
  // Footer
  notes,
  terms = COMPANY_PROFILE.defaultTerms,
  showBankDetails = true,
  actions, // Buttons header
  children, // Additional custom slots (e.g. editable draft table, GRN upload)
}) {
  const money = (n) =>
    n != null && !isNaN(n)
      ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : '—'

  return (
    <div style={styles.outerWrapper}>
      {/* Action Bar (Hidden when printing) */}
      <div className="no-print" style={styles.actionBar}>
        {actions}
      </div>

      {/* Printable Sheet */}
      <div className="zoho-document-sheet" style={styles.sheet}>
        {/* Letterhead Header */}
        <div style={styles.headerGrid}>
          <div>
            <div style={styles.companyName}>{COMPANY_PROFILE.name}</div>
            <div style={styles.companyTagline}>{COMPANY_PROFILE.tagline}</div>
            <div style={styles.companyDetails}>
              {COMPANY_PROFILE.address}<br />
              <strong>GSTIN:</strong> {COMPANY_PROFILE.gstin} · <strong>Phone:</strong> {COMPANY_PROFILE.phone}<br />
              <strong>Email:</strong> {COMPANY_PROFILE.email}
            </div>
          </div>

          <div style={styles.headerRight}>
            <div style={styles.docTypeTitle}>{documentType}</div>
            <div style={styles.docNumber}>{documentNumber}</div>
            {statusBadge && <div style={{ marginTop: 4 }}>{statusBadge}</div>}

            <div style={styles.metaGrid}>
              <span style={styles.metaLabel}>{dateLabel}:</span>
              <span style={styles.metaValue}>{dateValue ? new Date(dateValue).toLocaleDateString('en-IN') : '—'}</span>

              {dueDateLabel && dueDateValue && (
                <>
                  <span style={styles.metaLabel}>{dueDateLabel}:</span>
                  <span style={styles.metaValue}>{new Date(dueDateValue).toLocaleDateString('en-IN')}</span>
                </>
              )}

              {extraMeta.map((m, idx) => (
                <div key={idx} style={{ gridColumn: 'span 2', display: 'contents' }}>
                  <span style={styles.metaLabel}>{m.label}:</span>
                  <span style={styles.metaValue}>{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Created / Edited Audit Line */}
        {(createdBy || updatedBy) && (
          <div style={styles.auditLine}>
            Created {dateValue ? new Date(dateValue).toLocaleString() : ''}
            {createdBy && <> by <strong>{createdBy}</strong></>}
            {updatedBy && updatedBy !== createdBy && (
              <> · Last edited by <strong>{updatedBy}</strong></>
            )}
          </div>
        )}

        <hr style={styles.divider} />

        {/* Bill To & Ship To Grid */}
        <div style={styles.partiesGrid}>
          <div style={styles.partyCard}>
            <div style={styles.partyHeader}>{partyTitle}</div>
            <div style={styles.partyBody}>
              <div style={styles.partyNameText}>{partyName || '—'}</div>
              {partyGstin && <div><strong>GSTIN:</strong> {partyGstin}</div>}
              {partyAddress && <div>{partyAddress}</div>}
              {partyEmail && <div>Email: {partyEmail}</div>}
              {partyPhone && <div>Phone: {partyPhone}</div>}
            </div>
          </div>

          {(shipToName || shipToAddress) && (
            <div style={styles.partyCard}>
              <div style={styles.partyHeader}>{shipToTitle}</div>
              <div style={styles.partyBody}>
                <div style={styles.partyNameText}>{shipToName || '—'}</div>
                {shipToAddress && <div>{shipToAddress}</div>}
              </div>
            </div>
          )}
        </div>

        {/* Main Content / Table Slot */}
        {children ? (
          children
        ) : (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={{ ...styles.th, width: '40px' }}>#</th>
                <th style={styles.th}>Item & Description</th>
                <th style={styles.th}>Spec</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Qty</th>
                <th style={styles.th}>Unit</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Rate (₹)</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>GST %</th>
                <th style={{ ...styles.th, textAlign: 'right' }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const lineTotal =
                  item.unit_price != null && item.quantity != null
                    ? Number(item.unit_price) * Number(item.quantity)
                    : null
                return (
                  <tr key={item.id || index} style={styles.tr}>
                    <td style={{ ...styles.td, fontFamily: 'var(--font-mono)' }}>{index + 1}</td>
                    <td style={styles.td}>
                      <strong>{item.description}</strong>
                    </td>
                    <td style={{ ...styles.td, color: 'var(--color-muted)' }}>{item.spec || '—'}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {item.quantity}
                    </td>
                    <td style={styles.td}>{item.unit || 'Nos'}</td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {item.unit_price != null ? money(item.unit_price) : '—'}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                      {item.gst_percent != null ? `${item.gst_percent}%` : '—'}
                    </td>
                    <td style={{ ...styles.td, textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {lineTotal != null ? money(lineTotal) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Totals & Tax Summary Block */}
        {grandTotal != null && (
          <div style={styles.summaryContainer}>
            <div style={styles.amountWordsBlock}>
              <div style={styles.sectionHeading}>Amount in Words:</div>
              <div style={styles.amountWordsText}>{numberToRupeesWords(grandTotal)}</div>

              {notes && (
                <div style={{ marginTop: 14 }}>
                  <div style={styles.sectionHeading}>Notes / Instructions:</div>
                  <div style={styles.notesBox}>{notes}</div>
                </div>
              )}
            </div>

            <div style={styles.totalsTableBlock}>
              <div style={styles.totalRow}>
                <span>Taxable Amount</span>
                <span className="mono">{money(subtotal)}</span>
              </div>
              <div style={styles.totalRow}>
                <span>Total GST</span>
                <span className="mono">{money(totalGst)}</span>
              </div>
              <div style={styles.grandTotalRow}>
                <span>Total (INR)</span>
                <span className="mono">{money(grandTotal)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Footer: Bank Details & Signatory */}
        <div style={styles.documentFooter}>
          {showBankDetails ? (
            <div style={styles.bankBlock}>
              <div style={styles.sectionHeading}>Bank Details for Payment:</div>
              <div style={styles.bankGrid}>
                <span>Bank Name:</span> <strong>{COMPANY_PROFILE.bankDetails.bankName}</strong>
                <span>A/c Name:</span> <strong>{COMPANY_PROFILE.bankDetails.accountName}</strong>
                <span>A/c Number:</span> <strong className="mono">{COMPANY_PROFILE.bankDetails.accountNumber}</strong>
                <span>IFSC Code:</span> <strong className="mono">{COMPANY_PROFILE.bankDetails.ifscCode}</strong>
                <span>Branch:</span> <span>{COMPANY_PROFILE.bankDetails.branch}</span>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1 }}>
              {terms && terms.length > 0 && (
                <div>
                  <div style={styles.sectionHeading}>Terms & Conditions:</div>
                  <ol style={styles.termsList}>
                    {terms.map((t, idx) => (
                      <li key={idx}>{t}</li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          <div style={styles.signatoryBlock}>
            <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>For <strong>{COMPANY_PROFILE.name}</strong></div>
            <div style={styles.signatorySpace}>[ Authorized Signatory ]</div>
          </div>
        </div>
      </div>
    </div>
  )
}

const styles = {
  outerWrapper: {
    maxWidth: 920,
    margin: '0 auto',
  },
  actionBar: {
    display: 'flex',
    justify: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  sheet: {
    background: '#ffffff',
    border: '1px solid #dcdfe6',
    borderRadius: 4,
    padding: '32px 36px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
    color: '#1a202c',
    fontSize: 13,
  },
  headerGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    gap: 20,
    alignItems: 'start',
  },
  companyName: {
    fontFamily: 'var(--font-head)',
    fontSize: 20,
    fontWeight: 700,
    color: '#1a365d',
    letterSpacing: '-0.01em',
  },
  companyTagline: {
    fontSize: 11,
    color: '#718096',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  companyDetails: {
    fontSize: 12,
    color: '#4a5568',
    lineHeight: 1.5,
  },
  headerRight: {
    textAlign: 'right',
  },
  docTypeTitle: {
    fontFamily: 'var(--font-head)',
    fontSize: 24,
    fontWeight: 700,
    color: '#2b6cb0',
    letterSpacing: '0.02em',
  },
  docNumber: {
    fontFamily: 'var(--font-mono)',
    fontSize: 14,
    fontWeight: 600,
    color: '#2d3748',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto auto',
    gap: '4px 10px',
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
    justifyContent: 'end',
  },
  metaLabel: {
    color: '#718096',
    fontWeight: 500,
  },
  metaValue: {
    fontFamily: 'var(--font-mono)',
    color: '#1a202c',
    fontWeight: 600,
  },
  auditLine: {
    fontSize: 11,
    color: '#718096',
    marginTop: 10,
    padding: '4px 8px',
    background: '#f7fafc',
    borderRadius: 3,
    display: 'inline-block',
  },
  divider: {
    border: 'none',
    borderTop: '2px solid #e2e8f0',
    margin: '18px 0',
  },
  partiesGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginBottom: 20,
  },
  partyCard: {
    background: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    padding: '10px 14px',
  },
  partyHeader: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: '#4a5568',
    borderBottom: '1px solid #cbd5e0',
    paddingBottom: 4,
    marginBottom: 6,
  },
  partyBody: {
    fontSize: 12,
    lineHeight: 1.5,
    color: '#2d3748',
  },
  partyNameText: {
    fontWeight: 700,
    fontSize: 13,
    color: '#1a202c',
    marginBottom: 2,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    margin: '16px 0',
    fontSize: 12.5,
  },
  th: {
    background: '#edf2f7',
    color: '#2d3748',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    padding: '8px 10px',
    borderBottom: '2px solid #cbd5e0',
  },
  tr: {
    borderBottom: '1px solid #e2e8f0',
  },
  td: {
    padding: '9px 10px',
    verticalAlign: 'top',
  },
  summaryContainer: {
    display: 'grid',
    gridTemplateColumns: '1fr 280px',
    gap: 20,
    marginTop: 16,
    paddingTop: 12,
    borderTop: '1px solid #e2e8f0',
  },
  amountWordsBlock: {
    fontSize: 12,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    color: '#718096',
    marginBottom: 4,
  },
  amountWordsText: {
    fontWeight: 600,
    color: '#2b6cb0',
    fontStyle: 'italic',
  },
  notesBox: {
    background: '#fffaf0',
    border: '1px solid #feebc8',
    padding: '8px 12px',
    borderRadius: 3,
    color: '#744210',
    fontSize: 12,
  },
  totalsTableBlock: {
    background: '#f7fafc',
    border: '1px solid #e2e8f0',
    borderRadius: 4,
    padding: '10px 14px',
  },
  totalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    fontSize: 12,
    color: '#4a5568',
  },
  grandTotalRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 0 2px',
    marginTop: 6,
    borderTop: '2px solid #cbd5e0',
    fontSize: 14,
    fontWeight: 700,
    color: '#1a202c',
  },
  documentFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'end',
    marginTop: 28,
    paddingTop: 16,
    borderTop: '1px dashed #cbd5e0',
    gap: 20,
  },
  bankBlock: {
    flex: 1,
    fontSize: 11.5,
  },
  bankGrid: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '2px 8px',
    color: '#4a5568',
  },
  termsList: {
    margin: 0,
    paddingLeft: 16,
    fontSize: 11,
    color: '#718096',
  },
  signatoryBlock: {
    textAlign: 'center',
    minWidth: 180,
  },
  signatorySpace: {
    marginTop: 36,
    paddingTop: 4,
    borderTop: '1px solid #a0aec0',
    fontSize: 11,
    fontWeight: 600,
    color: '#4a5568',
  },
}
