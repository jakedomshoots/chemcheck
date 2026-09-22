import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LsiReadingFields from './LsiReadingFields';

describe('LSI reading controls', () => {
  it('collapses again after the detailed controls are opened', () => {
    render(<LsiReadingFields formData={{}} setFormData={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Enter detailed LSI readings/i }));
    expect(screen.getByRole('button', { name: /Collapse LSI details/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('radio', { name: /Not logged/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Collapse LSI details/i }));
    expect(screen.queryByRole('radio', { name: /Not logged/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enter detailed LSI readings/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('removes stale hardness when the user chooses Not logged', () => {
    const formData = {
      ph_value: 7.4,
      alkalinity_value: 100,
      stabilizer_value: 50,
      hardness_value: 300,
      hardness_source: 'calcium',
      water_temperature: 82,
      water_temperature_source: 'measured',
      tds_value: 1200,
      tds_source: 'measured',
      salt: '',
      strip_scan_method: '',
    };
    const setFormData = vi.fn();

    render(<LsiReadingFields formData={formData} setFormData={setFormData} />);
    fireEvent.click(screen.getByRole('button', { name: /Adjust LSI details/i }));
    fireEvent.click(screen.getByRole('radio', { name: /Not logged/i }));

    const update = setFormData.mock.calls.at(-1)[0];
    expect(update(formData)).toMatchObject({
      hardness_source: '',
      hardness_value: '',
    });
  });
});
