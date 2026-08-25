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
    throw new Error(`API error ${res.status}: ${text}`)
  }
  return res.status === 204 ? null : res.json()
}

export const api = {
  listProducts: (search) =>
    request(`/products${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  createProduct: (product) =>
    request('/products', { method: 'POST', body: JSON.stringify(product) }),
  updateProduct: (id, product) =>
    request(`/products/${id}`, { method: 'PUT', body: JSON.stringify(product) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: 'DELETE' }),
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

  listRfqs: (status) => request(`/rfqs${status ? `?status=${status}` : ''}`),
  createRfq: (rfq) => request('/rfqs', { method: 'POST', body: JSON.stringify(rfq) }),
  createRfqsBulk: (payload) => request('/rfqs/bulk', { method: 'POST', body: JSON.stringify(payload) }),
  ingestQuoteText: (rfqId, rawText) => {
    const formData = new URLSearchParams()
    formData.append('raw_text', rawText)
    return fetch(`${BASE}/rfqs/${rfqId}/ingest-quote`, { method: 'POST', body: formData })
      .then(async (res) => {
        if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
        return res.json()
      })
  },
  ingestQuoteFile: async (rfqId, file) => {
    const formData = new FormData()
    formData.append('file', file)
    const res = await fetch(`${BASE}/rfqs/${rfqId}/ingest-quote-file`, { method: 'POST', body: formData })
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
    return res.json()
  },
}
