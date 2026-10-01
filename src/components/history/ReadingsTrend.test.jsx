import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReadingsTrend from './ReadingsTrend';

const NOW = '2026-09-30';

const logs = [
  { _id: 1, service_date: '2026-09-29', ph_value: 7.4, chlorine_value: 3, alkalinity_value: 100, stabilizer_value: 40 },
  { _id: 2, service_date: '2026-09-22', ph_value: 7.9, chlorine_value: 1, alkalinity_value: 110 },
  { _id: 3, service_date: '2026-09-15', ph_value: 7.7, chlorine_value: 2 },
  { _id: 4, service_date: '2026-06-01', ph_value: 7.0, chlorine_value: 5 },
];

const usage = [
  { _id: 11, created_date: '2026-09-22', chemical_type: 'Muriatic Acid', quantity: '24 fl oz' },
  { _id: 12, created_date: '2026-09-22', chemical_type: 'Liquid Chlorine', quantity: '32 fl oz' },
  { _id: 13, created_date: '2026-06-01', chemical_type: 'Soda Ash', quantity: '1 lb' },
];

describe('ReadingsTrend', () => {
  it('renders an accessible SVG chart per metric with dose markers and a table fallback', () => {
    render(<ReadingsTrend serviceLogs={logs} chemicalUsage={usage} poolType="Chlorine" surfaceType="Plaster" now={NOW} />);

    expect(screen.getByRole('heading', { name: 'Readings trend' })).toBeInTheDocument();
    expect(screen.getByText('3 visits · 1 dose day · last 90 days')).toBeInTheDocument();

    const phChart = screen.getByRole('img', { name: /pH trend: 3 readings in 90 days, latest 7.4 on 2026-09-29, target 7.4 to 7.6/ });
    expect(phChart.tagName.toLowerCase()).toBe('svg');
    expect(phChart).toHaveAttribute('viewBox', '0 0 320 120');
    expect(phChart.querySelectorAll('circle')).toHaveLength(3);
    expect(phChart.querySelectorAll('[data-testid="dose-marker"]')).toHaveLength(1);
    expect(phChart.querySelector('path')).toHaveAttribute('stroke', 'var(--brand)');
    expect(phChart.querySelector('rect')).toHaveAttribute('fill', 'var(--status-ok-soft)');

    expect(screen.getByRole('img', { name: /Free chlorine trend/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Total alkalinity trend: 2 readings/ })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Salt trend/ })).not.toBeInTheDocument();

    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    // header + three visit dates
    expect(rows).toHaveLength(4);
    expect(within(table).getByRole('rowheader', { name: '2026-09-22' })).toBeInTheDocument();
    expect(within(table).getByText('Muriatic Acid 24 fl oz; Liquid Chlorine 32 fl oz')).toBeInTheDocument();
    expect(screen.getByText('Data table').closest('details')).toBeInTheDocument();
  });

  it('switches the window with the range toggle', () => {
    render(<ReadingsTrend serviceLogs={logs} chemicalUsage={usage} now={NOW} />);
    const toggle = screen.getByRole('tablist', { name: 'Trend range' });
    expect(within(toggle).getByRole('tab', { name: '90d' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(toggle).getByRole('tab', { name: '365d' }));
    expect(screen.getByText('4 visits · 2 dose days · last 365 days')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /pH trend: 4 readings in 365 days/ })).toBeInTheDocument();

    fireEvent.click(within(toggle).getByRole('tab', { name: '30d' }));
    expect(screen.getByText('3 visits · 1 dose day · last 30 days')).toBeInTheDocument();
  });

  it('shows an empty state when no numeric readings exist in the window', () => {
    render(<ReadingsTrend serviceLogs={[{ _id: 9, service_date: '2026-09-20', ph: 'good' }]} now={NOW} />);
    expect(screen.getByText(/No numeric readings in this window/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('No rows in this window.')).toBeInTheDocument();
  });

  it('surfaces rule-based hints and drift chips', () => {
    const rising = [0, 1, 2, 3, 4].map((i) => ({
      _id: i,
      service_date: `2026-09-${String(2 + i * 7).padStart(2, '0')}`,
      ph_value: 7.3 + i * 0.15,
      alkalinity_value: 150,
    }));
    render(<ReadingsTrend serviceLogs={rising} now={NOW} />);
    expect(screen.getByRole('list', { name: 'Trend hints' })).toHaveTextContent(/High TA drives pH up/);
    expect(screen.getByRole('list', { name: 'Drift summary' })).toHaveTextContent(/pH rising/);
  });
});
