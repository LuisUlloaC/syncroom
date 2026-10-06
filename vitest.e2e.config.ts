import {defineConfig} from 'vitest/config'

export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})
