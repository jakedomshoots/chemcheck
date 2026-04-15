export const WORKORDER_SECTIONS = ['dispatch', 'quotes', 'invoices', 'comms'] as const;

export type WorkOrderSection = (typeof WORKORDER_SECTIONS)[number];

export function normalizeWorkOrdersSection(
  value: string | null | undefined,
  fallback: WorkOrderSection = 'dispatch'
): WorkOrderSection {
  if (!value) return fallback;
  const normalized = value.toLowerCase();
  return (WORKORDER_SECTIONS as readonly string[]).includes(normalized)
    ? (normalized as WorkOrderSection)
    : fallback;
}

export function isWorkOrdersSplitEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem('chemcheck_ff_workorders_ia_split') !== 'false';
}

export function getDefaultWorkOrdersSectionFromStorage(): WorkOrderSection {
  if (typeof window === 'undefined') return 'dispatch';

  try {
    const rawUser = localStorage.getItem('chemcheck_current_user');
    const user = rawUser ? JSON.parse(rawUser) : null;
    const preferredFromUser = user?.preferences?.default_workorders_section;
    if (preferredFromUser) {
      return normalizeWorkOrdersSection(preferredFromUser);
    }
  } catch (error) {
    console.warn('Failed to parse current user for work-order section preference:', error);
  }

  try {
    const rawBusiness = localStorage.getItem('chemcheck_current_business');
    const business = rawBusiness ? JSON.parse(rawBusiness) : null;
    const preferredFromBusiness = business?.settings?.default_workorders_section
      || business?.settings?.defaultWorkordersSection;
    if (preferredFromBusiness) {
      return normalizeWorkOrdersSection(preferredFromBusiness);
    }
  } catch (error) {
    console.warn('Failed to parse current business for work-order section preference:', error);
  }

  return 'dispatch';
}
