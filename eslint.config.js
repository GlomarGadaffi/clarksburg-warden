import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Test files: enable Node + browser globals. Vitest helpers (describe/it/
    // expect/vi) are imported explicitly from 'vitest' (globals: false in
    // vitest.config.ts), so no test-runner globals override is required.
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
])
