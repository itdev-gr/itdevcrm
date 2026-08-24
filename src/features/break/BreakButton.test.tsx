import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BreakButton } from './BreakButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

const useMyBreakToday = vi.fn();
vi.mock('./hooks/useMyBreakToday', () => ({
  useMyBreakToday: () => useMyBreakToday(),
}));

const startMutate = vi.fn();
const endMutate = vi.fn();
vi.mock('./hooks/useBreakToggle', () => ({
  useStartBreak: () => ({ mutate: startMutate, isPending: false }),
  useEndBreak: () => ({ mutate: endMutate, isPending: false }),
}));

describe('BreakButton', () => {
  beforeEach(() => {
    startMutate.mockClear();
    endMutate.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('idle: shows the full 30:00 allowance and starts a break on click', () => {
    useMyBreakToday.mockReturnValue({
      data: { active_started_at: null, total_seconds: 0 },
      isLoading: false,
    });
    render(<BreakButton />);
    expect(screen.getByText('30:00')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start break' }));
    expect(startMutate).toHaveBeenCalledOnce();
    expect(endMutate).not.toHaveBeenCalled();
  });

  it('on break: counts down live and ends the break on click', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-24T10:01:00Z'));
    useMyBreakToday.mockReturnValue({
      // Started one minute ago, 5 minutes already used earlier today.
      data: { active_started_at: '2026-08-24T10:00:00Z', total_seconds: 300 },
      isLoading: false,
    });
    render(<BreakButton />);
    // 30:00 - 5:00 closed - 1:00 live = 24:00 remaining.
    expect(screen.getByText('24:00')).toBeInTheDocument();
    expect(screen.getByText('On break')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('23:58')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'End break' }));
    expect(endMutate).toHaveBeenCalledOnce();
    expect(startMutate).not.toHaveBeenCalled();
  });

  it('over the allowance: shows the overage in red', () => {
    useMyBreakToday.mockReturnValue({
      data: { active_started_at: null, total_seconds: 2000 },
      isLoading: false,
    });
    render(<BreakButton />);
    // 2000 - 1800 = 200s over.
    const overage = screen.getByText('+3:20');
    expect(overage).toBeInTheDocument();
    expect(screen.getByRole('button').className).toContain('text-red-600');
  });

  it('while loading: renders disabled and does not fire mutations', () => {
    useMyBreakToday.mockReturnValue({ data: undefined, isLoading: true });
    render(<BreakButton />);
    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(startMutate).not.toHaveBeenCalled();
    expect(endMutate).not.toHaveBeenCalled();
  });
});
