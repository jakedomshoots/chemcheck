import { memo, useId, useMemo, useState } from "react";
import {
  ChevronDown,
  MapPin,
  MessageCircle,
  Phone,
  UserRound,
} from "lucide-react";
import {
  CLIENT_DIRECTORY_ALPHABET,
  getClientInitial,
  getShortServiceDay,
  groupClientsForDirectory,
} from "@/lib/clientDirectory";
import { openNavigation } from "@/lib/mapNavigation";
import { scrollElementIntoView } from "@/lib/scrollMotion";

const DirectoryAction = memo(function DirectoryAction({
  as: Element = "button",
  children,
  className = "",
  ...props
}) {
  return (
    <Element
      className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 px-2 py-2 text-[11px] font-semibold text-brand-ink transition-colors hover:bg-brand-softer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${className}`}
      {...props}
    >
      {children}
    </Element>
  );
});

const DirectoryRow = memo(function DirectoryRow({ customer, expanded, onToggle, onOpen }) {
  const customerId = String(customer._id ?? customer.id ?? "unknown");
  const actionsId = `client-directory-actions-${customerId}`;
  const name = customer.full_name || "Unnamed client";
  const phone = String(customer.phone || "").trim();
  const address = String(customer.address || "").trim();

  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        data-testid={`directory-client-${customerId}`}
        aria-expanded={expanded}
        aria-controls={actionsId}
        onClick={onToggle}
        className="flex min-h-[4.75rem] w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-brand-softer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand active:bg-brand-soft"
      >
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-ink"
        >
          {getClientInitial(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-semibold ${expanded ? "text-brand-ink" : "text-ink"}`}>
            {name}
          </span>
          <span className="mt-0.5 block truncate text-xs font-medium text-ink-muted">
            {phone || "No phone"}
            {address && <span aria-hidden="true"> · </span>}
            {address}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-ink-muted">
          {getShortServiceDay(customer.service_day)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`h-4 w-4 shrink-0 text-ink-muted transition-transform duration-150 ${expanded ? "rotate-180 text-brand-ink" : ""}`}
        />
      </button>

      {expanded && (
        <div
          id={actionsId}
          role="group"
          aria-label={`Contact actions for ${name}`}
          className="grid grid-cols-4 divide-x divide-line border-t border-line bg-surface-1"
        >
          {phone ? (
            <>
              <DirectoryAction as="a" href={`tel:${phone}`} aria-label={`Call ${name}`}>
                <Phone className="h-4 w-4" aria-hidden="true" />
                <span>Call</span>
              </DirectoryAction>
              <DirectoryAction as="a" href={`sms:${phone}`} aria-label={`Text ${name}`}>
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span>Text</span>
              </DirectoryAction>
            </>
          ) : (
            <>
              <DirectoryAction type="button" disabled aria-label={`Call unavailable for ${name}`} className="cursor-not-allowed opacity-35">
                <Phone className="h-4 w-4" aria-hidden="true" />
                <span>Call</span>
              </DirectoryAction>
              <DirectoryAction type="button" disabled aria-label={`Text unavailable for ${name}`} className="cursor-not-allowed opacity-35">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span>Text</span>
              </DirectoryAction>
            </>
          )}
          <DirectoryAction
            type="button"
            disabled={!address}
            aria-label={`Directions to ${name}`}
            className={!address ? "cursor-not-allowed opacity-35" : ""}
            onClick={() => openNavigation(address)}
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            <span>Directions</span>
          </DirectoryAction>
          <DirectoryAction type="button" aria-label={`Open profile for ${name}`} onClick={() => onOpen(customer)}>
            <UserRound className="h-4 w-4" aria-hidden="true" />
            <span className="hidden min-[430px]:inline">Open Profile</span>
            <span className="min-[430px]:hidden">Profile</span>
          </DirectoryAction>
        </div>
      )}
    </li>
  );
});

export default function ClientDirectory({ customers, searchQuery, onOpen }) {
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);
  const directoryId = useId().replace(/:/g, "");
  const groups = useMemo(
    () => groupClientsForDirectory(customers, searchQuery),
    [customers, searchQuery]
  );
  const availableLetters = useMemo(
    () => new Set(groups.map((group) => group.letter)),
    [groups]
  );

  const scrollToLetter = (letter) => {
    const section = document.getElementById(`${directoryId}-${letter === "#" ? "number" : letter}`);
    scrollElementIntoView(section, { block: "start" });
  };

  if (groups.length === 0) {
    return (
      <div
        data-testid="client-directory"
        className="mb-20 rounded-sheet border border-line bg-surface-1 px-5 py-10 text-center shadow-card"
      >
        <UserRound className="mx-auto mb-3 h-8 w-8 text-ink-muted" aria-hidden="true" />
        <h3 className="text-lg font-semibold tracking-[-0.03em] text-ink">
          {searchQuery ? "No matching clients" : "No clients yet"}
        </h3>
        <p className="mt-1 text-sm font-medium text-ink-muted">
          {searchQuery ? "Try a different name, phone, or address." : "Add a client to start your directory."}
        </p>
      </div>
    );
  }

  return (
    <section data-testid="client-directory" aria-label="Client directory" className="relative grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1">
      <div className="min-w-0 space-y-3">
        {groups.map((group) => (
          <section
            key={group.letter}
            id={`${directoryId}-${group.letter === "#" ? "number" : group.letter}`}
            data-directory-letter={group.letter}
            className="scroll-mt-20 [content-visibility:auto] [contain-intrinsic-size:auto_96px]"
            aria-labelledby={`${directoryId}-${group.letter}-heading`}
          >
            <h3
              id={`${directoryId}-${group.letter}-heading`}
              className="mb-1 px-2 text-lg font-semibold leading-7 text-ink-muted"
            >
              {group.letter}
            </h3>
            <ul className="overflow-hidden rounded-card border border-line bg-surface-1 shadow-card">
              {group.customers.map((customer) => {
                const customerId = String(customer._id ?? customer.id ?? "unknown");
                return (
                  <DirectoryRow
                    key={customerId}
                    customer={customer}
                    expanded={expandedCustomerId === customerId}
                    onToggle={() => setExpandedCustomerId((currentId) => currentId === customerId ? null : customerId)}
                    onOpen={onOpen}
                  />
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <nav aria-label="Client alphabet" className="sticky top-20 self-start py-7">
        <div className="flex flex-col items-center">
          {CLIENT_DIRECTORY_ALPHABET.map((letter) => {
            const isAvailable = availableLetters.has(letter);
            return (
              <button
                key={letter}
                type="button"
                disabled={!isAvailable}
                aria-label={isAvailable ? `Jump to ${letter}` : `No clients under ${letter}`}
                onClick={() => scrollToLetter(letter)}
                className="flex h-5 w-7 items-center justify-center rounded-chip text-[10px] font-semibold leading-none text-brand-ink transition-colors hover:bg-brand-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:text-ink-muted disabled:opacity-65"
              >
                {letter}
              </button>
            );
          })}
        </div>
      </nav>
    </section>
  );
}
