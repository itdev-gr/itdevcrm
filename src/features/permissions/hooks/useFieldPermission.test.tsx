import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./useFieldPermissionsAll', () => ({
  useFieldPermissionsAll: vi.fn(),
}));

import { useFieldPermissionsAll } from './useFieldPermissionsAll';
import { useFieldPermission } from './useFieldPermission';

function wrap(c: ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{c}</QueryClientProvider>;
}

describe('useFieldPermission', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns editable when no rules apply', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({ data: [] });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('editable');
  });

  it('returns hidden when a user-scope rule is hidden', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          scope_type: 'user',
          scope_id: 'u',
          table_name: 'clients',
          field_name: 'phone',
          mode: 'hidden',
        },
      ],
    });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('hidden');
  });

  it('user rule wins over group rule', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          scope_type: 'group',
          scope_id: 'g',
          table_name: 'clients',
          field_name: 'phone',
          mode: 'hidden',
        },
        {
          scope_type: 'user',
          scope_id: 'u',
          table_name: 'clients',
          field_name: 'phone',
          mode: 'readonly',
        },
      ],
    });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('readonly');
  });

  it('most-restrictive wins among group rules', () => {
    (useFieldPermissionsAll as ReturnType<typeof vi.fn>).mockReturnValue({
      data: [
        {
          scope_type: 'group',
          scope_id: 'g1',
          table_name: 'clients',
          field_name: 'phone',
          mode: 'readonly',
        },
        {
          scope_type: 'group',
          scope_id: 'g2',
          table_name: 'clients',
          field_name: 'phone',
          mode: 'hidden',
        },
      ],
    });
    const { result } = renderHook(() => useFieldPermission('clients', 'phone'), {
      wrapper: ({ children }) => wrap(children),
    });
    expect(result.current).toBe('hidden');
  });
});
