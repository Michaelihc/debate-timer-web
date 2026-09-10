/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Deployed to https://<user>.github.io/debate-timer-web/
export default defineConfig({
  base: process.env.GITHUB_PAGES === 'true' ? '/debate-timer-web/' : '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
