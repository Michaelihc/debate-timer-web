/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Deployed to https://<user>.github.io/debate-timer-web/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/debate-timer-web/' : '/',
  plugins: [react()],
  build: {
    // The Unity sprites are CSS masks. Base64-inlining them would bloat the single
    // stylesheet by a third of their weight and re-download every sprite on every
    // CSS change; as hashed files they cache independently and forever.
    assetsInlineLimit: (filePath: string) => (filePath.includes('assets/icons/') ? false : undefined),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
