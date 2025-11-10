import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/assets': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
      '/tiles': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
      },
    },
  },
})
