import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import CustomerHistoryCard from './CustomerHistoryCard';

vi.mock('@/components/PoolAnalysisPanel', () => ({
  default: () => <div>Mock Pool Analysis</div>,
}));

vi.mock('@/components/service-reports', () => ({
  ServicePhotoGallery: () => <div>Mock Photo Gallery</div>,
}));

vi.mock('@/lib/proof-of-service', () => ({
  getPhotosByServiceLog: vi.fn().mockResolvedValue([]),
}));

describe('CustomerHistoryCard', () => {
  it('renders safely when logs are empty and shows filter message when expanded', () => {
    render(
      <CustomerHistoryCard
        customer={{ full_name: 'Alice Smith', address: '123 Main St' }}
        logs={[]}
        totalLogCount={2}
        lastServiceDate={null}
        onDeleteLog={vi.fn()}
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText(/Alice Smith/i)).toBeInTheDocument();
    expect(screen.getByText(/No logs/i)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Alice Smith/i));
    expect(screen.getByText(/No service logs match this filter/i)).toBeInTheDocument();
  });

  it('shows untested chemistry as "Not tested", never as Good or the raw token', () => {
    render(
      <CustomerHistoryCard
        customer={{ full_name: 'Alice Smith', address: '123 Main St' }}
        logs={[{
          _id: 'log-1',
          service_date: '2026-06-16',
          ph: 'not_tested',
          chlorine: 'not_tested',
          alkalinity: 'not_tested',
          stabilizer: 'not_tested',
        }]}
        totalLogCount={1}
        lastServiceDate="2026-06-16"
        onDeleteLog={vi.fn()}
        onClick={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText(/Alice Smith/i));
    fireEvent.click(screen.getByText('Jun 16, 2026'));

    expect(screen.getAllByText('Not tested').length).toBeGreaterThanOrEqual(5);
    expect(screen.queryByText('Good')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/not_tested/i);
  });
});

