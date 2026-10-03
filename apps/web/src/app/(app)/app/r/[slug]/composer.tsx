'use client';

/**
 * The message composer (MSG-01, MSG-04, MSG-06, RT-04):
 *
 * - Enter sends, Shift+Enter starts a new line.
 * - Typing "@" suggests room members; arrow keys move, Enter or Tab picks, Esc closes.
 * - "Reply" on a message shows a chip above the box; Esc (or the cross) cancels it.
 * - Up arrow in an empty box edits your last message.
 * - Keystrokes tell others you are typing (throttled in the provider); sending or clearing the
 *   text stops it.
 */
import { CornerUpLeft, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import type { PublicUser } from '@socketspace/shared/profile';
import { codePointLength } from '@socketspace/shared/text';

import { Button } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { insertMention, mentionAt, mentionCandidates } from '@/lib/chat/mentions';
import { useChat } from '@/lib/chat/provider';

import { snippet } from './message-item';

export function Composer({
  room,
  memberIds,
  replyTo,
  onCancelReply,
  onEditLast,
}: {
  /** `name` is shown as it is: "#design" for a room, "@ava" for a DM. */
  room: { id: string; name: string };
  memberIds: readonly string[];
  replyTo: MessageWire | null;
  onCancelReply: () => void;
  /** Up arrow in an empty composer; returns `false` if there is nothing to edit. */
  onEditLast: () => boolean;
}) {
  const { send, typing, stoppedTyping, state, me } = useChat();
  const [text, setText] = useState('');
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  /** The "@" position whose suggestions were closed with Esc. */
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const nextCaret = useRef<number | null>(null);
  const length = codePointLength(text);
  const tooLong = length > LIMITS.message.bodyMaxChars;

  const mention = mentionAt(text, caret);
  const nicknames = memberIds
    .filter((id) => id !== me.id)
    .map((id) => state.users[id]?.nickname)
    .filter((n): n is string => n !== undefined);
  const candidates =
    mention && mention.start !== dismissedAt ? mentionCandidates(nicknames, mention.query) : [];
  const open = candidates.length > 0;
  const activeIndex = Math.min(active, candidates.length - 1);
  const people = new Map(
    memberIds.flatMap((id) => {
      const person = state.users[id];
      return person ? [[person.nickname, person] as [string, PublicUser]] : [];
    }),
  );

  // Put the cursor where a picked mention ended.
  useLayoutEffect(() => {
    const element = field.current;
    if (element && nextCaret.current !== null) {
      element.setSelectionRange(nextCaret.current, nextCaret.current);
      nextCaret.current = null;
    }
  }, [text]);

  // "Reply" moves focus here.
  const replyId = replyTo?.id;
  useEffect(() => {
    if (replyId) field.current?.focus();
  }, [replyId]);

  // Leaving the room (or the page) stops the typing indicator.
  useEffect(
    () => () => {
      stoppedTyping(room.id);
    },
    [room.id, stoppedTyping],
  );

  function update(value: string, cursor: number) {
    setText(value);
    setCaret(cursor);
    if (value.trim() === '') stoppedTyping(room.id);
    else typing(room.id);
  }

  function pick(nickname: string) {
    if (!mention) return;
    const result = insertMention(text, caret, mention, nickname);
    nextCaret.current = result.caret;
    setActive(0);
    update(result.text, result.caret);
    field.current?.focus();
  }

  function submit() {
    if (text.trim() === '' || tooLong) return;
    send(room.id, text, replyTo?.id);
    setText('');
    setCaret(0);
    setDismissedAt(null);
    if (replyTo) onCancelReply();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((activeIndex + step + candidates.length) % candidates.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const nickname = candidates[activeIndex];
        if (nickname !== undefined) {
          event.preventDefault();
          pick(nickname);
          return;
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setDismissedAt(mention?.start ?? null);
        return;
      }
    }
    if (event.key === 'Escape' && replyTo) {
      event.preventDefault();
      onCancelReply();
      return;
    }
    if (event.key === 'ArrowUp' && text === '' && !event.shiftKey) {
      if (onEditLast()) event.preventDefault();
      return;
    }
    // Enter sends; Shift+Enter starts a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  const listId = `mentions-${room.id}`;
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const replyAuthor = replyTo ? state.users[replyTo.authorId]?.nickname : undefined;

  return (
    <form
      className="relative border-t border-line bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {replyTo ? (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-1.5 text-sm">
          <CornerUpLeft aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
          <p className="min-w-0 flex-1 truncate">
            Replying to <span className="font-semibold">{replyAuthor ?? 'someone'}</span>
            <span className="text-ink-2">: {snippet(replyTo.body, 80)}</span>
          </p>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="rounded-md p-1 hover:bg-surface"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="People to mention"
          className="absolute bottom-full left-3 z-20 mb-1 w-72 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-line bg-card py-1 shadow-lg"
        >
          {candidates.map((nickname, index) => (
            <li
              key={nickname}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              onPointerDown={(event) => {
                // Keep focus in the text box.
                event.preventDefault();
                pick(nickname);
              }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                index === activeIndex ? 'bg-accent-soft text-ink' : 'text-ink-2'
              }`}
            >
              <UserAvatar user={people.get(nickname)} size="sm" />
              <span className="font-semibold">@{nickname}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sr-only" role="status">
        {open
          ? `${String(candidates.length)} ${candidates.length === 1 ? 'person matches' : 'people match'}. Use the arrow keys and Enter to pick.`
          : ''}
      </p>
      <label htmlFor="composer" className="sr-only">
        Message {room.name}
      </label>
      <div className="flex items-end gap-2">
        <textarea
          id="composer"
          ref={field}
          rows={1}
          value={text}
          placeholder={`Message ${room.name}`}
          aria-describedby={tooLong ? 'composer-length' : undefined}
          aria-autocomplete="list"
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? optionId(activeIndex) : undefined}
          onChange={(event) => {
            update(event.target.value, event.target.selectionStart);
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart);
          }}
          onKeyDown={onKeyDown}
          className="max-h-48 min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink [field-sizing:content]"
        />
        <Button type="submit" disabled={text.trim() === '' || tooLong}>
          Send
        </Button>
      </div>
      {length > LIMITS.message.bodyMaxChars - 200 ? (
        <p
          id="composer-length"
          className={`mt-1 text-right text-xs ${tooLong ? 'font-semibold text-danger' : 'text-muted'}`}
        >
          {length} / {LIMITS.message.bodyMaxChars}
        </p>
      ) : null}
    </form>
  );
}
