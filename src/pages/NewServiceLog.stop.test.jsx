import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import NewServiceLog from './NewServiceLog';
import { BrowserRouter } from 'react-router-dom';

// Integration coverage for the at-the-stop features: dosing panel, equipment
// strip, reading sanity prompt. SimplifiedChemicalInput is real so numeric
// entry drives the dosing engine.
const mockUser = { email: 'test@example.com' };
const mockCustomers = [{
  _id: 1, full_name: 'Alice Smith', address: '123 St', pool_type: 'Chlorine', surface_type: 'Plaster', pool_gallons: 10000,
}];
const mockCreateServiceLog = vi.fn();
const mockCreateChemicalUsage = vi.fn();
const mockPreviousLogs = [];
const mockActivePoolEquipment = {
  pool: null,
  pools: [],
  equipment: [],
  classification: { filter: null, filterKind: null, saltCell: null, heater: null, pump: null, other: [], hasAny: false },
};

vi.mock('@/api/convexHooks', () => ({
  useCurrentUser: () => mockUser,
  useCustomers: () => mockCustomers,
  useServiceLogsByCustomerDateRange: () => [],
  useServiceLogsByCustomer: () => mockPreviousLogs,
  useServiceLogCreate: () => mockCreateServiceLog,
  useChemicalUsageCreate: () => mockCreateChemicalUsage,
}));

vi.mock('@/api/equipmentHooks', async () => {
  const actual = await vi.importActual('@/api/equipmentHooks');
  return {
    ...actual,
    useActivePoolEquipment: () => mockActivePoolEquipment,
  };
});

vi.mock('@/utils', () => ({
  createPageUrl: (page) => `/page/${page}`,
  formatServiceDate: (date) => date,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useBusinessSettings', () => ({
  useBusinessSettings: () => ({
    proofOfServiceSettings: { requirePhotos: false, requireBeforePhotos: false, requireAfterPhotos: false },
    isLoading: false,
  }),
}));

vi.mock('@/components/proof-of-service', () => ({
  PhotoCaptureSection: ({ title }) => <div>{title}</div>,
}));

vi.mock('@/lib/proof-of-service', () => ({
  deleteUnlinkedPhotos: vi.fn().mockResolvedValue(undefined),
  linkPhotosToServiceLog: vi.fn().mockResolvedValue(undefined),
  getPhotos: vi.fn().mockResolvedValue([]),
  validateServiceCompletion: () => ({ isValid: true, errors: [] }),
  getValidationErrorMessage: () => '',
  hasAnyRequirements: () => false,
  getRequirementsSummary: () => [],
}));

vi.mock('convex/react', () => ({
  useQuery: () => null,
}));

vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

function renderPage() {
  return render(<BrowserRouter><NewServiceLog /></BrowserRouter>);
}

function enterNumeric(index, testId, value) {
  const numericTabs = screen.getAllByRole('tab', { name: /^Numeric$/i });
  fireEvent.click(numericTabs[index]);
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
}

beforeEach(() => {
  mockCreateServiceLog.mockReset();
  mockCreateServiceLog.mockResolvedValue(1);
  mockCreateChemicalUsage.mockReset();
  mockCreateChemicalUsage.mockResolvedValue(5);
  mockPreviousLogs.length = 0;
  mockActivePoolEquipment.pool = null;
  mockActivePoolEquipment.equipment = [];
  mockActivePoolEquipment.classification = { filter: null, filterKind: null, saltCell: null, heater: null, pump: null, other: [], hasAny: false };
  window.localStorage.clear();
  window.history.pushState({}, 'Test Page', '/?customerId=1');
});

describe('Dosing at the stop', () => {
  it('shows the dosing panel once pH and chlorine are entered and updates live', () => {
    renderPage();
    expect(screen.queryByTestId('dosing-recommendations')).not.toBeInTheDocument();

    enterNumeric(0, 'ph-numeric-input', '7.0');
    expect(screen.queryByTestId('dosing-recommendations')).not.toBeInTheDocument();

    enterNumeric(1, 'chlorine-numeric-input', '3');
    const panel = screen.getByTestId('dosing-recommendations');
    expect(within(panel).getByRole('status')).toHaveTextContent('1 step: pH.');
    expect(within(panel).getByText('15 oz')).toBeInTheDocument();

    fireEvent.change(screen.getByTestId('ph-numeric-input'), { target: { value: '7.5' } });
    expect(within(panel).getByRole('status')).toHaveTextContent('Readings are in range');
  });

  it('logs recommended chemicals through the chemical usage path', async () => {
    renderPage();
    enterNumeric(0, 'ph-numeric-input', '7.0');
    enterNumeric(1, 'chlorine-numeric-input', '1');

    fireEvent.click(screen.getByRole('button', { name: 'Log these chemicals (2)' }));

    await waitFor(() => expect(mockCreateChemicalUsage).toHaveBeenCalledTimes(2));
    expect(mockCreateChemicalUsage.mock.calls[0][0]).toMatchObject({ customer_id: 1, chemical_type: 'Soda Ash', quantity: '15 oz' });
    expect(mockCreateChemicalUsage.mock.calls[1][0]).toMatchObject({ customer_id: 1, chemical_type: 'Liquid Chlorine', quantity: '21 fl oz' });
    expect(typeof mockCreateChemicalUsage.mock.calls[0][0].quantity).toBe('string');
  });
});

