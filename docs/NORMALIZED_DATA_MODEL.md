# Normalized pool and equipment model

ChemCheck now treats a customer as the account and a `pools` row as the
serviceable asset. A customer can have multiple active pools; each pool owns
its own service day, gallons, surface, pool type, and notes. `equipment` rows
belong to a pool and carry lifecycle fields for pumps, filters, heaters, salt
cells, and controllers.

Legacy `customers.pool_*` fields remain readable during rollout so existing
screens and exports do not break. New customer creation creates a `Primary
Pool` locally and remotely. Existing data is migrated by running the internal
`migrations.backfillPoolsBatch` mutation until it reports `isDone: true`.

Service logs, chemical usage, notes, and salt-cell logs accept an optional
`pool_id`. The sync layer translates Convex IDs to local Dexie IDs and pulls
parents before children, so offline records remain usable across devices.

Recommended rollout:

1. Deploy the schema and run `backfillPoolsBatch` in batches of 100.
2. Verify pool counts equal customer counts for legacy accounts.
3. Start assigning new logs to `pool_id`; retain legacy fields for one release.
4. Add equipment records from the normalized hooks/API, then retire direct
   writes to customer pool fields once every report/export is pool-aware.
