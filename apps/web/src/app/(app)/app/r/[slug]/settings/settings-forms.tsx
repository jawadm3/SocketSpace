'use client';

/**
 * The forms on the room settings page. Each submits a server action and shows its result next to
 * the button that was pressed (success politely, refusals as alerts).
 */
import { Copy } from 'lucide-react';
import { useActionState, useState, type ReactNode } from 'react';

import { LIMITS } from '@socketspace/shared/limits';
import type { PublicUser } from '@socketspace/shared/profile';

import { Alert, Button, TextField } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';

import {
  banMemberAction,
  createInviteAction,
  deleteRoomAction,
  muteMemberAction,
  removeMemberAction,
  revokeInviteAction,
  setRoleAction,
  transferOwnershipAction,
  unbanMemberAction,
  unmuteMemberAction,
  updateRoomAction,
  type RoomActionState,
} from '../../../room-actions';

type Action = (previous: RoomActionState, form: FormData) => Promise<RoomActionState>;

function Result({ state }: { state: RoomActionState }) {
  if (state.error) return <Alert tone="error">{state.error}</Alert>;
  if (state.message) return <Alert tone="success">{state.message}</Alert>;
  return null;
}

/** A small form for one action, with hidden IDs and its own result line. */
function ActionForm({
  action,
  hidden,
  children,
  className = '',
}: {
  action: Action;
  hidden: Record<string, string>;
  children: (pending: boolean) => ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<RoomActionState, FormData>(action, {});
  return (
    <form action={formAction} className={`flex flex-col gap-2 ${className}`}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children(pending)}
      <Result state={state} />
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  return (
    <section aria-labelledby={id} className="rounded-card border border-line bg-card p-5">
      <h2 id={id} className="mb-4 text-lg font-bold">
        {title}
      </h2>
      {children}
    </section>
  );
}

const selectClass = 'min-h-10 rounded-xl border border-line bg-card px-3 text-sm';

// Details -------------------------------------------------------------------------------------------

export function RoomDetailsForm({
  conversationId,
  name,
  topic,
}: {
  conversationId: string;
  name: string;
  topic: string;
}) {
  return (
    <Section title="Details">
      <ActionForm action={updateRoomAction} hidden={{ conversationId }}>
        {(pending) => (
          <>
            <TextField
              id="room-name"
              name="name"
              label="Name"
              defaultValue={name}
              maxLength={LIMITS.room.nameMax}
              required
            />
            <TextField
              id="room-topic"
              name="topic"
              label="Topic"
              defaultValue={topic}
              maxLength={LIMITS.room.topicMax}
            />
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </ActionForm>
    </Section>
  );
}

// Invites -------------------------------------------------------------------------------------------

export interface InviteRow {
  id: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
  uses: string;
  status: 'Active' | 'Expired' | 'Used up' | 'Cancelled';
}

function CreatedInvite({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent bg-accent-soft p-3">
      <label htmlFor="invite-url" className="text-sm font-semibold">
        Invite link (shown once)
      </label>
      <div className="flex gap-2">
        <input
          id="invite-url"
          readOnly
          value={url}
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-line bg-card px-2 font-mono text-sm"
          onFocus={(event) => {
            event.currentTarget.select();
          }}
        />
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => {
              setCopied(true);
            });
          }}
        >
          <Copy aria-hidden="true" className="h-4 w-4" />
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

function CreateInviteForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState<RoomActionState, FormData>(
    createInviteAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Expires after
          <select name="expiresIn" defaultValue="7d" className={selectClass}>
            <option value="30m">30 minutes</option>
            <option value="1d">1 day</option>
            <option value="7d">7 days</option>
            <option value="never">Never</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm font-semibold">
          Can be used
          <select name="maxUses" defaultValue="unlimited" className={selectClass}>
            <option value="1">Once</option>
            <option value="5">5 times</option>
            <option value="25">25 times</option>
            <option value="unlimited">Any number of times</option>
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? 'Creating…' : 'Create invite link'}
        </Button>
      </div>
      {state.inviteUrl ? <CreatedInvite url={state.inviteUrl} /> : null}
      <Result state={{ ...state, message: state.inviteUrl ? undefined : state.message }} />
    </form>
  );
}

