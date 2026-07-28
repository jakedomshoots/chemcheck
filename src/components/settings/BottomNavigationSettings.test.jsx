import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BottomNavigationSettings } from './BottomNavigationSettings';
import { BOTTOM_NAV_STORAGE_KEY } from '@/lib/bottomNavigation';

function storedItems() {
  return JSON.parse(localStorage.getItem(BOTTOM_NAV_STORAGE_KEY) || '{}').items;
}

describe('BottomNavigationSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reorders the live bottom menu and persists the result immediately', async () => {
    const user = userEvent.setup();
    render(<BottomNavigationSettings />);

    await user.click(screen.getByRole('button', { name: 'Move Notes earlier' }));

    expect(storedItems()).toEqual(['home', 'clients', 'notes', 'chemicals']);
    expect(screen.getByText('Notes moved to position 3.')).toBeInTheDocument();
  });

  it('moves destinations between the pinned menu and More while preserving safe bounds', async () => {
    const user = userEvent.setup();
    render(<BottomNavigationSettings />);

    expect(screen.getByRole('button', { name: 'Pin Work Orders' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Move Notes to More' }));
    await user.click(screen.getByRole('button', { name: 'Pin Work Orders' }));

    expect(storedItems()).toEqual(['home', 'clients', 'chemicals', 'workOrders']);
    expect(screen.getByRole('button', { name: 'Move Work Orders to More' })).toBeInTheDocument();
  });

  it('restores the default tool belt', async () => {
    const user = userEvent.setup();
    localStorage.setItem(BOTTOM_NAV_STORAGE_KEY, JSON.stringify({
      version: 1,
      items: ['workOrders', 'route'],
    }));
    render(<BottomNavigationSettings />);

    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(localStorage.getItem(BOTTOM_NAV_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole('button', { name: 'Move Notes to More' })).toBeInTheDocument();
  });
});
