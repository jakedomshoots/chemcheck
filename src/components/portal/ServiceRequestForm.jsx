import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { todayIso } from "@/lib/portal";

const MAX_MESSAGE = 1000;

/**
 * Request-service form for the customer portal.
 * Props: { onSubmit: ({message, preferred_date}) => Promise<{ok, error?}> }
 */
export function ServiceRequestForm({ onSubmit }) {
  const [message, setMessage] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (message.trim().length < 3) {
      setError("Please tell us a little about what you need.");
      return;
    }
    setBusy(true);
    try {
      const result = await onSubmit({ message: message.trim(), preferred_date: preferredDate || undefined });
      if (result?.ok) {
        setSent(true);
        setMessage("");
        setPreferredDate("");
      } else {
        setError(result?.error || "Could not send your request. Please try again.");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send your request. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div role="status" className="rounded-card border border-[var(--status-ok-line)] bg-[var(--status-ok-soft)] px-4 py-4 text-sm text-ink">
        <p className="font-semibold">Request sent.</p>
        <p className="mt-1 text-ink-secondary">We'll follow up to confirm a time.</p>
        <Button type="button" size="sm" variant="ghost" onClick={() => setSent(false)} className="mt-2 h-9 rounded-full px-3 text-xs font-semibold">
          Send another request
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <div>
        <Label htmlFor="portal-request-message" className="mb-1 block text-sm font-medium text-ink-secondary">What do you need?</Label>
        <Textarea
          id="portal-request-message"
          value={message}
          maxLength={MAX_MESSAGE}
          rows={4}
          required
          placeholder="e.g. The pump is making a grinding noise, or we'd like an extra cleaning before the weekend."
          onChange={(event) => setMessage(event.target.value)}
          aria-describedby="portal-request-help"
          aria-invalid={error ? "true" : undefined}
        />
        <p id="portal-request-help" className="mt-1 text-xs text-ink-muted">{message.length}/{MAX_MESSAGE}</p>
      </div>
      <div>
        <Label htmlFor="portal-request-date" className="mb-1 block text-sm font-medium text-ink-secondary">Preferred date (optional)</Label>
        <Input id="portal-request-date" type="date" min={todayIso()} value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} />
      </div>
      {error && <p role="alert" className="text-sm text-critical">{error}</p>}
      <Button type="submit" disabled={busy} className="h-11 w-full rounded-full bg-brand text-sm font-semibold text-white hover:bg-brand-strong">
        <Send className="mr-2 h-4 w-4" aria-hidden="true" />
        {busy ? "Sending…" : "Request service"}
      </Button>
    </form>
  );
}

export default ServiceRequestForm;
