import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import DosingRecommendations from './DosingRecommendations';

const baseProps = {
  poolGallons: 10000,
  poolType: 'Chlorine',
  surfaceType: 'Plaster',
};

describe('DosingRecommendations', () => {
  it('renders nothing until pH and chlorine are entered', () => {
    const { container, rerender } = render(
      <DosingRecommendations {...baseProps} readings={{ ph_value: 7.2 }} />,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(<DosingRecommendations {...baseProps} readings={{ ph_value: 7.2, chlorine_value: 1 }} />);
    expect(screen.getByRole('heading', { name: 'Dosing for this visit' })).toBeInTheDocument();
  });

  it('lists ordered steps with amounts, targets and a live summary', () => {
    render(
      <DosingRecommendations
        {...baseProps}
        readings={{ ph_value: 7.9, chlorine_value: 0.5, alkalinity_value: 100, stabilizer_value: 40, hardness_value: 300 }}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('2 steps: free chlorine, pH.');

    const items = within(screen.getByRole('list', { name: 'Dose steps in order' })).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent(/1\.\s*Raise free chlorine/);
    expect(items[0]).toHaveTextContent('0.5 ppm → 3–5 ppm');
    expect(items[1]).toHaveTextContent(/2\.\s*Lower pH/);
    expect(items[1]).toHaveTextContent('muriatic acid 31.45%');
    expect(items[1]).toHaveTextContent('24 fl oz');
    expect(screen.getByRole('list', { name: 'Safety notes' })).toHaveTextContent(/add the chlorine product first/);
  });

  it('updates live when readings change', () => {
    const { rerender } = render(
      <DosingRecommendations {...baseProps} readings={{ ph_value: 7.5, chlorine_value: 3 }} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Readings are in range');

    rerender(<DosingRecommendations {...baseProps} readings={{ ph_value: 7.0, chlorine_value: 3 }} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 step: pH.');
    expect(screen.getByText('soda ash (sodium carbonate)')).toBeInTheDocument();
  });

  it('explains missing gallons and missing readings', () => {
    render(
      <DosingRecommendations
        readings={{ ph_value: 7.0, chlorine_value: 1 }}
        poolGallons={null}
        poolType="Salt"
      />,
    );
    expect(screen.getByText(/Pool size is missing/)).toBeInTheDocument();
    expect(screen.getByText(/Not dosed \(no reading\): total alkalinity, CYA, calcium hardness, salt/)).toBeInTheDocument();
    expect(screen.getAllByText(/Enter pool gallons/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Log these chemicals/ })).not.toBeInTheDocument();
  });

  it('tracks per-step done checkboxes with accessible 44px targets', () => {
    render(
      <DosingRecommendations {...baseProps} readings={{ ph_value: 7.0, chlorine_value: 1 }} />,
    );
    const checkbox = screen.getByRole('checkbox', { name: 'Done: step 1, pH' });
    expect(checkbox.closest('label')).toHaveClass('min-h-11', 'min-w-11');
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(checkbox.closest('li')).toHaveClass('opacity-60');
  });

  it('pre-fills the chemical usage flow with one entry per dosed step', async () => {
    const onLogChemicals = vi.fn().mockResolvedValue(undefined);
    render(
      <DosingRecommendations
        {...baseProps}
        readings={{ ph_value: 7.0, chlorine_value: 1, stabilizer_value: 40 }}
        onLogChemicals={onLogChemicals}
      />,
    );

    const button = screen.getByRole('button', { name: 'Log these chemicals (2)' });
    expect(button).toHaveClass('h-11');
    fireEvent.click(button);

    await waitFor(() => expect(onLogChemicals).toHaveBeenCalledTimes(1));
    const entries = onLogChemicals.mock.calls[0][0];
    expect(entries).toEqual([
      expect.objectContaining({ chemical_type: 'Soda Ash', quantity: '15 oz' }),
      expect.objectContaining({ chemical_type: 'Liquid Chlorine', quantity: '32 fl oz' }),
    ]);
    expect(entries[0].notes).toMatch(/pH 7 → 7.4–7.6/);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Chemicals logged' })).toBeDisabled());
  });
});
