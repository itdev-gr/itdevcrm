import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier'; // + Task 3

export default defineConfig([
  // + Task 3 (added 3 entries); + Task 12 (ignore edge functions)
  globalIgnores([
    'dist',
    'playwright-report',
    'coverage',
    'src/types/supabase.ts',
    'supabase/functions/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      prettier, // + Task 3 (must come last to disable formatting rules)
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // + Task 3
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]);
