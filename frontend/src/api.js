// Thin wrapper around the backend API. Kept in one place so the base path
// or error handling only needs to change here, not in every component.
const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    let message = `API error ${res.status}: ${text}`
    let errorData = null
    try {
      const json = JSON.parse(text)
      if (json.detail) {
        if (typeof json.detail === 'object') {
          message = json.detail.message || JSON.stringify(json.detail)
          errorData = json.detail
        } else {
          message = json.detail
        }
      }
    } catch {}
    const err = new Error(message)
    if (errorData) {
      err.data = errorData
      err.existing_id = errorData.existing_id
      err.existing_number = errorData.existing_number
      err.error_code = errorData.error_code
      err.document_type = errorData.document_type
    }
    throw err
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  // Auth
  getBootstrapStatus: () => request('/auth/bootstrap-status'),
  setupFirstAccount: (payload) => request('/auth/setup', { method: 'POST', body: JSON.stringify(payload) }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMe: () => request('/auth/me'),
  listUsers: () => request('/auth/users'),
  createUser: (payload) => request('/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  deleteUser: (id) => request(`/auth/users/${id}`, { method: 'DELETE' }),

  listProducts: (search) =>
    request(`/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createProduct: (product) =>
    request('/products', { method: 'POST', body: JSON.stringify(product) }),
  updateProduct: (id, product) =>
    request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(product) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
  updatePriceEntry: (id, payload) =>
    request(`/prices/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  addPrice: (priceEntry) =>
    request('/prices', { method: 'POST', body: JSON.stringify(priceEntry) }),
  priceHistory: (productId) => request(`/prices/product/${productId}`),

  ingestEnquiry: (payload) =>
    request('/enquiries/ingest', { method: 'POST', body: JSON.stringify(payload) }),
  ingestEnquiryFile: async (customerName, siteName, file) => {
    const formData = new FormData()
    formData.append('customer_name', customerName)
    formData.append('site_name', siteName)
    formData.append('file', file)
    const res = await fetch(`${BASE}/enquiries/ingest-file`, { method: 'POST', body: formData })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`API error ${res.status}: ${text}`)
    }
    return res.json()
  },
  listEnquiries: () => request('/enquiries/list'),
  getEnquiryDetail: (id) => request(`/enquiries/${id}/detail`),
  updateEnquiryItem: (enquiryId, itemId, payload) =>
    request(`/enquiries/${enquiryId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  markEnquiryReviewed: (id) => request(`/enquiries/${id}/mark-reviewed`, { method: 'POST' }),
  deleteEnquiry: (id) => request(`/enquiries/${id}`, { method: 'DELETE' }),
  saveItemAsNewProduct: (enquiryId, itemId) =>
    request(`/enquiries/${enquiryId}/items/${itemId}/save-as-product`, { method: 'POST' }),
  saveAllAsProducts: (enquiryId) =>
    request(`/enquiries/${enquiryId}/save-all-as-products`, { method: 'POST' }),

  importPreview: async (file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/imports/preview`, { method: 'POST', body: formData })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
    return res.json()
  },
  importCommit: async (file, mapping) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('mapping', JSON.stringify(mapping))
    const res = await fetch(`${BASE}/imports/commit`, { method: 'POST', body: formData })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
    return res.json()
  },

  listSuppliers: () => request('/suppliers'),
  createSupplier: (supplier) => request('/suppliers', { method: 'POST', body: JSON.stringify(supplier) }),
  updateSupplier: (id, supplier) =>
    request(`/suppliers/${id}`, { method: 'PUT', body: JSON.stringify(supplier) }),
  deleteSupplier: (id) => request(`/suppliers/${id}`, { method: 'DELETE' }),
  getSupplierLedger: (id) => request(`/suppliers/${id}/ledger`),
  getSuggestedSuppliers: (productIds) =>
    request(`/suppliers/suggested?product_ids=${productIds.join(',')}`),

  listRfqs: (status) => request(`/rfqs${status ? `?status=${status}` : ''}`),
  createRfq: (rfq) => request('/rfqs', { method: 'POST', body: JSON.stringify(rfq) }),
  deleteRfq: (id) => request(`/rfqs/${id}`, { method: 'DELETE' }),
  createRfqsBulk: (payload) => request('/rfqs/bulk', { method: 'POST', body: JSON.stringify(payload) }),
  createRfqsBulkGrouped: (payload) =>
    request('/rfqs/bulk-grouped', { method: 'POST', body: JSON.stringify(payload) }),
  ingestQuoteForSupplierText: (supplierId, rawText) => {
    const formData = new URLSearchParams()
    formData.append('supplier_id', supplierId)
    formData.append('raw_text', rawText)
    return fetch(`${BASE}/rfqs/ingest-quote-for-supplier`, { method: 'POST', body: formData })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
        return res.json()
      })
  },
  ingestQuoteFileForSupplier: async (supplierId, file) => {
    const formData = new FormData()
    formData.append('supplier_id', supplierId)
    formData.append('file', file)
    const res = await fetch(`${BASE}/rfqs/ingest-quote-file-for-supplier`, { method: 'POST', body: formData })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
    return res.json()
  },

  listQuotes: () => request('/supplier-quotes'),
  getQuoteDetail: (id) => request(`/supplier-quotes/${id}`),
  bulkUpdateQuoteItems: (quoteId, items) =>
    request(`/supplier-quotes/${quoteId}/items`, { method: 'PUT', body: JSON.stringify({ items }) }),
  deleteQuoteItem: (quoteId, priceEntryId) =>
    request(`/supplier-quotes/${quoteId}/items/${priceEntryId}`, { method: 'DELETE' }),
  deleteQuote: (id) => request(`/supplier-quotes/${id}`, { method: 'DELETE' }),

  // Customer Quotes (quote assembly + approval) — distinct names from the
  // supplier-quotes helpers above, since /quotes and /supplier-quotes are
  // different resources.
  listReadyEnquiries: () => request('/quotes/ready-enquiries'),
  listCustomerQuotes: () => request('/quotes'),
  generateQuote: (enquiryId) =>
    request(`/quotes/generate?enquiry_id=${encodeURIComponent(enquiryId)}`, { method: 'POST' }),
  getCustomerQuoteDetail: (id) => request(`/quotes/${id}`),
  updateQuoteDraft: (id, payload) =>
    request(`/quotes/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  approveQuote: (id) => request(`/quotes/${id}/approve`, { method: 'POST' }),
  revertQuoteToDraft: (id) => request(`/quotes/${id}/revert-to-draft`, { method: 'POST' }),
  markQuoteSent: (id) => request(`/quotes/${id}/mark-sent`, { method: 'POST' }),
  deleteCustomerQuote: (id) => request(`/quotes/${id}`, { method: 'DELETE' }),

  // Vendor Quote Comparison
  analyzeQuoteComparison: (payload) =>
    request('/quote-comparison/analyze', { method: 'POST', body: JSON.stringify(payload) }),

  // Executive Dashboard
  getDashboardMetrics: () => request('/dashboard/metrics'),
  syncToAccounting: (payload) =>
    request('/accounting/sync', { method: 'POST', body: JSON.stringify(payload) }),
  refreshERPStatus: (payload) =>
    request('/accounting/refresh-status', { method: 'POST', body: JSON.stringify(payload) }),

  // Purchase Orders
  listPurchaseOrders: () => request('/purchase-orders'),
  createPurchaseOrder: (payload) =>
    request('/purchase-orders', { method: 'POST', body: JSON.stringify(payload) }),
  getPurchaseOrderDetail: (id) => request(`/purchase-orders/${id}`),
  updatePurchaseOrderDraft: (id, payload) =>
    request(`/purchase-orders/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  markPurchaseOrderSent: (id) => request(`/purchase-orders/${id}/mark-sent`, { method: 'POST' }),
  approvePurchaseOrder: (id) => request(`/purchase-orders/${id}/approve`, { method: 'POST' }),
  rejectPurchaseOrder: (id) => request(`/purchase-orders/${id}/reject`, { method: 'POST' }),
  deletePurchaseOrder: (id) => request(`/purchase-orders/${id}`, { method: 'DELETE' }),
  createDeliveryChallanFromPurchaseOrder: (id) =>
    request(`/purchase-orders/${id}/create-delivery-challan`, { method: 'POST' }),
  getPODocuments: (id) => request(`/vendor-portal/po-documents/${id}`),

  // Store Locations
  listStoreLocations: () => request('/store-locations'),
  createStoreLocation: (payload) => request('/store-locations', { method: 'POST', body: JSON.stringify(payload) }),

  // Delivery Challans
  listReadyQuotesForDelivery: () => request('/delivery-challans/ready-quotes'),
  getQuoteDeliveryStatus: (quoteId) => request(`/delivery-challans/quote/${quoteId}/lines`),
  listDeliveryChallans: () => request('/delivery-challans'),
  createDeliveryChallan: (payload) =>
    request('/delivery-challans', { method: 'POST', body: JSON.stringify(payload) }),
  getDeliveryChallanDetail: (id) => request(`/delivery-challans/${id}`),
  updateDeliveryChallanDraft: (id, payload) =>
    request(`/delivery-challans/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  markDeliveryChallanDispatched: (id) => request(`/delivery-challans/${id}/mark-dispatched`, { method: 'POST' }),
  deleteDeliveryChallan: (id) => request(`/delivery-challans/${id}`, { method: 'DELETE' }),

  // Invoices
  listReadyQuotesForInvoice: () => request('/invoices/ready-quotes'),
  getQuoteInvoiceStatus: (quoteId) => request(`/invoices/quote/${quoteId}/lines`),
  listInvoices: () => request('/invoices'),
  createInvoice: (payload) => request('/invoices', { method: 'POST', body: JSON.stringify(payload) }),
  getInvoiceDetail: (id) => request(`/invoices/${id}`),
  updateInvoiceDraft: (id, payload) =>
    request(`/invoices/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  issueInvoice: (id) => request(`/invoices/${id}/issue`, { method: 'POST' }),
  deleteInvoice: (id) => request(`/invoices/${id}`, { method: 'DELETE' }),

  // Inbox (Gmail)
  getInboxStatus: () => request('/inbox/status'),
  startInboxConnect: () => request('/inbox/connect'),
  disconnectInbox: () => request('/inbox/disconnect', { method: 'POST' }),
  scanInbox: () => request('/inbox/scan', { method: 'POST' }),
  getInboxActivity: () => request('/inbox/activity'),

  // Customers
  listCustomers: () => request('/customers'),
  createCustomer: (payload) => request('/customers', { method: 'POST', body: JSON.stringify(payload) }),
  updateCustomer: (id, payload) => request(`/customers/${id}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteCustomer: (id) => request(`/customers/${id}`, { method: 'DELETE' }),
}
