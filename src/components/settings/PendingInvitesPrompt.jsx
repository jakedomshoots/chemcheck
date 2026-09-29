import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Button } from '@/components/ui/button';

/**
 * Shows team invites addressed to the signed-in user. An invite grants no
 * access until it is accepted here.
 */
export default function PendingInvitesPrompt() {
  const invites = useQuery(api.businesses.listMyInvites);
  const acceptInvite = useMutation(api.businesses.acceptInvite);
  const declineInvite = useMutation(api.businesses.declineInvite);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  if (!Array.isArray(invites) || invites.length === 0) return null;

  const respond = async (invite, accept) => {
    setBusyId(invite._id);
    setError('');
    try {
      if (accept) {
        await acceptInvite({ memberId: invite._id });
      } else {
        await declineInvite({ memberId: invite._id });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the invite.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="mb-5 rounded-sheet border border-line bg-surface-1 p-4 shadow-card" role="region" aria-label="Team invites">
      <p className="mb-2 text-sm font-semibold text-ink">Team invites</p>
      <ul className="space-y-3">
        {invites.map((invite) => (
          <li key={invite._id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-ink-secondary">
              <span className="font-semibold text-ink">{invite.business_name}</span> invited you to join as{' '}
              <span className="font-medium">{invite.role}</span>. Accepting switches you to their business data.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === invite._id} onClick={() => respond(invite, true)}>
                Accept
              </Button>
              <Button size="sm" variant="outline" disabled={busyId === invite._id} onClick={() => respond(invite, false)}>
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-[var(--status-danger-ink,#b91c1c)]" role="alert">{error}</p> : null}
    </div>
  );
}
