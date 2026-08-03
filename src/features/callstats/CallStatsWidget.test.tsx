import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }) }));
const useMyCallStats = vi.fn();
vi.mock('./hooks/useMyCallStats', () => ({ useMyCallStats: () => useMyCallStats() }));

import { CallStatsWidget } from './CallStatsWidget';

describe('CallStatsWidget', () => {
  it('renders nothing when there is no row', () => {
    useMyCallStats.mockReturnValue({ data: null });
    const { container } = render(<CallStatsWidget />);
    expect(container.firstChild).toBeNull();
  });

  it('shows counters when data is present', () => {
    useMyCallStats.mockReturnValue({ data: { extension: '207', total: 23, missed: 4, talk_seconds: 4320, recent: [] } });
    render(<CallStatsWidget />);
    expect(screen.getByText('23')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText('1:12:00')).toBeTruthy();
  });
});
