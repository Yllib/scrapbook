import path from 'node:path'
import { config as loadEnv } from 'dotenv'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const rootEnvDir = path.resolve(__dirname, '../../..')
loadEnv({ path: path.join(rootEnvDir, '.env') })
loadEnv({ path: path.join(rootEnvDir, '.env.local'), override: true })

const API_PROXY_TARGET = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: API_PROXY_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
