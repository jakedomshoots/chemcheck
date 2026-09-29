import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SimplifiedChemicalInput from './SimplifiedChemicalInput';
import { CHEMICAL_CONFIGS, getChemicalConfig } from '@/lib/chemStatus';

function renderInForm(config, numericValue, onSubmit = vi.fn()) {
  render(
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <SimplifiedChemicalInput
        label="Reading"
        value="good"
        onChange={vi.fn()}
        mode="numeric"
        numericValue={numericValue}
        onNumericValueChange={vi.fn()}
        config={config}
        testId="reading"
      />
      <button type="submit">Save</button>
    </form>
  );
  return screen.getByTestId('reading');
}

describe('SimplifiedChemicalInput numeric entry', () => {
  it('accepts out-of-ideal-range and fine-grained readings without native validation errors', () => {
    const cases = [
      [CHEMICAL_CONFIGS.ph, '8.6'],
      [CHEMICAL_CONFIGS.ph, '6.4'],
      [CHEMICAL_CONFIGS.chlorine, '1.2'],
      [CHEMICAL_CONFIGS.chlorine, '15'],
      [CHEMICAL_CONFIGS.alkalinity, '45'],
      [CHEMICAL_CONFIGS.alkalinity, '240'],
      [CHEMICAL_CONFIGS.stabilizer, '150'],
      [CHEMICAL_CONFIGS.stabilizer, '0'],
    ];
    for (const [config, value] of cases) {
      const input = renderInForm(config, value);
      expect(input).toHaveAttribute('step', 'any');
      expect(input.validity.valid).toBe(true);
      expect(input.checkValidity()).toBe(true);
      document.body.innerHTML = '';
    }
  });

  it('(sanity) the test environment enforces native step/range validation', () => {
    // The pre-fix attributes (ideal-range min/max, step 0.5) rejected these.
    render(<input data-testid="old" type="number" min={1} max={3} step={0.5} defaultValue="1.2" />);
    expect(screen.getByTestId('old').checkValidity()).toBe(false);
  });

  it('uses physically plausible bounds, not the ideal range, for the input', () => {
    const ph = renderInForm(CHEMICAL_CONFIGS.ph, '7.4');
    expect(ph).toHaveAttribute('min', '0');
    expect(ph).toHaveAttribute('max', '14');
  });

  it('allows the enclosing form to submit with an out-of-range value', () => {
    const onSubmit = vi.fn();
    renderInForm(CHEMICAL_CONFIGS.ph, '8.9', onSubmit);
    const form = screen.getByRole('button', { name: 'Save' }).closest('form');
    expect(form.checkValidity()).toBe(true);
    fireEvent.submit(form);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows the salt-pool CYA hint when given a salt config', () => {
    renderInForm(getChemicalConfig('stabilizer', 'Salt'), '70');
    expect(screen.getByText(/60-80 ppm/)).toBeInTheDocument();
  });

  it('prompts for a numeric reading when "Critical" is chosen in quick mode', () => {
    render(
      <SimplifiedChemicalInput
        label="pH"
        value="critical"
        onChange={vi.fn()}
        mode="quick"
        config={CHEMICAL_CONFIGS.ph}
      />
    );
    expect(screen.getByText(/raise or lower/)).toBeInTheDocument();
  });
});
