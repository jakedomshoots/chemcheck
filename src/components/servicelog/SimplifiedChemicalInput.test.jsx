import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SimplifiedChemicalInput from './SimplifiedChemicalInput';

describe('SimplifiedChemicalInput', () => {
  it('records not tested explicitly instead of selecting a passing result', () => {
    const onChange = vi.fn();
    const onModeChange = vi.fn();

    render(
      <SimplifiedChemicalInput
        label="Chlorine"
        value="good"
        onChange={onChange}
        mode="quick"
        onModeChange={onModeChange}
        config={{ ranges: [] }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not tested' }));

    expect(onModeChange).toHaveBeenCalledWith('not_tested');
    expect(onChange).toHaveBeenCalledWith('not_tested');
  });

  it('shows the explicit untested state', () => {
    render(
      <SimplifiedChemicalInput
        label="Chlorine"
        value="not_tested"
        mode="not_tested"
        config={{ ranges: [] }}
      />,
    );

    expect(screen.getByText(/Not tested is recorded for this visit/i)).toBeInTheDocument();
  });
});
