import { defineConfig } from 'vitest/config'

// Standalone Vitest config — intentionally does NOT pull in the React or
// vite-plugin-singlefile plugins used by vite.config.ts. The unit tests target
// pure modules (Decoder) and the store (which needs a DOM for localStorage /
// timers / Blob), so jsdom is the only environment requirement.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    globals: false,
    clearMocks: true,
  },
})
