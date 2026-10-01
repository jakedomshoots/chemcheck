import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import EquipmentStrip from './EquipmentStrip';
import { classifyEquipment } from '@/api/equipmentHooks';

const item = (overrides) => ({ customer_id: 1, pool_id: 1, status: 'active', equipment_type: 'other', name: 'Thing', ...overrides });

function renderStrip(props) {
  return render(
    <MemoryRouter>
      <EquipmentStrip customerId="1" pool={null} classification={classifyEquipment([])} poolType="Chlorine" {...props} />
    </MemoryRouter>,
  );
}

describe('EquipmentStrip', () => {
  it('shows a generic checklist and an add-equipment link when nothing is recorded', () => {
    renderStrip({ poolType: 'Salt' });
    expect(screen.getByRole('heading', { name: /Equipment & stop checklist/ })).toBeInTheDocument();
    expect(screen.getByText('No equipment recorded yet')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Add equipment on the client page/ });
    expect(link).toHaveAttribute('href', expect.stringMatching(/customerdetail\?id=1#equipment$/i));
    expect(link).toHaveClass('min-h-11');

    const checklist = within(screen.getByRole('list', { name: 'Stop checklist' }));
    expect(checklist.getByText(/Check filter pressure; clean or backwash/)).toBeInTheDocument();
    expect(checklist.getByText(/Inspect salt cell for scale/)).toBeInTheDocument();
    expect(checklist.queryByText(/Clean cartridge/)).not.toBeInTheDocument();
  });

  it('renders equipment chips and type-specific tasks', () => {
    const classification = classifyEquipment([
      item({ id: 1, equipment_type: 'filter', name: 'Cartridge', model: 'CCP420' }),
      item({ id: 2, equipment_type: 'salt cell', name: 'AquaRite' }),
      item({ id: 3, equipment_type: 'heater', name: 'Raypak' }),
      item({ id: 4, equipment_type: 'pump', name: 'VS pump' }),
    ]);
    renderStrip({ classification, pool: { name: 'Main pool' }, poolType: 'Salt' });

    expect(screen.getByText(/Main pool · 4 items on file/)).toBeInTheDocument();
    const chips = within(screen.getByRole('list', { name: 'Recorded equipment' }));
    expect(chips.getByText('Cartridge filter')).toBeInTheDocument();
    expect(chips.getByText('· CCP420')).toBeInTheDocument();
    expect(chips.getByText('Salt cell')).toBeInTheDocument();
    expect(chips.getByText('Heater')).toBeInTheDocument();
    expect(chips.getByText('Pump')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add equipment/ })).not.toBeInTheDocument();

    const checklist = within(screen.getByRole('list', { name: 'Stop checklist' }));
    expect(checklist.getByText('Clean cartridge (every 4 weeks)')).toBeInTheDocument();
    expect(checklist.queryByText(/backwash/i)).not.toBeInTheDocument();
    expect(checklist.getByText('Inspect salt cell and log the salt reading')).toBeInTheDocument();
    expect(checklist.getByText('Check heater')).toBeInTheDocument();
    expect(checklist.getByText('Check pump and lid o-ring')).toBeInTheDocument();
  });

  it('uses backwash tasks for D.E. and sand filters', () => {
    renderStrip({ classification: classifyEquipment([item({ id: 1, equipment_type: 'filter', name: 'D.E.' })]) });
    expect(screen.getByText(/Backwash D\.E\. filter/)).toBeInTheDocument();
  });

  it('tracks completed tasks with 44px targets and a live counter', () => {
    renderStrip({});
    const checklist = within(screen.getByRole('list', { name: 'Stop checklist' }));
    const boxes = checklist.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(2);
    expect(boxes[0].closest('label')).toHaveClass('min-h-11');
    expect(screen.getByText(`0/${boxes.length} done`)).toBeInTheDocument();
    fireEvent.click(boxes[0]);
    expect(boxes[0]).toBeChecked();
    expect(screen.getByText(`1/${boxes.length} done`)).toBeInTheDocument();
  });
});
