import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ClientDirectory from './ClientDirectory';

const openNavigationMock = vi.fn();

vi.mock('@/lib/mapNavigation', () => ({
  openNavigation: (...args) => openNavigationMock(...args),
}));

const customers = [
  {
    _id: 'c2',
    full_name: 'Brent Carter',
    address: '3417 Silver Creek Ct',
    phone: '(408) 555-6314',
    service_day: 'Tuesday',
  },
  {
    _id: 'c1',
    full_name: 'Avery Mitchell',
    address: '712 Coral Reef Dr',
    phone: '(555) 211-9283',
    service_day: 'Monday',
  },
];

describe('ClientDirectory', () => {
  it('renders alphabetical groups and expands one contact action tray', () => {
    const onOpen = vi.fn();
    render(<ClientDirectory customers={customers} searchQuery="" onOpen={onOpen} />);

    const directory = screen.getByTestId('client-directory');
    expect(within(directory).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['A', 'B']);

    fireEvent.click(screen.getByTestId('directory-client-c2'));

    expect(screen.getByRole('link', { name: 'Call Brent Carter' })).toHaveAttribute('href', 'tel:(408) 555-6314');
    expect(screen.getByRole('link', { name: 'Text Brent Carter' })).toHaveAttribute('href', 'sms:(408) 555-6314');

    fireEvent.click(screen.getByRole('button', { name: 'Directions to Brent Carter' }));
    expect(openNavigationMock).toHaveBeenCalledWith('3417 Silver Creek Ct');

    fireEvent.click(screen.getByRole('button', { name: 'Open profile for Brent Carter' }));
    expect(onOpen).toHaveBeenCalledWith(customers[0]);
  });

  it('filters the directory and disables unavailable alphabet letters', () => {
    render(<ClientDirectory customers={customers} searchQuery="Avery" onOpen={vi.fn()} />);

    expect(screen.getByText('Avery Mitchell')).toBeInTheDocument();
    expect(screen.queryByText('Brent Carter')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jump to A' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'No clients under B' })).toBeDisabled();
  });
});