describe('Equipment-aware stop', () => {
  it('shows a generic checklist with an add-equipment link when nothing is recorded', () => {
    renderPage();
    const strip = screen.getByTestId('equipment-strip');
    expect(within(strip).getByRole('link', { name: /Add equipment on the client page/ }))
      .toHaveAttribute('href', expect.stringMatching(/customerdetail\?id=1#equipment$/i));
    expect(within(strip).getByText(/Check filter pressure/)).toBeInTheDocument();
    expect(screen.queryByTestId('salt-input')).not.toBeInTheDocument();
  });

  it('drives the checklist and the salt field from recorded equipment', () => {
    mockActivePoolEquipment.pool = { id: 4, name: 'Backyard', pool_type: 'Chlorine', surface_type: 'Plaster', pool_gallons: 15000, active: true };
    mockActivePoolEquipment.classification = {
      filter: { id: 1, equipment_type: 'filter', name: 'Cartridge', status: 'active' },
      filterKind: 'cartridge',
      saltCell: { id: 2, equipment_type: 'salt cell', name: 'AquaRite', status: 'active' },
      heater: { id: 3, equipment_type: 'heater', name: 'Raypak', status: 'active' },
      pump: null,
      other: [],
      hasAny: true,
    };
    renderPage();
    const strip = screen.getByTestId('equipment-strip');
    expect(within(strip).getByText('Clean cartridge (every 4 weeks)')).toBeInTheDocument();
    expect(within(strip).queryByText(/backwash/i)).not.toBeInTheDocument();
    expect(within(strip).getByText('Inspect salt cell and log the salt reading')).toBeInTheDocument();
    expect(within(strip).getByText('Check heater')).toBeInTheDocument();
    expect(within(strip).queryByRole('link', { name: /Add equipment/ })).not.toBeInTheDocument();
    // A salt cell on file exposes the salt reading even on a "Chlorine" customer.
    expect(screen.getByTestId('salt-input')).toBeInTheDocument();
  });

  it('saves the salt reading and pool id when a salt cell is recorded', async () => {
    mockActivePoolEquipment.pool = { id: 4, name: 'Backyard', pool_type: 'Salt', surface_type: 'Plaster', active: true };
    mockActivePoolEquipment.classification = { ...mockActivePoolEquipment.classification, saltCell: { id: 2, equipment_type: 'salt cell', name: 'Cell', status: 'active' }, hasAny: true };
    renderPage();
    fireEvent.change(screen.getByTestId('salt-input'), { target: { value: '3000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));
    await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
    expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({ salt: 3000, pool_id: 4 });
  });
});

describe('Reading sanity checks', () => {
  it('blocks saving on hard-invalid readings', async () => {
    mockActivePoolEquipment.classification = { ...mockActivePoolEquipment.classification, saltCell: { id: 2, equipment_type: 'salt cell', name: 'Cell', status: 'active' }, hasAny: true };
    renderPage();
    const salt = screen.getByTestId('salt-input');
    // Input bounds mirror the hard-invalid limits, so the browser stops the
    // submit first; checkReadingSanity remains the backstop behind it.
    expect(salt).toHaveAttribute('min', '0');
    expect(salt).toHaveAttribute('max', '20000');
    fireEvent.change(salt, { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockCreateServiceLog).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reading-sanity-prompt')).not.toBeInTheDocument();

    fireEvent.change(salt, { target: { value: '19000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));
    await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
    expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({ salt: 19000 });
  });

  it('lets out-of-range pH and CYA be typed and rejects impossible values with a message', async () => {
    renderPage();
    enterNumeric(0, 'ph-numeric-input', '15');
    enterNumeric(3, 'stabilizer-numeric-input', '10');
    expect(screen.getByTestId('ph-numeric-input')).toHaveAttribute('max', '14');
    expect(screen.getByTestId('stabilizer-numeric-input')).toHaveAttribute('min', '0');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));

    // Browser constraint validation blocks pH 15 before our check runs (max=14).
    expect(mockCreateServiceLog).not.toHaveBeenCalled();

    fireEvent.change(screen.getByTestId('ph-numeric-input'), { target: { value: '13.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));
    await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
    expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({ ph_value: 13.5, stabilizer_value: 10 });
  });

  it('asks for a double-check on a big jump and saves after confirmation', async () => {
    mockPreviousLogs.push({ _id: 9, service_date: '2026-09-20', ph_value: 7.4, chlorine_value: 3 });
    renderPage();
    enterNumeric(0, 'ph-numeric-input', '8.6');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));

    const prompt = await screen.findByTestId('reading-sanity-prompt');
    expect(within(prompt).getByText(/pH moved up from 7.4 last visit to 8.6/)).toBeInTheDocument();
    expect(mockCreateServiceLog).not.toHaveBeenCalled();

    fireEvent.click(within(prompt).getByRole('button', { name: 'Readings are correct, save' }));
    await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
    expect(mockCreateServiceLog.mock.calls[0][0]).toMatchObject({ ph_value: 8.6 });
  });

  it('lets the technician go back and fix the reading instead', async () => {
    mockPreviousLogs.push({ _id: 9, service_date: '2026-09-20', alkalinity_value: 100 });
    renderPage();
    enterNumeric(2, 'alkalinity-numeric-input', '200');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));

    const prompt = await screen.findByTestId('reading-sanity-prompt');
    fireEvent.click(within(prompt).getByRole('button', { name: 'Go back and fix' }));
    await waitFor(() => expect(screen.queryByTestId('reading-sanity-prompt')).not.toBeInTheDocument());
    expect(mockCreateServiceLog).not.toHaveBeenCalled();
  });

  it('saves straight through when readings are plausible', async () => {
    mockPreviousLogs.push({ _id: 9, service_date: '2026-09-20', ph_value: 7.4 });
    renderPage();
    enterNumeric(0, 'ph-numeric-input', '7.8');
    fireEvent.click(screen.getByRole('button', { name: 'Complete Service' }));
    await waitFor(() => expect(mockCreateServiceLog).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('reading-sanity-prompt')).not.toBeInTheDocument();
  });
});
