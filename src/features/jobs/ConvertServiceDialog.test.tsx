import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k,
  }),
}));
const mutate = vi.fn();
vi.mock('./hooks/useConvertJobService', () => ({
  useConvertJobService: () => ({ mutate, isPending: false }),
}));

import { ConvertServiceDialog } from './ConvertServiceDialog';

describe('ConvertServiceDialog', () => {
  it('lists valid targets for a web_seo job', () => {
    render(
      <ConvertServiceDialog
        job={{ id: 'j1', service_type: 'web_seo', parent_job_id: null }}
        open
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('local_seo')).toBeTruthy();
    expect(screen.queryByText('web_dev')).toBeNull();
  });
});
