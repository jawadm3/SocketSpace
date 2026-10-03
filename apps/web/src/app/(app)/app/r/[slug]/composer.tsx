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
 * - Pictures (MSG-09): the picture button, or pasting a picture, uploads it at once and shows a
 *   small preview above the box; it is sent with the next message (text is optional then). A
 *   picture that was refused shows the server's reason.
 */
import { CornerUpLeft, ImageOff, ImagePlus, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

import type { MessageWire } from '@socketspace/shared/events';
import { LIMITS } from '@socketspace/shared/limits';
import { IMAGE_ACCEPT, type AttachmentWire } from '@socketspace/shared/media';
import type { PublicUser } from '@socketspace/shared/profile';
import { codePointLength } from '@socketspace/shared/text';

import { Button } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import { insertMention, mentionAt, mentionCandidates } from '@/lib/chat/mentions';
import { useChat } from '@/lib/chat/provider';
import { uploadImage } from '@/lib/uploads';

import { messageSnippet } from './message-item';

/** A picture chosen for the next message: being uploaded, ready, or refused. */
interface Draft {
  key: string;
  name: string;
  /** A local preview (an address that only exists in this tab). */
  previewUrl: string;
  status: 'uploading' | 'ready' | 'failed';
  attachment?: AttachmentWire;
  error?: string;
}

let draftCounter = 0;

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
  const fileInput = useRef<HTMLInputElement>(null);
  const nextCaret = useRef<number | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [limitNote, setLimitNote] = useState('');
  // Uploads run one after another, so pictures keep the order they were chosen in.
  const uploadQueue = useRef<Promise<void>>(Promise.resolve());
  const uploading = drafts.some((d) => d.status === 'uploading');
  const ready = drafts.flatMap((d) => (d.status === 'ready' && d.attachment ? [d.attachment] : []));
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

  // Local previews are released when the composer goes away.
  const draftsRef = useRef(drafts);
  useLayoutEffect(() => {
    draftsRef.current = drafts;
  });
  useEffect(
    () => () => {
      for (const draft of draftsRef.current) URL.revokeObjectURL(draft.previewUrl);
    },
    [],
  );

  function addFiles(files: File[]) {
    const free = LIMITS.message.attachmentsMax - drafts.filter((d) => d.status !== 'failed').length;
    const accepted = files.slice(0, Math.max(0, free));
    setLimitNote(
      accepted.length < files.length
        ? `A message can carry up to ${String(LIMITS.message.attachmentsMax)} pictures.`
        : '',
    );
    for (const file of accepted) {
      draftCounter += 1;
      const key = `draft-${String(draftCounter)}`;
      const draft: Draft = {
        key,
        name: file.name || 'picture',
        previewUrl: URL.createObjectURL(file),
        status: 'uploading',
      };
      setDrafts((current) => [...current, draft]);
      uploadQueue.current = uploadQueue.current.then(async () => {
        const result = await uploadImage(file, 'message');
        setDrafts((current) =>
          current.map((d) =>
            d.key !== key
              ? d
              : result.ok
                ? { ...d, status: 'ready', attachment: result.attachment }
                : { ...d, status: 'failed', error: result.message },
          ),
        );
      });
    }
  }

  function removeDraft(key: string) {
    setDrafts((current) => {
      const gone = current.find((d) => d.key === key);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return current.filter((d) => d.key !== key);
    });
    setLimitNote('');
  }

  const canSend = !uploading && !tooLong && (text.trim() !== '' || ready.length > 0);

  function submit() {
    if (!canSend) return;
    send(room.id, text, replyTo?.id, ready);
    for (const draft of drafts) URL.revokeObjectURL(draft.previewUrl);
    setDrafts([]);
    setLimitNote('');
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
            <span className="text-ink-2">: {messageSnippet(replyTo, 80)}</span>
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
      {drafts.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Pictures to send">
          {drafts.map((draft) => (
            <li
              key={draft.key}
              data-testid="picture-draft"
              data-status={draft.status}
              className={`relative flex max-w-56 items-center gap-2 rounded-xl border p-1.5 pr-8 text-xs ${
                draft.status === 'failed'
                  ? 'border-danger bg-danger-soft'
                  : 'border-line bg-surface-2'
              }`}
            >
              {draft.status === 'failed' ? (
                // A refused file may not be a picture at all, so there is nothing to preview.
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-card text-danger">
                  <ImageOff aria-hidden="true" className="h-5 w-5" />
                </span>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- a local preview of the chosen file
                <img
                  src={draft.previewUrl}
                  alt=""
                  width={48}
                  height={48}
                  className={`h-12 w-12 shrink-0 rounded-lg object-cover ${
                    draft.status === 'uploading' ? 'opacity-50' : ''
                  }`}
                />
              )}
              <span className="min-w-0">
                <span className="block truncate font-semibold">{draft.name}</span>
                {draft.status === 'uploading' ? (
                  <span className="text-muted">Uploading…</span>
                ) : draft.status === 'failed' ? (
                  <span role="alert" className="text-danger">
                    {draft.error}
                  </span>
                ) : (
                  <span className="text-muted">Ready to send</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => {
                  removeDraft(draft.key);
                }}
                aria-label={`Remove ${draft.name}`}
                className="absolute top-1 right-1 rounded-md p-1 hover:bg-surface"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sr-only" role="status">
        {uploading ? 'Uploading picture…' : ready.length > 0 ? 'Picture ready to send.' : ''}
      </p>
      {limitNote ? <p className="mb-2 text-xs text-danger">{limitNote}</p> : null}
      <label htmlFor="composer" className="sr-only">
        Message {room.name}
      </label>
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          id="composer-pictures"
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            // The same file can be chosen again after removing it.
            event.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          aria-label="Add pictures"
          title="Add pictures (JPEG, PNG, WebP or GIF, up to 4 MB each)"
          className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 hover:bg-surface-2 hover:text-ink"
        >
          <ImagePlus aria-hidden="true" className="h-5 w-5" />
        </button>
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
          onPaste={(event) => {
            const pasted = Array.from(event.clipboardData.files).filter((f) =>
              f.type.startsWith('image/'),
            );
            if (pasted.length === 0) return;
            event.preventDefault();
            addFiles(pasted);
          }}
          className="max-h-48 min-h-11 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink [field-sizing:content]"
        />
        <Button type="submit" disabled={!canSend}>
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
