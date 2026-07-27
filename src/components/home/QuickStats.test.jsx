import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import QuickStats from './QuickStats';

describe('QuickStats', () => {
  it('renders the route totals as one accessible summary', () => {
    render(<QuickStats total={4} completed={1} pending={3} />);

    expect(screen.getByRole('region', { name: 'Quick Statistics' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Done: 1' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Pending: 3' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Total: 4' })).toBeInTheDocument();
  });

  it('adds skipped work without making the summary wrap into a second row', () => {
    render(<QuickStats total={4} completed={1} pending={2} skipped={1} />);

    const summary = screen.getByRole('region', { name: 'Quick Statistics' });
    expect(summary).toHaveClass('grid-cols-4');
    expect(screen.getByRole('group', { name: 'Skipped: 1' })).toBeInTheDocument();
  });
});
