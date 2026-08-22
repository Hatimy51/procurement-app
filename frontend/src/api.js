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
}
