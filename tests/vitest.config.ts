import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': resolve(__dirname, 'stubs/cloudflare-workers.ts'),
    },
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: [],
  },
})
