import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Droplets, Phone, Mail, CalendarDays, Receipt, FileCheck, AlertTriangle } from "lucide-react";
import { PortalVisitCard } from "@/components/portal/PortalVisitCard";
import { ServiceRequestForm } from "@/components/portal/ServiceRequestForm";
import { formatMoney, formatVisitDate, isPortalToken } from "@/lib/portal";

const FAILURE_TITLES = {
  not_found: "This link isn't valid",
  expired: "This link has expired",
  revoked: "This link was turned off",
  disabled: "Portal unavailable",
  rate_limited: "Slow down a moment",
};

function Section({ id, icon: Icon, title, children }) {
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-base font-semibold text-ink">
        {Icon && <Icon className="h-4 w-4 text-ink-muted" aria-hidden="true" />}
        {title}
      </h2>
      {children}
    </section>
  );
}

function PortalShell({ children }) {
  return (
    <main className="min-h-screen bg-surface-0 px-4 pb-16 pt-6 font-sans">
      <div className="mx-auto w-full max-w-lg space-y-5">{children}</div>
    </main>
  );
}

/**
 * Public customer portal at /portal/:token. No auth; everything shown is
 * filtered server-side by the customer's report settings.
 */
export default function CustomerPortalPage() {
  const { token } = useParams();
  const getPortal = useAction(api.portal.getPortal);
  const requestService = useAction(api.portal.requestService);
  const [state, setState] = useState({ loading: true, result: null, error: null });

  useEffect(() => {
    let cancelled = false;
    if (!isPortalToken(token)) {
      setState({ loading: false, result: { found: false, failure_reason: "not_found", error: "This portal link is not valid." }, error: null });
      return undefined;
    }
    setState({ loading: true, result: null, error: null });
    getPortal({ token })
      .then((result) => {
        if (!cancelled) setState({ loading: false, result, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, result: null, error: error instanceof Error ? error.message : "Could not load your portal." });
      });
    return () => {
      cancelled = true;
    };
  }, [token, getPortal]);

  if (state.loading) {
    return (
      <PortalShell>
        <div aria-busy="true" aria-live="polite" className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-40 w-full" />
          <span className="sr-only">Loading your pool portal</span>
        </div>
      </PortalShell>
    );
  }

  if (state.error || !state.result?.found) {
    const reason = state.result?.failure_reason || "not_found";
    return (
      <PortalShell>
        <Card className="rounded-sheet border border-line bg-surface-1 p-6 text-center shadow-card">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-ink-muted">
            <AlertTriangle className="h-6 w-6" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-semibold text-ink">{state.error ? "Something went wrong" : FAILURE_TITLES[reason] || FAILURE_TITLES.not_found}</h1>
          <p className="mt-2 text-sm text-ink-secondary">{state.error || state.result?.error}</p>
        </Card>
      </PortalShell>
    );
  }

  const portal = state.result.portal;
  const hasInvoices = portal.open_invoices.length > 0;
  const hasQuotes = portal.quotes.length > 0;

  return (
    <PortalShell>
      <header className="rounded-sheet border border-line bg-surface-1 p-5 shadow-card">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
          <Droplets className="h-3.5 w-3.5" aria-hidden="true" />
          {portal.business.name}
        </p>
        <h1 className="text-2xl font-semibold tracking-[-0.04em] text-ink">Hi {portal.customer.first_name}</h1>
        <p className="mt-1 text-sm text-ink-secondary">Your pool is serviced on <span className="font-semibold text-ink">{portal.customer.service_day}s</span>.</p>
        {(portal.business.phone || portal.business.email) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {portal.business.phone && (
              <Button asChild size="sm" variant="outline" className="h-10 rounded-full border-line bg-surface-1 px-4 text-xs font-semibold text-ink-secondary">
                <a href={`tel:${portal.business.phone}`}>
                  <Phone className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Call
                </a>
              </Button>
            )}
            {portal.business.email && (
              <Button asChild size="sm" variant="outline" className="h-10 rounded-full border-line bg-surface-1 px-4 text-xs font-semibold text-ink-secondary">
                <a href={`mailto:${portal.business.email}`}>
                  <Mail className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                  Email
                </a>
              </Button>
            )}
          </div>
        )}
      </header>

      {hasInvoices && (
        <Section id="invoices" icon={Receipt} title="Open invoices">
          <ul className="space-y-2">
            {portal.open_invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface-1 px-4 py-3">
                <span>
                  <span className="block font-data text-base font-semibold text-ink">{formatMoney(invoice.total)}</span>
                  <span className="block text-xs text-ink-muted">{invoice.due_date ? `Due ${formatVisitDate(invoice.due_date)}` : "Due on receipt"}</span>
                </span>
                {invoice.payment_url ? (
                  <Button asChild size="sm" className="h-10 rounded-full bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
                    <a href={invoice.payment_url} target="_blank" rel="noreferrer">Pay now</a>
                  </Button>
                ) : (
                  <span className="text-xs text-ink-muted">Awaiting payment</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {hasQuotes && (
        <Section id="quotes" icon={FileCheck} title="Quotes awaiting your approval">
          <ul className="space-y-2">
            {portal.quotes.map((quote) => (
              <li key={quote.id} className="rounded-card border border-line bg-surface-1 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span>
                    <span className="block text-sm font-semibold text-ink">{quote.title}</span>
                    <span className="block text-xs text-ink-muted">
                      {quote.valid_until ? `Valid until ${formatVisitDate(quote.valid_until)}` : "No expiry"}
                      {quote.deposit_required ? ` · Deposit ${formatMoney(quote.deposit_required)}${quote.deposit_status === "paid" ? " paid" : ""}` : ""}
                    </span>
                  </span>
                  <span className="font-data text-base font-semibold text-ink">{formatMoney(quote.total)}</span>
                </div>
                {quote.deposit_payment_url && quote.deposit_status !== "paid" && (
                  <Button asChild size="sm" className="mt-2 h-10 w-full rounded-full bg-brand text-xs font-semibold text-white hover:bg-brand-strong">
                    <a href={quote.deposit_payment_url} target="_blank" rel="noreferrer">Pay deposit to approve</a>
                  </Button>
                )}
                {!quote.deposit_payment_url && (
                  <p className="mt-2 text-xs text-ink-secondary">Reply to your service provider to approve this quote.</p>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section id="visits" icon={CalendarDays} title="Recent visits">
        {portal.visits.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-ink-secondary">No visits recorded yet.</p>
        ) : (
          <ul className="space-y-2">
            {portal.visits.map((visit) => (
              <PortalVisitCard key={visit.id} visit={visit} />
            ))}
          </ul>
        )}
      </Section>

      {portal.allow_service_requests && (
        <Section id="request" title="Request service">
          <Card className="rounded-sheet border border-line bg-surface-1 p-4 shadow-card">
            <ServiceRequestForm onSubmit={(input) => requestService({ token, ...input })} />
          </Card>
          {portal.open_requests.length > 0 && (
            <ul className="space-y-1 text-sm text-ink-secondary" aria-label="Your open requests">
              {portal.open_requests.map((request) => (
                <li key={request.id} className="flex items-center justify-between gap-3 rounded-card bg-surface-2 px-3 py-2">
                  <span className="truncate">{request.title.replace(/^Customer request: /, "")}</span>
                  <span className="shrink-0 text-xs text-ink-muted">Requested</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      <footer className="pt-4 text-center text-xs text-ink-muted">
        This private link is just for you. Contact {portal.business.name} if you need a new one.
      </footer>
    </PortalShell>
  );
}
