import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Frontend calls /api/... and Vite forwards it to the FastAPI backend.
      // Change the target here if the backend ever runs on a different host/port.
      '/api': 'http://localhost:8000',
    },
  },
})
