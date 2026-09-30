import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const ROLE_OPTIONS = ['technician', 'admin', 'viewer'];

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/**
 * Pending invites addressed to the signed-in user. Invites stay inactive
 * until accepted here, so an owner cannot pull another account into their
 * business without consent.
 */
export function PendingInvites({ onAccepted }) {
  const invites = useQuery(api.businesses.getPendingInvites);
  const acceptInvite = useMutation(api.businesses.acceptInvite);
  const declineInvite = useMutation(api.businesses.declineInvite);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState('');

  if (!invites || invites.length === 0) return null;

  const run = async (action, invite, label) => {
    setBusyId(invite._id);
    setStatus('');
    try {
      await action({ inviteId: invite._id });
      if (label === 'Accepted') {
        await onAccepted?.();
      }
      setStatus(`${label} invite from ${invite.business_name}.`);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="pending-invites-heading" className="space-y-3">
      <h3 id="pending-invites-heading" className="text-base font-semibold">Team invitations</h3>
      <p className="text-sm text-ink-secondary">
        Accepting an invite switches this account to that business's customers and routes.
      </p>
      <ul className="space-y-2">
        {invites.map((invite) => (
          <li
            key={invite._id}
            className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-medium">{invite.business_name}</p>
              <p className="text-sm text-ink-secondary">Role: {invite.role}</p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busyId === invite._id}
                onClick={() => run(acceptInvite, invite, 'Accepted')}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === invite._id}
                onClick={() => run(declineInvite, invite, 'Declined')}
              >
                Decline
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <p role="status" aria-live="polite" className="text-sm text-ink-secondary">{status}</p>
    </section>
  );
}

/**
 * Owner-side team management: invite by email and see who is pending,
 * active, or removed.
 */
export function TeamMembersPanel() {
  const members = useQuery(api.businesses.getTeamMembers);
  const inviteTeamMember = useMutation(api.businesses.inviteTeamMember);
  const removeTeamMember = useMutation(api.businesses.removeTeamMember);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('technician');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState('');

  const handleInvite = async (event) => {
    event.preventDefault();
    if (!email.trim() || !name.trim()) {
      setStatus('Enter a name and an email address.');
      return;
    }
    setSubmitting(true);
    setStatus('');
    try {
      await inviteTeamMember({ email: email.trim(), name: name.trim(), role });
      setStatus(`Invite sent to ${email.trim()}. They must accept it from their own Settings page.`);
      setEmail('');
      setName('');
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (member) => {
    setStatus('');
    try {
      await removeTeamMember({ memberId: member._id });
      setStatus(`${member.name} removed.`);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  };

  const describe = (member) => {
    if (member.is_active) return 'Active';
    if (member.joined_at === undefined) return 'Pending';
    return 'Removed';
  };

  const visibleMembers = (members || []).filter((member) => member.role !== 'owner');

  return (
    <section aria-labelledby="team-members-heading" className="space-y-4">
      <div>
        <h3 id="team-members-heading" className="text-base font-semibold">Team members</h3>
        <p className="text-sm text-ink-secondary">
          Invited technicians see your customers only after they accept the invite.
        </p>
      </div>

      <form onSubmit={handleInvite} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="team-invite-name">Name</Label>
          <Input
            id="team-invite-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="team-invite-email">Email</Label>
          <Input
            id="team-invite-email"
            type="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="team-invite-role">Role</Label>
          <select
            id="team-invite-role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={submitting}>Invite</Button>
      </form>

      {visibleMembers.length > 0 && (
        <ul className="space-y-2">
          {visibleMembers.map((member) => (
            <li
              key={member._id}
              className="flex items-center justify-between rounded-lg border border-border p-3"
            >
              <div>
                <p className="font-medium">{member.name}</p>
                <p className="text-sm text-ink-secondary">
                  {member.user_email} · {member.role} · {describe(member)}
                </p>
              </div>
              {(member.is_active || member.joined_at === undefined) && (
                <Button size="sm" variant="outline" onClick={() => handleRemove(member)}>
                  {member.is_active ? 'Remove' : 'Cancel invite'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="text-sm text-ink-secondary">{status}</p>
    </section>
  );
}
