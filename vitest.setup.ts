import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

if (!import.meta.env.VITE_SUPABASE_URL) {
  Object.assign(import.meta.env, {
    VITE_SUPABASE_URL: 'https://test.supabase.co',
    VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  });
}

afterEach(() => {
  cleanup();
});
