/**
 * Hooks re-export - redirects all imports to Dexie-based hooks
 * 
 * This file maintained for backwards compatibility.
 * All hooks now use Dexie/IndexedDB instead of Convex.
 */

export {
    // Customer hooks
    useCustomers,
    useCustomersFilter,
    useCustomer,
    useCustomerCreate,
    useCustomerUpdate,
    useCustomerDelete,

    // ServiceLog hooks
    useServiceLogs,
    useServiceLogsFilter,
    useServiceLogsByCustomer,
    useServiceLogCreate,
    useServiceLogUpdate,
    useServiceLogDelete,

    // ChemicalUsage hooks
    useChemicalUsage,
    useChemicalUsageFilter,
    useChemicalUsageCreate,
    useChemicalUsageUpdate,
    useChemicalUsageDelete,

    // Note hooks
    useNotes,
    useNotesFilter,
    useNoteCreate,
    useNoteUpdate,
    useNoteDelete,

    // Auth hook
    useCurrentUser,
} from './dexieHooks';
