# P0 Session Isolation And Cloud WorkOrders Design

## Scope

WorkOrders is cloud-required for work orders, invoices, quotes, communications, reminders, and payment links. Browser storage must not be read or written for these records. The page distinguishes an unresolved business query from a business that is unavailable and prevents all record-mutating actions in either state.

## Session Isolation

Before local user state is restored for a newly authenticated account, the provider clears ChemCheck browser storage, IndexedDB, offline photos, and service-worker caches. Logout performs that same cleanup before calling Clerk `signOut`; cleanup failure rejects the logout operation so Settings remains signed in and displays its existing error state.

## Tests

Focused tests cover browser storage cleanup, account-switch cleanup sequencing, cleanup-failure signout blocking, and WorkOrders availability states and mutation guard behavior.
