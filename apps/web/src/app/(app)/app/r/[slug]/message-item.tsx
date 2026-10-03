'use client';

/**
 * One message and what you can do with it (MSG-02 to MSG-07): the text rendered from
 * markdown-lite, a quote of the message it replies to (which jumps to the original), reactions,
 * and the action bar (reply, react, edit, delete). The action bar appears on hover and whenever
 * keyboard focus is inside the message, so every action is reachable with Tab.
 */
import { Check, CheckCheck, CornerUpLeft, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { REACTION_EMOJI, type ReactionEmoji } from '@socketspace/shared/emoji';
import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import { plainText } from '@socketspace/shared/markdown';
import type { PublicUser } from '@socketspace/shared/profile';
import { codePointLength } from '@socketspace/shared/text';

import { MessageBody } from '@/components/message-body';
import { LinkPreviews, MessageAttachments } from '@/components/message-media';
import { UserAvatar } from '@/components/user-avatar';
import { useChat } from '@/lib/chat/provider';

/** Times are written in the reader's own time zone, so they are filled in after the page loads. */
const subscribeNever = () => () => undefined;
export function LocalTime({ iso, withDate = false }: { iso: string; withDate?: boolean }) {
  const hydrated = useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  const text = withDate
    ? date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <time dateTime={iso} title={hydrated ? date.toLocaleString() : undefined}>
      {hydrated ? text : ''}
    </time>
  );
}

/** The current minute, updated every minute (0 while rendering on the server). */
function subscribeMinute(callback: () => void) {
  const timer = setInterval(callback, 30_000);
  return () => {
    clearInterval(timer);
  };
}
export function useMinute(): number {
  return useSyncExternalStore(
    subscribeMinute,
    () => Math.floor(Date.now() / 60_000),
    () => 0,
  );
}

export function displayName(person: PublicUser | undefined): string {
  if (!person) return 'Someone';
  return person.realName ? `${person.nickname} · ${person.realName}` : person.nickname;
}

export function isRemoved(message: MessageWire): boolean {
  return message.deletedAt !== null || message.moderationState === 'removed';
}

