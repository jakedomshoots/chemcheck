import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LsiDashboard from './LsiDashboard';

const customers = [{
  _id: 1,
  full_name: 'Jamie Rivera',
  service_day: 'Monday',
  pool_type: 'Chlorine',
}];

const logs = [{
  _id: 11,
  customer_id: 1,
  service_date: '2026-09-15',
  status: 'completed',
  service_type: 'Regular Cleaning',
  ph_value: 7.6,
  alkalinity_value: 90,
  stabilizer_value: 60,
  hardness_value: 300,
  hardness_source: 'calcium',
  water_temperature: 84,
  water_temperature_source: 'measured',
  tds_value: 1000,
  tds_source: 'measured',
}];

vi.mock('@/api/convexHooks', () => ({
  useCustomers: vi.fn(() => customers),
  useServiceLogs: vi.fn(() => logs),
}));

describe('LSI dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows each customer with the latest calculated LSI', () => {
    render(<MemoryRouter initialEntries={['/LSI']}><LsiDashboard /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'LSI history' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jamie Rivera/i })).toHaveTextContent('+0.01');
    expect(screen.getByText('With LSI').previousElementSibling).toHaveTextContent('1');
  });

  it('opens the selected customer visit history', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/LSI']}><LsiDashboard /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /Jamie Rivera/i }));
    expect(screen.getByText('Latest calculated visit')).toBeInTheDocument();
    expect(screen.getByText('Detailed')).toBeInTheDocument();
    expect(screen.getByText('Sep 15, 2026')).toBeInTheDocument();
  });

  it('keeps incomplete visits visible without assigning a score', () => {
    logs[0].hardness_value = undefined;
    render(<MemoryRouter initialEntries={['/LSI?customerId=1']}><LsiDashboard /></MemoryRouter>);
    expect(screen.getByText(/Missing hardness/)).toBeInTheDocument();
    expect(screen.getAllByText('Needs readings').length).toBeGreaterThan(0);
    logs[0].hardness_value = 300;
  });
});
