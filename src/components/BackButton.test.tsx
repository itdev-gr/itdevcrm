import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/lib/i18n';
import { BackButton } from './BackButton';

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

function wrap(path: string) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <BackButton />
    </MemoryRouter>
  );
}

describe('BackButton', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    window.history.replaceState(null, '', '/');
  });

  it('renders the arrow icon and the Back label', () => {
    render(wrap('/deals/abc'));
    const btn = screen.getByRole('button', { name: /back/i });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector('svg')).toBeInTheDocument();
  });

  it('goes back one entry when in-app history exists', () => {
    window.history.replaceState({ idx: 2 }, '', '/deals/abc');
    render(wrap('/deals/abc'));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(navigateMock).toHaveBeenCalledWith(-1);
  });

  it('falls back to Home when there is no in-app history', () => {
    window.history.replaceState({ idx: 0 }, '', '/deals/abc');
    render(wrap('/deals/abc'));
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('renders nothing on the Home route', () => {
    render(wrap('/'));
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });
});
