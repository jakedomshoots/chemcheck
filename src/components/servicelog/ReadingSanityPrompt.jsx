import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * "Double-check" prompt shown before saving when readings jumped a lot since
 * the previous visit or look physically unlikely. Confirming proceeds with the
 * save; hard-invalid readings never reach this prompt (they block instead).
 *
 * Props:
 *  - warnings: Array<{ field, message }>
 *  - open: boolean
 *  - onConfirm(): void
 *  - onCancel(): void
 */
export default function ReadingSanityPrompt({ warnings = [], open, onConfirm, onCancel }) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!next) onCancel?.(); }}>
      <AlertDialogContent data-testid="reading-sanity-prompt">
        <AlertDialogHeader>
          <AlertDialogTitle>Double-check these readings?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <p className="text-sm text-ink-secondary">
                These values changed a lot since the last visit or look unlikely. Save anyway if they are correct.
              </p>
              <ul className="mt-3 space-y-2 text-left" aria-label="Readings to double-check">
                {warnings.map((warning) => (
                  <li key={`${warning.field}-${warning.message}`} className="rounded-control border border-[var(--status-watch-line)] bg-[var(--status-watch-soft)] px-3 py-2 text-xs leading-5 text-ink">
                    {warning.message}
                  </li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11 rounded-control">Go back and fix</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="h-11 rounded-control bg-brand text-white hover:bg-brand-strong">
            Readings are correct, save
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