export function InviteSection({
  conversationId,
  invites,
}: {
  conversationId: string;
  invites: InviteRow[];
}) {
  return (
    <Section title="Invites">
      <p className="mb-3 text-sm text-ink-2">
        An invite link lets someone join, even if the room is private. We keep only a fingerprint of
        each link, so copy it when it is shown.
      </p>
      <CreateInviteForm conversationId={conversationId} />
      {invites.length > 0 ? (
        <ul className="mt-4 flex flex-col divide-y divide-line">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span>
                <span className="font-semibold">{invite.status}</span> · {invite.uses}
                {invite.createdBy ? ` · by ${invite.createdBy}` : ''}
              </span>
              {invite.status === 'Active' ? (
                <ActionForm action={revokeInviteAction} hidden={{ inviteId: invite.id }}>
                  {(pending) => (
                    <Button type="submit" variant="ghost" disabled={pending}>
                      Cancel invite
                    </Button>
                  )}
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </Section>
  );
}

// Members ---------------------------------------------------------------------------------------------

export interface ManagedMember {
  person: PublicUser;
  role: 'owner' | 'moderator' | 'member';
  mutedUntil: string | null;
  isSelf: boolean;
  can: { setRole: boolean; transfer: boolean; mute: boolean; remove: boolean; ban: boolean };
}

function ReasonField({ id }: { id: string }) {
  return (
    <TextField
      id={id}
      name="reason"
      label="Reason (shown to them)"
      required
      minLength={3}
      maxLength={500}
    />
  );
}

function MemberActions({
  conversationId,
  member,
}: {
  conversationId: string;
  member: ManagedMember;
}) {
  const ids = { conversationId, userId: member.person.id };
  const name = member.person.nickname;
  return (
    <div className="grid gap-4 pt-3 sm:grid-cols-2">
      {member.can.setRole ? (
        <ActionForm
          action={setRoleAction}
          hidden={{ ...ids, role: member.role === 'moderator' ? 'member' : 'moderator' }}
        >
          {(pending) => (
            <Button type="submit" variant="secondary" disabled={pending}>
              {member.role === 'moderator'
                ? `Remove ${name} as moderator`
                : `Make ${name} a moderator`}
            </Button>
          )}
        </ActionForm>
      ) : null}
      {member.can.transfer ? (
        <ActionForm action={transferOwnershipAction} hidden={ids}>
          {(pending) => (
            <Button type="submit" variant="secondary" disabled={pending}>
              Make {name} the owner
            </Button>
          )}
        </ActionForm>
      ) : null}
      {member.can.mute && member.mutedUntil ? (
        <ActionForm action={unmuteMemberAction} hidden={ids}>
          {(pending) => (
            <Button type="submit" variant="secondary" disabled={pending}>
              Lift {name}&apos;s mute
            </Button>
          )}
        </ActionForm>
      ) : null}
      {member.can.mute ? (
        <ActionForm
          action={muteMemberAction}
          hidden={ids}
          className="rounded-xl border border-line p-3"
        >
          {(pending) => (
            <>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Mute {name} for
                <select name="duration" defaultValue="10m" className={selectClass}>
                  <option value="10m">10 minutes</option>
                  <option value="1h">1 hour</option>
                  <option value="1d">1 day</option>
                  <option value="7d">7 days</option>
                </select>
              </label>
              <ReasonField id={`mute-reason-${member.person.id}`} />
              <Button type="submit" variant="secondary" disabled={pending}>
                Mute {name}
              </Button>
            </>
          )}
        </ActionForm>
      ) : null}
      {member.can.remove ? (
        <ActionForm
          action={removeMemberAction}
          hidden={ids}
          className="rounded-xl border border-line p-3"
        >
          {(pending) => (
            <>
              <p className="text-sm font-semibold">Remove {name} (they can join again)</p>
              <ReasonField id={`remove-reason-${member.person.id}`} />
              <Button type="submit" variant="secondary" disabled={pending}>
                Remove {name}
              </Button>
            </>
          )}
        </ActionForm>
      ) : null}
      {member.can.ban ? (
        <ActionForm
          action={banMemberAction}
          hidden={ids}
          className="rounded-xl border border-danger p-3"
        >
          {(pending) => (
            <>
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Ban {name} for
                <select name="duration" defaultValue="1d" className={selectClass}>
                  <option value="1d">1 day</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="permanent">Until lifted</option>
                </select>
              </label>
              <ReasonField id={`ban-reason-${member.person.id}`} />
              <Button type="submit" variant="danger" disabled={pending}>
                Ban {name}
              </Button>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}

const ROLE_LABEL = { owner: 'Owner', moderator: 'Moderator', member: 'Member' } as const;

export function MemberManager({
  conversationId,
  members,
}: {
  conversationId: string;
  members: ManagedMember[];
}) {
  return (
    <Section title={`Members (${String(members.length)})`}>
      <ul className="flex flex-col divide-y divide-line">
        {members.map((member) => {
          const canAct = Object.values(member.can).some(Boolean);
          return (
            <li key={member.person.id} className="py-2">
              <div className="flex items-center gap-3">
                <UserAvatar user={member.person} size="sm" />
                <span className="min-w-0 flex-1 truncate font-semibold">
                  {member.person.nickname}
                  {member.isSelf ? ' (you)' : ''}
                </span>
                {member.mutedUntil ? (
                  <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold">
                    Muted
                  </span>
                ) : null}
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">
                  {ROLE_LABEL[member.role]}
                </span>
              </div>
              {canAct ? (
                <details className="mt-1 pl-11">
                  <summary className="cursor-pointer text-sm font-semibold text-accent">
                    Manage {member.person.nickname}
                  </summary>
                  <MemberActions conversationId={conversationId} member={member} />
                </details>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// Bans ----------------------------------------------------------------------------------------------------

export function BanList({
  conversationId,
  bans,
}: {
  conversationId: string;
  bans: { person: PublicUser; reason: string; expiresAt: string | null }[];
}) {
  return (
    <Section title={`Bans (${String(bans.length)})`}>
      {bans.length === 0 ? (
        <p className="text-sm text-ink-2">Nobody is banned from this room.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {bans.map((ban) => (
            <li key={ban.person.id} className="flex flex-wrap items-center gap-3 py-2">
              <UserAvatar user={ban.person} size="sm" />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-semibold">{ban.person.nickname}</span> · {ban.reason}
                {ban.expiresAt ? '' : ' · until lifted'}
              </span>
              <ActionForm
                action={unbanMemberAction}
                hidden={{ conversationId, userId: ban.person.id }}
              >
                {(pending) => (
                  <Button type="submit" variant="ghost" disabled={pending}>
                    Lift ban on {ban.person.nickname}
                  </Button>
                )}
              </ActionForm>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// Delete ----------------------------------------------------------------------------------------------------

export function DeleteRoomForm({ conversationId, name }: { conversationId: string; name: string }) {
  return (
    <Section title="Delete this room">
      <p className="mb-3 text-sm text-ink-2">
        #{name} disappears for everyone and nobody can post in it again. This cannot be undone.
      </p>
      <ActionForm action={deleteRoomAction} hidden={{ conversationId }}>
        {(pending) => (
          <>
            <TextField
              id="confirm-delete"
              name="confirm"
              label='Type "delete" to confirm'
              autoComplete="off"
            />
            <div>
              <Button type="submit" variant="danger" disabled={pending}>
                Delete #{name}
              </Button>
            </div>
          </>
        )}
      </ActionForm>
    </Section>
  );
}
