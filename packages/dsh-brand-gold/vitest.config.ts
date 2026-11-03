/** Vitest setup for the browser-half smoke tests (jsdom, no build step). */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.tsx'],
  },
})
