import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Link2, Copy, RotateCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import { buildPortalUrl, copyTextToClipboard, formatPortalExpiry } from "@/lib/portal";

function errorMessage(error) {
  return error instanceof Error ? error.message : "Something went wrong";
}

const PILL = "h-9 rounded-full border border-line bg-surface-1 px-3 text-xs font-semibold text-ink-secondary shadow-sm hover:border-[var(--status-info-line)] hover:bg-brand-softer hover:text-brand-ink";

/**
 * "Copy portal link" for a customer. Creates the link on first use, copies
 * it to the clipboard, and exposes rotate/revoke in a small inline panel.
 *
 * Props: { customerId: Id<"customers">, className?: string }
 */
export function PortalLinkButton({ customerId, className = "" }) {
  const status = useQuery(api.portal.getPortalLinkStatus, customerId ? { customer_id: customerId } : "skip");
  const createOrRotate = useMutation(api.portal.createOrRotatePortalLink);
  const revoke = useMutation(api.portal.revokePortalLink);
  const [busy, setBusy] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  const copyToken = async (token) => {
    const url = buildPortalUrl(token);
    const ok = await copyTextToClipboard(url);
    if (ok) toast.success("Portal link copied.");
    else toast.error(`Could not copy automatically. Link: ${url}`);
  };

  const handleCopy = async () => {
    setBusy(true);
    try {
      if (status?.token) {
        await copyToken(status.token);
      } else {
        const created = await createOrRotate({ customer_id: customerId });
        await copyToken(created.token);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleRotate = async () => {
    setBusy(true);
    try {
      const created = await createOrRotate({ customer_id: customerId });
      await copyToken(created.token);
      toast.success("New portal link created. The old link no longer works.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    try {
      await revoke({ customer_id: customerId });
      setShowOptions(false);
      toast.success("Portal link turned off.");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const hasLink = Boolean(status?.token);

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <Button type="button" size="sm" variant="outline" disabled={busy || status === undefined} onClick={handleCopy} className={PILL} title="Copy a private portal link for this customer">
        {hasLink ? <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
        {hasLink ? "Copy portal link" : "Create portal link"}
      </Button>
      {hasLink && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={showOptions}
          aria-controls="portal-link-options"
          onClick={() => setShowOptions((value) => !value)}
          className="h-9 rounded-full px-3 text-xs font-semibold text-ink-muted"
        >
          {showOptions ? "Hide options" : "Portal options"}
        </Button>
      )}
      {hasLink && showOptions && (
        <div id="portal-link-options" className="flex w-full flex-wrap items-center gap-2 rounded-card border border-line bg-surface-2/60 px-3 py-2 text-xs text-ink-secondary">
          <span>{formatPortalExpiry(status.expires_at)}{status.last_access_at ? " · viewed" : " · never viewed"}</span>
          <span className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={handleRotate} className="h-8 rounded-full px-3 text-xs font-semibold">
              <RotateCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              New link
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={handleRevoke} className="h-8 rounded-full px-3 text-xs font-semibold text-critical">
              <Unplug className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              Turn off
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

export default PortalLinkButton;
