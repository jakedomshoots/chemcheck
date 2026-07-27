export interface DirectoryCustomer {
  _id?: string;
  id?: string | number;
  full_name?: string;
  address?: string;
  phone?: string;
  email?: string;
  service_day?: string;
}

export interface ClientDirectoryGroup {
  letter: string;
  customers: DirectoryCustomer[];
}

export const CLIENT_DIRECTORY_ALPHABET = Object.freeze([
  '#',
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
]);

const CLIENT_DIRECTORY_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function normalizeSearchValue(value?: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim();
}

export function getClientDirectoryLetter(name?: string): string {
  const normalizedName = normalizeSearchValue(name).toLocaleUpperCase();
  const firstCharacter = normalizedName.charAt(0);
  return /^[A-Z]$/.test(firstCharacter) ? firstCharacter : '#';
}

export function matchesClientDirectorySearch(
  customer: DirectoryCustomer,
  query: string,
): boolean {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return true;

  return [customer.full_name, customer.address, customer.phone, customer.email]
    .some((value) => normalizeSearchValue(value).includes(normalizedQuery));
}

export function groupClientsForDirectory(
  customers: DirectoryCustomer[],
  query = '',
): ClientDirectoryGroup[] {
  const groupedCustomers = new Map<string, DirectoryCustomer[]>();

  customers
    .filter((customer) => matchesClientDirectorySearch(customer, query))
    .sort((a, b) => {
      const nameComparison = CLIENT_DIRECTORY_COLLATOR.compare(a.full_name || '', b.full_name || '');
      if (nameComparison !== 0) return nameComparison;

      return String(a._id ?? a.id ?? '').localeCompare(String(b._id ?? b.id ?? ''));
    })
    .forEach((customer) => {
      const letter = getClientDirectoryLetter(customer.full_name);
      const group = groupedCustomers.get(letter) || [];
      group.push(customer);
      groupedCustomers.set(letter, group);
    });

  return CLIENT_DIRECTORY_ALPHABET
    .map((letter) => ({ letter, customers: groupedCustomers.get(letter) || [] }))
    .filter((group) => group.customers.length > 0);
}

export function getClientInitial(name?: string): string {
  return getClientDirectoryLetter(name);
}

export function getShortServiceDay(serviceDay?: string): string {
  const normalizedDay = String(serviceDay || '').trim();
  return normalizedDay ? normalizedDay.slice(0, 3) : '—';
}
