import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    
    // Prevent runaways
    watch: false,                    // Don't keep process alive
    run: true,                       // Exit after tests complete
    
    // Exclude e2e tests (run separately with playwright)
    exclude: [
      '**/e2e/**',
      '**/.worktrees/**',
    ],
    
    // Timeouts prevent infinite loops
    testTimeout: 10000,               // 10 seconds per test
    hookTimeout: 5000,                // 5 seconds per hook
    
    // Retry failed tests once (handles flaky tests)
    retry: 1,
    
    // Reporters - CI-friendly
    reporters: ['default'],
    
    // Coverage if needed (disable to speed up)
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
