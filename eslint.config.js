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
      // The codebase uses intentional one-shot setState-in-effect patterns
      // (seed-from-prop, reset-on-open) guarded by refs / boolean flags. The
      // upstream rule flags them as cascading-render risks but they fire at
      // most once per relevant prop change. Off-by-default to keep lint useful.
      'react-hooks/set-state-in-effect': 'off',
      // We export occasional small helpers from component files (e.g.
      // parseAdditionalContacts alongside AdditionalContactsField). The rule's
      // fast-refresh warning is too strict for our codebase shape.
      'react-refresh/only-export-components': 'off',
    },
  },
]);
