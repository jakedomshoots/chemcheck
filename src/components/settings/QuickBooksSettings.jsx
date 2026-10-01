import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExternalLink, Link2, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";

function errorMessage(error) {
  return error instanceof Error ? error.message : "Something went wrong";
}

function formatWhen(timestamp) {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const CALLBACK_MESSAGES = {
  connected: { kind: "success", text: "QuickBooks connected." },
  access_denied: { kind: "error", text: "QuickBooks connection was cancelled." },
  invalid_state: { kind: "error", text: "QuickBooks connection expired. Please try again." },
  not_configured: { kind: "error", text: "QuickBooks is not configured on the server." },
  token_exchange_failed: { kind: "error", text: "QuickBooks did not accept the connection. Please try again." },
};

/** Read ?quickbooks=connected|error&reason=... once after the OAuth redirect, then clean the URL. */
export function consumeCallbackParams(search = typeof window !== "undefined" ? window.location.search : "") {
  const params = new URLSearchParams(search);
  const status = params.get("quickbooks");
  if (!status) return null;
  const reason = params.get("reason") || "";
  const message = status === "connected" ? CALLBACK_MESSAGES.connected : CALLBACK_MESSAGES[reason] || { kind: "error", text: "QuickBooks connection failed." };
  params.delete("quickbooks");
  params.delete("reason");
  return { ...message, cleanedSearch: params.toString() ? `?${params.toString()}` : "" };
}

/**
 * Connect / disconnect QuickBooks Online, show sync status and run a manual sync.
 * Owners and admins can manage the connection; others see status only.
 */
export function QuickBooksSettings() {
  const status = useQuery(api.quickbooks.getStatus);
  const syncLog = useQuery(api.quickbooksSync.listSyncLog, { limit: 10 });
  const getAuthorizeUrl = useAction(api.quickbooks.getAuthorizeUrl);
  const disconnect = useAction(api.quickbooks.disconnect);
  const syncNow = useAction(api.quickbooksSync.syncNow);
  const updateSettings = useMutation(api.businesses.updateSettings);
  const [busy, setBusy] = useState(null);
  const [lastRun, setLastRun] = useState(null);

  useEffect(() => {
    const result = consumeCallbackParams();
    if (!result) return;
    if (result.kind === "success") toast.success(result.text); else toast.error(result.text);
    if (typeof window !== "undefined" && window.history?.replaceState) {
      window.history.replaceState({}, "", `${window.location.pathname}${result.cleanedSearch}${window.location.hash}`);
    }
  }, []);

  const run = async (name, fn) => {
    setBusy(name);
    try {
      return await fn();
    } catch (error) {
      toast.error(errorMessage(error));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run("connect", async () => {
      const { url } = await getAuthorizeUrl({});
      window.location.assign(url);
    });

  const handleDisconnect = () =>
    run("disconnect", async () => {
      if (typeof window !== "undefined" && !window.confirm("Disconnect QuickBooks? Synced records stay in QuickBooks; new invoices will stop syncing.")) return;
      await disconnect({});
      toast.success("QuickBooks disconnected.");
    });

  const handleSync = () =>
    run("sync", async () => {
      const result = await syncNow({});
      setLastRun(result);
      if (result.errors.length === 0) {
        toast.success(`Synced ${result.customers} customers, ${result.invoices} invoices, ${result.payments} payments.`);
      } else {
        toast.error(`Sync finished with ${result.errors.length} ${result.errors.length === 1 ? "error" : "errors"}.`);
      }
    });

  const toggleAutoSync = (enabled) =>
    run("auto", async () => {
      await updateSettings({ quickbooks_auto_sync: enabled });
      toast.success(enabled ? "Invoices will sync automatically." : "Automatic sync paused.");
    });

  if (status === undefined) {
    return <p className="text-sm text-ink-muted" aria-live="polite">Checking QuickBooks…</p>;
  }

  const connected = status.connected;
  const canManage = status.can_manage;

  return (
    <section aria-labelledby="quickbooks-heading" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 id="quickbooks-heading" className="text-base font-semibold text-ink">QuickBooks Online</h3>
          <p className="text-sm text-ink-secondary">Push customers, invoices and payments to your books automatically.</p>
        </div>
        <StatusBadge
          tone={connected ? "ok" : status.configured ? "neutral" : "watch"}
          label={connected ? "Connected" : status.configured ? "Not connected" : "Not configured"}
          dot
        />
      </div>

      {!status.configured && (
        <p role="status" className="rounded-card border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-4 py-3 text-sm text-ink">
          QuickBooks needs server configuration before it can be connected. Missing: {status.missing.join(", ")}.
        </p>
      )}

      {status.last_error && (
        <p role="alert" className="rounded-card border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] px-4 py-3 text-sm text-ink">
          Last sync problem: {status.last_error}
        </p>
      )}

      <dl className="grid grid-cols-1 gap-3 rounded-card border border-line bg-surface-1 p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Company</dt>
          <dd className="font-data text-ink">{connected ? `Realm ${status.realm_id}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Environment</dt>
          <dd className="text-ink capitalize">{status.environment}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Connected on</dt>
          <dd className="text-ink">{connected ? `${formatWhen(status.connected_at)} by ${status.connected_by}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Last sync</dt>
          <dd className="text-ink">{formatWhen(status.last_sync_at)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Linked records</dt>
          <dd className="text-ink">
            {status.counts.customer} customers · {status.counts.invoice} invoices · {status.counts.payment} payments
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {!connected && (
          <Button type="button" size="sm" disabled={!canManage || !status.configured || busy === "connect"} onClick={connect} className="h-10 rounded-full bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
            <Link2 className="mr-1 h-4 w-4" aria-hidden="true" />
            {busy === "connect" ? "Opening QuickBooks…" : "Connect QuickBooks"}
          </Button>
        )}
        {connected && (
          <>
            <Button type="button" size="sm" disabled={!canManage || busy === "sync"} onClick={handleSync} className="h-10 rounded-full bg-brand px-4 text-xs font-semibold text-white hover:bg-brand-strong">
              <RefreshCw className={`mr-1 h-4 w-4 ${busy === "sync" ? "animate-spin" : ""}`} aria-hidden="true" />
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </Button>
            <Button asChild size="sm" variant="outline" className="h-10 rounded-full border-line bg-surface-1 px-4 text-xs font-semibold text-ink-secondary">
              <a href={status.company_url} target="_blank" rel="noreferrer">
                <ExternalLink className="mr-1 h-4 w-4" aria-hidden="true" />
                Open QuickBooks
              </a>
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={!canManage || busy === "disconnect"} onClick={handleDisconnect} className="h-10 rounded-full px-4 text-xs font-semibold text-ink-secondary hover:text-critical">
              <Unplug className="mr-1 h-4 w-4" aria-hidden="true" />
              Disconnect
            </Button>
          </>
        )}
      </div>

      {connected && canManage && (
        <label className="flex items-center gap-3 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-line"
            checked={status.auto_sync}
            disabled={busy === "auto"}
            onChange={(event) => toggleAutoSync(event.target.checked)}
          />
          Sync invoices automatically when created, sent or paid
        </label>
      )}

      {!canManage && (
        <p className="text-xs text-ink-muted">Only the account owner or an admin can connect, disconnect or sync QuickBooks.</p>
      )}

      {lastRun && lastRun.errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-1 rounded-card border border-[var(--status-critical-line)] bg-[var(--status-critical-soft)] px-6 py-3 text-sm text-ink">
          {lastRun.errors.slice(0, 5).map((error, index) => (
            <li key={index}>{error}</li>
          ))}
        </ul>
      )}

      {connected && (
        <div>
          <h4 className="mb-2 text-sm font-semibold text-ink">Recent sync activity</h4>
          {!syncLog || syncLog.length === 0 ? (
            <p className="text-sm text-ink-muted">Nothing synced yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface-1 text-sm" aria-label="Sync log">
              {syncLog.map((entry) => (
                <li key={entry._id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-ink">
                      <span className="capitalize">{entry.entity_type}</span> {entry.action}
                      {entry.message ? <span className="text-ink-muted"> — {entry.message}</span> : null}
                    </span>
                    <span className="block text-xs text-ink-muted">{formatWhen(entry.created_at)}</span>
                  </span>
                  <StatusBadge size="sm" tone={entry.status === "error" ? "critical" : entry.status === "skipped" ? "neutral" : "ok"} label={entry.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default QuickBooksSettings;
