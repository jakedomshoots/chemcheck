import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useCustomers } from "@/api/dexieHooks";
import { WorkSheet } from "./workUi";

/** Contact line shown under the name: how the customer will receive the invoice. */
export function customerContact(customer) {
  if (customer?.email) return `Email · ${customer.email}`;
  if (customer?.phone) return `Text · ${customer.phone}`;
  return "No email or phone — you'll share the pay link";
}

/** Cloud id used by the tickets API (customers must be synced to be billable). */
export function customerCloudId(customer) {
  return typeof customer?.convex_id === "string" && customer.convex_id ? customer.convex_id : null;
}

export default function CustomerPicker({ open, onOpenChange, onPick }) {
  const customers = useCustomers();
  const [query, setQuery] = useState("");

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...(customers || [])]
      .filter((c) => c && c.full_name)
      .filter((c) => {
        if (!q) return true;
        return [c.full_name, c.email, c.phone, c.address].some((v) => String(v || "").toLowerCase().includes(q));
      })
      .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));
  }, [customers, query]);

  const unsyncedCount = sorted.filter((c) => !customerCloudId(c)).length;

  return (
    <WorkSheet open={open} onOpenChange={onOpenChange} title="Choose customer">
      <label className="relative mb-2 block">
        <span className="sr-only">Search customers</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email or phone"
          className="h-11 w-full rounded-control border border-line bg-surface-2 pl-9 pr-3 text-base text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490]"
        />
      </label>
      {unsyncedCount > 0 && (
        <p className="mb-1 px-1 text-[13px] text-ink-secondary">
          Customers marked “Not synced yet” were added offline. They can be billed once they sync to the cloud.
        </p>
      )}
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto" aria-label="Customers">
        {sorted.length === 0 ? (
          <li className="px-2 py-8 text-center text-[15px] text-ink-secondary">
            {query ? "No customers match." : "No customers yet. Add one in Clients first."}
          </li>
        ) : (
          sorted.map((c) => {
            const cloudId = customerCloudId(c);
            return (
              <li key={c.id ?? c._id ?? c.full_name}>
                <button
                  type="button"
                  disabled={!cloudId}
                  onClick={() => onPick(c)}
                  className="flex min-h-[52px] w-full flex-col items-start rounded-xl px-2 py-2.5 text-left hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0E7490] disabled:cursor-not-allowed"
                >
                  <span className={`text-base font-bold ${cloudId ? "text-ink" : "text-ink-secondary"}`}>{c.full_name}</span>
                  <span className="text-[13px] text-ink-secondary">
                    {cloudId ? customerContact(c) : "Not synced yet"}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </WorkSheet>
  );
}
