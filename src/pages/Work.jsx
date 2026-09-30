import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAction, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import WorkFeed from "@/components/work/WorkFeed";
import NewTicket from "@/components/work/NewTicket";
import SentScreen from "@/components/work/SentScreen";
import TicketDetail from "@/components/work/TicketDetail";
import ScheduleDetail from "@/components/work/ScheduleDetail";
import { normalizeFilter, workPaths } from "@/components/work/workFormat";

/** Legacy Work Orders sections map onto the closest feed filter. */
const LEGACY_SECTION_FILTERS = {
  dispatch: "all",
  quotes: "quote",
  invoices: "open",
  comms: "all",
};

const SQUARE_RETURN_PARAMS = ["square_payment", "invoice_id", "quote_id", "transactionId", "orderId", "checkoutId", "referenceId"];

/**
 * Legacy Square checkout returns (/workorders?square_payment=…&invoice_id=…) still
 * land here for invoices sent before tickets existed: confirm the payment, then
 * drop the one-off query params.
 */
function useLegacyPaymentReturn() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const syncPaymentStatus = useAction(api.payments.syncPaymentStatus);
  const paymentStatus = searchParams.get("square_payment");
  const invoiceId = searchParams.get("invoice_id");
  const quoteId = searchParams.get("quote_id");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const resolvingLegacyInvoice =
      location.pathname.toLowerCase().startsWith(`${workPaths.feed()}/invoices`) && Boolean(invoiceId);
    if (resolvingLegacyInvoice) return;
    if (!paymentStatus && !invoiceId && !quoteId) return;

    if (paymentStatus === "invoice_success" || paymentStatus === "deposit_success") {
      const target =
        paymentStatus === "invoice_success" ? (invoiceId ? { invoice_id: invoiceId } : null) : quoteId ? { quote_id: quoteId } : null;
      const done = (message) => {
        if (mountedRef.current) toast.success(message);
      };
      if (target) {
        Promise.resolve()
          .then(() => syncPaymentStatus(target))
          .then((result) =>
            done(result?.success && result?.synced ? "Payment received and synced." : "Payment received. Final confirmation may take a minute.")
          )
          .catch(() => done("Payment received. Final confirmation may take a minute."));
      } else {
        done(paymentStatus === "invoice_success" ? "Invoice payment received." : "Deposit payment received.");
      }
    }

    // Drop the one-off return params (runs once per legacy return URL).
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        SQUARE_RETURN_PARAMS.forEach((key) => next.delete(key));
        return next;
      },
      { replace: true }
    );
  }, [paymentStatus, invoiceId, quoteId, location.pathname]);
}

/** Back that stays inside the app: pops history when we pushed it, otherwise goes to the feed. */
function useWorkBack() {
  const navigate = useNavigate();
  const location = useLocation();
  return (fallback = workPaths.feed()) => {
    if (location.key && location.key !== "default" && window.history.length > 1) {
      navigate(-1);
    } else {
      navigate(fallback, { replace: true });
    }
  };
}

function FeedRoute() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = normalizeFilter(searchParams.get("filter"));

  return (
    <WorkFeed
      filter={filter}
      onFilterChange={(next) =>
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev);
            if (next === "all") params.delete("filter");
            else params.set("filter", next);
            return params;
          },
          { replace: true }
        )
      }
      onNew={() => navigate(workPaths.newTicket())}
      onOpenTicket={(id) => navigate(workPaths.ticket(id))}
      onOpenSchedule={(id) => navigate(workPaths.schedule(id))}
    />
  );
}

function NewRoute() {
  const navigate = useNavigate();
  const back = useWorkBack();
  return (
    <NewTicket
      onClose={() => back()}
      onDone={(sent) => navigate(workPaths.sent(), { replace: true, state: { sent } })}
    />
  );
}

function SentRoute() {
  const location = useLocation();
  const back = useWorkBack();
  const sent = location.state?.sent;
  if (!sent) return <Navigate to={workPaths.feed()} replace />;
  return <SentScreen sent={sent} onDone={() => back()} />;
}

function TicketRoute() {
  const { ticketId } = useParams();
  const back = useWorkBack();
  return <TicketDetail key={ticketId} ticketId={ticketId} onBack={() => back()} onDeleted={() => back()} />;
}

function ScheduleRoute() {
  const { scheduleId } = useParams();
  const navigate = useNavigate();
  const back = useWorkBack();
  return (
    <ScheduleDetail
      key={scheduleId}
      scheduleId={scheduleId}
      onBack={() => back(workPaths.feed("recurring"))}
      onOpenTicket={(id) => navigate(workPaths.ticket(id))}
      onBilled={(sent) => navigate(workPaths.sent(), { state: { sent } })}
      onRemoved={() => navigate(workPaths.feed("recurring"), { replace: true })}
    />
  );
}

/** Old invoice-list links open the exact migrated ticket when one exists. */
function LegacyInvoicesRedirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const invoiceId = params.get("invoice_id");
  const migratedTicketId = useQuery(api.tickets.findMigratedInvoice, invoiceId ? { invoice_id: invoiceId } : "skip");

  if (invoiceId && migratedTicketId === undefined) {
    return <div role="status" className="p-5 text-sm text-ink-secondary">Opening invoice…</div>;
  }

  const isPaymentReturn = params.has("square_payment");
  if (migratedTicketId) {
    if (!isPaymentReturn) params.delete("invoice_id");
    const query = params.toString();
    return <Navigate to={`${workPaths.ticket(migratedTicketId)}${query ? `?${query}` : ""}`} replace />;
  }

  if (!isPaymentReturn) params.delete("invoice_id");
  if (!params.has("filter")) params.set("filter", "open");
  const query = params.toString();
  return <Navigate to={`${workPaths.feed()}${query ? `?${query}` : ""}`} replace />;
}

/** Old /workorders/<section> deep links (dispatch, quotes, invoices, comms, …) land on the feed. */
function LegacySectionRedirect() {
  const { section = "" } = useParams();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const filter = LEGACY_SECTION_FILTERS[section.toLowerCase()];
  if (filter && filter !== "all" && !params.has("filter")) params.set("filter", filter);
  const query = params.toString();
  return <Navigate to={`${workPaths.feed()}${query ? `?${query}` : ""}`} replace />;
}

export default function Work() {
  useLegacyPaymentReturn();
  return (
    <Routes>
      <Route index element={<FeedRoute />} />
      <Route path="new" element={<NewRoute />} />
      <Route path="sent" element={<SentRoute />} />
      <Route path="t/:ticketId" element={<TicketRoute />} />
      <Route path="s/:scheduleId" element={<ScheduleRoute />} />
      <Route path="invoices/*" element={<LegacyInvoicesRedirect />} />
      <Route path=":section/*" element={<LegacySectionRedirect />} />
    </Routes>
  );
}
