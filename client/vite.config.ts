import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// In dev the app is served by Vite on 5173 while the mock runs on 4000.
// In production the Node server serves both from one origin.
const MOCK_URL = process.env.MOCK_URL || 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    proxy: {
      '/api': MOCK_URL,
      '/socket.io': { target: MOCK_URL, ws: true },
    },
  },
})
