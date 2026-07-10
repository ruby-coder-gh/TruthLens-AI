import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const backendTarget = process.env.VITE_BACKEND_URL || 'http://localhost:8000'
const frontendPort = Number(process.env.VITE_PORT || 5173)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: frontendPort,
    proxy: {
      '/api/': {
        target: backendTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
