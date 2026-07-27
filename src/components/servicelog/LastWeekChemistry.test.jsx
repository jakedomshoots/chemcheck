import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import LastWeekChemistry from './LastWeekChemistry';

describe('LastWeekChemistry', () => {
  it('prefers numeric readings and falls back to stored status values', () => {
    render(
      <LastWeekChemistry
        log={{
          service_date: '2026-07-20',
          ph: 'good',
          ph_value: 7.4,
          chlorine: 'low',
          alkalinity: 'good',
          alkalinity_value: 100,
          stabilizer: 'high',
        }}
      />
    );

    const chart = screen.getByRole('region', { name: "Last week's chemistry" });
    expect(within(chart).getByText('Jul 20')).toBeInTheDocument();
    expect(within(screen.getByTestId('last-week-ph')).getByText('7.4')).toBeInTheDocument();
    expect(within(screen.getByTestId('last-week-chlorine')).getByText('Low')).toBeInTheDocument();
    expect(within(screen.getByTestId('last-week-alkalinity')).getByText('100')).toBeInTheDocument();
    expect(within(screen.getByTestId('last-week-stabilizer')).getByText('High')).toBeInTheDocument();
    expect(screen.getByTestId('last-week-chlorine-value')).toHaveClass('bg-[var(--status-watch-soft)]');
  });

  it('renders a compact empty state when last week has no service log', () => {
    render(<LastWeekChemistry log={null} />);

    expect(screen.getByRole('region', { name: "Last week's chemistry" })).toHaveTextContent(
      'No readings recorded'
    );
  });
});
