import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const confettiMock = vi.hoisted(() => vi.fn());
const hapticMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('canvas-confetti', () => ({ default: confettiMock }));
vi.mock('@/lib/haptics', () => ({ hapticRouteComplete: hapticMock }));
vi.mock('@/components/ui/caustics', () => ({ CausticsCanvas: () => <canvas data-testid="caustics" /> }));

import { RouteCompleteCelebration } from './RouteCompleteCelebration';

function setReducedMotion(matches) {
  window.matchMedia = vi.fn().mockImplementation((query) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('RouteCompleteCelebration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setReducedMotion(false);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is a labelled modal dialog that traps focus and restores it on close', () => {
    const opener = document.createElement('button');
    opener.textContent = 'opener';
    document.body.appendChild(opener);
    opener.focus();

    const onClose = vi.fn();
    const { unmount } = render(<RouteCompleteCelebration completed={4} total={4} onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'Every pool is done.' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/4 of 4 stops logged/);

    const primary = screen.getByRole('button', { name: 'Back to the route' });
    expect(primary).toHaveFocus();

    // Tab from the last focusable wraps to the first (the backdrop dismiss button).
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: 'Dismiss celebration' })).toHaveFocus();
    // Shift+Tab from the first wraps back to the last.
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(primary).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    expect(opener).toHaveFocus();
  });

  it('fires confetti and haptics when motion is allowed', () => {
    render(<RouteCompleteCelebration completed={2} total={2} onClose={() => undefined} />);
    expect(hapticMock).toHaveBeenCalledTimes(1);
    expect(confettiMock).toHaveBeenCalled();
    expect(confettiMock.mock.calls[0][0]).toMatchObject({ disableForReducedMotion: true });
  });

  it('skips confetti under prefers-reduced-motion but keeps the haptic and the content', () => {
    setReducedMotion(true);
    render(<RouteCompleteCelebration completed={3} total={3} duration="2 hr" onClose={() => undefined} />);
    expect(confettiMock).not.toHaveBeenCalled();
    expect(hapticMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/about 2 hr on site/)).toBeInTheDocument();
    expect(screen.getByTestId('caustics').parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});