/** A one-line preview of a message's text. */
export function snippet(body: string, max = 120): string {
  const text = plainText(body);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** A one-line preview of a message, for reply quotes: its text, or "Picture" when it has none. */
export function messageSnippet(
  message: Pick<MessageWire, 'body' | 'attachments'>,
  max = 120,
): string {
  const text = snippet(message.body, max);
  if (text !== '') return text;
  const pictures = message.attachments.length;
  if (pictures === 0) return '';
  return pictures === 1 ? 'Picture' : `${String(pictures)} pictures`;
}

function ReplyQuote({
  originalId,
  original,
  author,
  onJump,
}: {
  originalId: string;
  original: MessageWire | undefined;
  author?: string;
  onJump: (messageId: string) => void;
}) {
  if (!original) {
    // Not loaded yet: the list loads older pages until it finds it.
    return (
      <button
        type="button"
        onClick={() => {
          onJump(originalId);
        }}
        className="mb-0.5 flex items-center gap-1.5 text-xs text-muted italic hover:text-ink"
      >
        <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
        Replying to an earlier message (show it)
      </button>
    );
  }
  if (isRemoved(original)) {
    return <p className="mb-0.5 text-xs text-muted italic">Replying to a deleted message</p>;
  }
  return (
    <button
      type="button"
      onClick={() => {
        onJump(original.id);
      }}
      className="mb-0.5 flex max-w-full items-center gap-1.5 rounded-md text-left text-xs text-ink-2 hover:text-ink"
      aria-label={`Replying to ${author ?? 'someone'}: ${messageSnippet(original, 80)}. Go to the original message.`}
    >
      <CornerUpLeft aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />
      <span className="font-semibold">{author ?? 'Someone'}</span>
      <span className="truncate">{messageSnippet(original)}</span>
    </button>
  );
}

function ActionButton({
  label,
  onClick,
  children,
  buttonRef,
  expanded,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  buttonRef?: React.Ref<HTMLButtonElement>;
  expanded?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      onClick={onClick}
      className="rounded-md p-1.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </button>
  );
}

function ReactionPicker({
  onPick,
  onClose,
}: {
  onPick: (emoji: ReactionEmoji) => void;
  /** `returnFocus`: put focus back on the button that opened the picker. */
  onClose: (returnFocus: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest callback, so re-renders never re-run the effect below (and never move focus).
  const close = useRef(onClose);
  useLayoutEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    ref.current?.querySelector('button')?.focus();
    const onPointer = (event: PointerEvent) => {
      // A click elsewhere closes the picker and leaves focus where the click went.
      if (!ref.current?.contains(event.target as Node)) close.current(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
    };
  }, []);
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Pick a reaction"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose(true);
        }
      }}
      className="absolute top-9 right-2 z-20 grid grid-cols-5 gap-1 rounded-xl border border-line bg-card p-2 shadow-lg"
    >
      {REACTION_EMOJI.map((emoji) => (
        <button
          key={emoji}
          type="button"
          aria-label={`React with ${emoji}`}
          onClick={() => {
            onPick(emoji);
            onClose(true);
          }}
          className="rounded-lg p-1.5 text-xl leading-none hover:bg-surface-2"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function Reactions({ message }: { message: MessageWire }) {
  const { state, me, toggleReaction } = useChat();
  if (message.reactions.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Reactions">
      {message.reactions.map(({ emoji, userIds }) => {
        const mine = userIds.includes(me.id);
        const names = userIds.map((id) => (id === me.id ? 'you' : displayName(state.users[id])));
        return (
          <li key={emoji}>
            <button
              type="button"
              aria-pressed={mine}
              aria-label={`${emoji} ${String(userIds.length)}: ${names.join(', ')}`}
              title={names.join(', ')}
              onClick={() => {
                toggleReaction(message.id, emoji);
              }}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm ${
                mine
                  ? 'border-accent bg-accent-soft font-semibold text-ink'
                  : 'border-line bg-card text-ink-2 hover:bg-surface-2'
              }`}
            >
              <span aria-hidden="true">{emoji}</span>
              <span aria-hidden="true">{userIds.length}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function EditForm({ message, onDone }: { message: MessageWire; onDone: () => void }) {
  const { editMessage } = useChat();
  const [text, setText] = useState(message.body);
  const [saving, setSaving] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const tooLong = codePointLength(text) > LIMITS.message.bodyMaxChars;
  const empty = text.trim() === '';

  useEffect(() => {
    const element = field.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  async function save() {
    if (empty || tooLong || saving) return;
    if (text === message.body) {
      onDone();
      return;
    }
    setSaving(true);
    const saved = await editMessage(message.id, text);
    setSaving(false);
    if (saved) onDone();
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="mt-1"
    >
      <label htmlFor={`edit-${message.id}`} className="sr-only">
        Edit message
      </label>
      <textarea
        id={`edit-${message.id}`}
        ref={field}
        value={text}
        rows={1}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          }
        }}
        className="max-h-48 min-h-11 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2 text-base text-ink [field-sizing:content]"
      />
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-2">
        <span>Enter to save · Esc to cancel</span>
        <button
          type="submit"
          disabled={empty || tooLong || saving}
          className="font-semibold text-accent underline disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="font-semibold underline">
          Cancel
        </button>
        {tooLong ? <span className="font-semibold text-danger">Too long</span> : null}
      </div>
    </form>
  );
}

function ConfirmDelete({
  message,
  authorName,
  mine,
  onClose,
}: {
  message: MessageWire;
  authorName: string;
  mine: boolean;
  onClose: () => void;
}) {
  const { deleteMessage } = useChat();
  const [busy, setBusy] = useState(false);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancel.current?.focus();
  }, []);
  return (
    <div
      role="group"
      aria-label="Confirm deletion"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-danger bg-danger-soft px-3 py-2 text-sm"
    >
      <span className="flex-1">
        {mine
          ? 'Delete this message for everyone?'
          : `Delete this message from ${authorName} for everyone?`}
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void deleteMessage(message.id).then((deleted) => {
            setBusy(false);
            if (deleted) onClose();
          });
        }}
        className="rounded-lg bg-danger px-3 py-1 font-semibold text-white disabled:opacity-50"
      >
        {busy ? 'Deleting…' : 'Delete'}
      </button>
      <button ref={cancel} type="button" onClick={onClose} className="font-semibold underline">
        Cancel
      </button>
    </div>
  );
}

/** What happened to your message in a DM (DM-02); rooms only show "sent". */
export type Receipt = 'sent' | 'delivered' | 'seen';

function ReceiptMark({ receipt }: { receipt: Receipt }) {
  if (receipt === 'sent') {
    return <Check aria-label="Sent" role="img" className="h-3.5 w-3.5 shrink-0 text-muted" />;
  }
  return (
    <CheckCheck
      aria-label={receipt === 'seen' ? 'Seen' : 'Delivered'}
      role="img"
      className={`h-3.5 w-3.5 shrink-0 ${receipt === 'seen' ? 'text-accent' : 'text-muted'}`}
    />
  );
}

export interface MessagePermissions {
  /** Member who may post here (verified, not muted). */
  canTakePart: boolean;
  /** May delete this particular message (author, or a moderator who outranks the author). */
  canDelete: boolean;
}

export function MessageItem({
  message,
  author,
  original,
  originalAuthor,
  continued,
  permissions,
  editing,
  onEdit,
  onEditDone,
  onReply,
  onJump,
  measureRef,
  index,
  receipt,
  blockedAuthor = false,
}: {
  message: MessageWire;
  author: PublicUser | undefined;
  /** The message this one replies to, if it is loaded. */
  original: MessageWire | undefined;
  originalAuthor: string | undefined;
  continued: boolean;
  permissions: MessagePermissions;
  editing: boolean;
  onEdit: (messageId: string) => void;
  onEditDone: () => void;
  onReply: (messageId: string) => void;
  /** Scroll to (and if needed load) another message. */
  onJump: (messageId: string) => void;
  /** The list measures each row's height (virtualised list). */
  measureRef: (element: HTMLLIElement | null) => void;
  index: number;
  receipt?: Receipt | undefined;
  /** The author is someone this person blocked: the message is folded until asked for. */
  blockedAuthor?: boolean;
}) {
  const { me, toggleReaction } = useChat();
  const minute = useMinute();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const pickerButton = useRef<HTMLButtonElement>(null);
  const removed = isRemoved(message);
  const mine = message.authorId === me.id;
  const showHeader = !continued || message.replyToId !== null;
  const editable =
    mine &&
    !removed &&
    permissions.canTakePart &&
    minute > 0 &&
    minute * 60_000 - Date.parse(message.createdAt) < LIMITS.message.editWindowMs - 60_000;
  const name = displayName(author);

  return (
    <li
      ref={measureRef}
      data-index={index}
      id={`message-${message.id}`}
      tabIndex={-1}
      aria-label={removed ? `${name}: message deleted` : undefined}
      className={`group relative flex gap-3 px-4 outline-none hover:bg-surface-2/60 focus-within:bg-surface-2/60 data-[highlight=true]:bg-accent-soft ${
        showHeader ? 'pt-3' : 'pt-0.5'
      } pb-0.5 transition-colors duration-200`}
    >
      <div className="w-10 shrink-0">{showHeader ? <UserAvatar user={author} /> : null}</div>
      <div className="min-w-0 flex-1">
        {message.replyToId !== null ? (
          <ReplyQuote
            originalId={message.replyToId}
            original={original}
            author={originalAuthor}
            onJump={onJump}
          />
        ) : null}
        {showHeader ? (
          <p className="flex items-baseline gap-2">
            <span className="font-bold text-ink">{name}</span>
            <span className="text-xs text-muted">
              <LocalTime iso={message.createdAt} />
            </span>
          </p>
        ) : null}
        {removed ? (
          <p className="text-sm text-muted italic">Message deleted</p>
        ) : blockedAuthor && !revealed ? (
          <p className="text-sm text-muted italic">
            Message from someone you blocked.{' '}
            <button
              type="button"
              onClick={() => {
                setRevealed(true);
              }}
              className="font-semibold not-italic underline"
            >
              Show
            </button>
          </p>
        ) : editing ? (
          <EditForm message={message} onDone={onEditDone} />
        ) : (
          <>
            {message.body === '' ? null : (
              <div className="flex items-end gap-1.5">
                <MessageBody
                  body={message.body}
                  myNickname={me.nickname}
                  className="min-w-0 text-[0.95rem] text-ink"
                />
                {message.editedAt ? (
                  <span className="shrink-0 text-xs text-muted" title={message.editedAt}>
                    (edited)
                  </span>
                ) : null}
                {mine ? <ReceiptMark receipt={receipt ?? 'sent'} /> : null}
              </div>
            )}
            {/* A picture with no text: the tick sits beside the picture instead. */}
            <div className="flex items-end gap-1.5">
              <MessageAttachments attachments={message.attachments} authorName={name} />
              {message.body === '' && mine ? <ReceiptMark receipt={receipt ?? 'sent'} /> : null}
            </div>
            <LinkPreviews messageId={message.id} body={message.body} editedAt={message.editedAt} />
          </>
        )}
        {removed ? null : <Reactions message={message} />}
        {confirming ? (
          <ConfirmDelete
            message={message}
            authorName={name}
            mine={mine}
            onClose={() => {
              setConfirming(false);
            }}
          />
        ) : null}
      </div>
      {removed || editing ? null : (
        <div
          role="toolbar"
          aria-label={`Actions for the message from ${name}`}
          className={`absolute top-1 right-3 z-10 flex items-center gap-0.5 rounded-lg border border-line bg-card p-0.5 shadow-sm ${
            picking ? '' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          }`}
        >
          {permissions.canTakePart ? (
            <>
              <ActionButton
                label="Reply"
                onClick={() => {
                  onReply(message.id);
                }}
              >
                <CornerUpLeft aria-hidden="true" className="h-4 w-4" />
              </ActionButton>
              <ActionButton
                label="Add reaction"
                buttonRef={pickerButton}
                expanded={picking}
                onClick={() => {
                  setPicking((open) => !open);
                }}
              >
                <SmilePlus aria-hidden="true" className="h-4 w-4" />
              </ActionButton>
            </>
          ) : null}
          {editable ? (
            <ActionButton
              label="Edit"
              onClick={() => {
                onEdit(message.id);
              }}
            >
              <Pencil aria-hidden="true" className="h-4 w-4" />
            </ActionButton>
          ) : null}
          {permissions.canDelete ? (
            <ActionButton
              label="Delete"
              onClick={() => {
                setConfirming(true);
              }}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </ActionButton>
          ) : null}
        </div>
      )}
      {picking ? (
        <ReactionPicker
          onPick={(emoji) => {
            toggleReaction(message.id, emoji);
          }}
          onClose={(returnFocus) => {
            setPicking(false);
            if (returnFocus) pickerButton.current?.focus();
          }}
        />
      ) : null}
    </li>
  );
}
