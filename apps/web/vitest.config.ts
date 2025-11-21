import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    pool: 'vmThreads',
    setupFiles: ['vitest.setup.ts'],
  },
})
