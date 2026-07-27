import { describe, expect, it } from 'vitest';
import {
  getClientDirectoryLetter,
  getShortServiceDay,
  groupClientsForDirectory,
  matchesClientDirectorySearch,
} from './clientDirectory';

const customers = [
  { _id: 'c3', full_name: 'Émile Carter', address: '9 Cedar Ct', phone: '(555) 220-3000', service_day: 'Friday' },
  { _id: 'c1', full_name: 'Alice Smith', address: '123 Apple St', phone: '(555) 100-2000', service_day: 'Monday' },
  { _id: 'c2', full_name: 'Aaron Blake', address: '88 Bay Ave', phone: '', service_day: 'Thursday' },
  { _id: 'c4', full_name: '123 Pool Club', address: '1 Number Way', service_day: '' },
];

describe('client directory helpers', () => {
  it('groups clients alphabetically and sorts names within each group', () => {
    const groups = groupClientsForDirectory(customers);

    expect(groups.map((group) => group.letter)).toEqual(['#', 'A', 'E']);
    expect(groups[1].customers.map((customer) => customer.full_name)).toEqual([
      'Aaron Blake',
      'Alice Smith',
    ]);
  });

  it('searches names, phone numbers, addresses, and email fields', () => {
    expect(matchesClientDirectorySearch(customers[0], 'cedar')).toBe(true);
    expect(matchesClientDirectorySearch(customers[0], '220-3000')).toBe(true);
    expect(matchesClientDirectorySearch(customers[0], 'emile')).toBe(true);
    expect(matchesClientDirectorySearch({ email: 'pool@example.com' }, 'pool@')).toBe(true);
    expect(groupClientsForDirectory(customers, 'apple')).toHaveLength(1);
  });

  it('handles non-letter names and missing service days', () => {
    expect(getClientDirectoryLetter('123 Pool Club')).toBe('#');
    expect(getShortServiceDay('Wednesday')).toBe('Wed');
    expect(getShortServiceDay()).toBe('—');
  });
});
