import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ReportPage from './ReportPage';

const mockGetReport = vi.fn();

vi.mock('convex/react', () => ({
  useAction: () => mockGetReport,
}));

function baseReport(overrides) {
  return {
    businessName: 'Acme Pools',
    serviceDate: '2026-06-16',
    technicianName: 'Acme Pools',
    customerName: 'Jane Doe',
    chemicalReadings: { ph: null, chlorine: null, alkalinity: null, stabilizer: null, salt: null },
    notes: null,
    overallStatus: 'not_tested',
    photos: { before: [], after: [] },
    serviceDuration: null,
    startTime: null,
    endTime: null,
    settings: {
      show_chemical_readings: true,
      show_photos: true,
      show_service_notes: true,
      show_technician_name: true,
      show_service_duration: true,
      show_overall_status: true,
    },
    ...overrides,
  };
}

function renderReport() {
  return render(
    <MemoryRouter initialEntries={['/report/00000000-0000-4000-8000-000000000000']}>
      <Routes>
        <Route path="/report/:reportId" element={<ReportPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ReportPage not tested readings', () => {
  beforeEach(() => mockGetReport.mockReset());

  it('never claims All Good when nothing was tested', async () => {
    mockGetReport.mockResolvedValue({ found: true, report: baseReport() });
    renderReport();

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(screen.queryByText('All Good')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs Attention')).not.toBeInTheDocument();
    expect(screen.getAllByText('Service Completed').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not tested')).toHaveLength(4);
  });

  it('renders a raw not_tested reading as "Not tested"', async () => {
    mockGetReport.mockResolvedValue({
      found: true,
      report: baseReport({
        overallStatus: 'good',
        chemicalReadings: { ph: 'good', chlorine: 'not_tested', alkalinity: 'good', stabilizer: 'not_tested', salt: null },
      }),
    });
    renderReport();

    expect(await screen.findByText('Jane Doe')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/not_tested/i);
    expect(screen.getAllByText('Not tested')).toHaveLength(2);
    expect(screen.getAllByText('All Good').length).toBeGreaterThan(0);
  });
});
