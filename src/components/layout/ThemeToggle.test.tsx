import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import '@/lib/i18n';
import { useThemeStore } from '@/lib/stores/themeStore';
import { ThemeToggle } from './ThemeToggle';

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  useThemeStore.setState({ mode: 'system' });
});

describe('ThemeToggle', () => {
  it('renders a labeled theme control', () => {
    render(<ThemeToggle />);
    expect(screen.getByLabelText('Theme')).toBeInTheDocument();
  });

  it('shows the current mode label', () => {
    useThemeStore.setState({ mode: 'dark' });
    render(<ThemeToggle />);
    expect(screen.getByText('Dark')).toBeInTheDocument();
  });
});
