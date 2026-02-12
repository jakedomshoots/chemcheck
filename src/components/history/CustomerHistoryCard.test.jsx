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
});
