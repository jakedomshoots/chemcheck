import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { RouteScrollManager } from './RouteScrollManager';

function ScrollHarness() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <RouteScrollManager />
      <p>{location.pathname}</p>
      <button type="button" onClick={() => navigate('/second')}>Next</button>
      <button type="button" onClick={() => navigate(-1)}>Back</button>
    </>
  );
}

describe('RouteScrollManager', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value: 0 });
    window.requestAnimationFrame = vi.fn((callback) => {
      callback(0);
      return 1;
    });
    window.cancelAnimationFrame = vi.fn();
    window.scrollTo = vi.fn((options) => {
      window.scrollY = typeof options === 'object' ? options.top || 0 : 0;
    });
  });

  it('starts pushed routes at the top and restores the prior position on Back', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/first']}>
        <ScrollHarness />
      </MemoryRouter>
    );

    expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 0, behavior: 'auto' });

    window.scrollY = 420;
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('/second')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 0, behavior: 'auto' });

    window.scrollY = 90;
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('/first')).toBeInTheDocument();
    expect(window.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 420, behavior: 'auto' });
  });
});
