'use client';

/**
 * Random chat: the lobby, the search, the chat and the end screen (product.md, "Random: lobby,
 * searching, chat, ended"; RAND-01 to RAND-10). Used inside the app for signed-in people and on
 * /random for guests; the page gives it the live connection.
 *
 * The other person is "Stranger" until both agree to share profiles. Guests see no sharing
 * buttons: they cannot exchange contacts (D-025).
 */
import { Ban, Flag, Send, Shuffle, SkipForward, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';

import { REPORT_REASONS, type ReportReason } from '@socketspace/shared/domain';
import { LIMITS } from '@socketspace/shared/limits';
import { REPORT_REASON_LABELS } from '@socketspace/shared/reports';

import { openSuggestedRoomAction } from '@/app/random/actions';
import { Alert, Button, buttonClasses, TextField } from '@/components/ui';
import { UserAvatar } from '@/components/user-avatar';
import type { RealtimeSocket } from '@/lib/realtime-client';
import {
  describeEnding,
  parseInterests,
  type RandomOffer,
  type RandomState,
} from '@/lib/random/state';
import { useRandomChat, type RandomChatApi } from '@/lib/random/use-random-chat';

export interface RandomPauseNotice {
  reason: string;
  /** ISO time the pause ends; null: until a moderator lifts it. */
  until: string | null;
}

const localTime = (when: number | string) => new Date(when).toLocaleString();

/** Re-renders every second while `active`, and gives the current time. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [active]);
  return now;
}

function Lobby({
  chat,
  connected,
  pause,
}: {
  chat: RandomChatApi;
  connected: boolean;
  pause: RandomPauseNotice | null;
}) {
  const { refusal, interests } = chat.state;
  const [typed, setTyped] = useState(interests.join(', '));
  const tags = parseInterests(typed, LIMITS.random.interestsMax);
  const start = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    chat.start(tags);
  };
  return (
    <form onSubmit={start} className="flex flex-col gap-4" aria-label="Start a random chat">
      {pause ? (
        <Alert tone="error">
          Random chat is paused for you{pause.until ? ` until ${localTime(pause.until)}` : ''}.
          Reason: {pause.reason}
        </Alert>
      ) : refusal ? (
        <Alert tone="error">
          {refusal.message}
          {refusal.until ? ` You can try again at ${localTime(refusal.until)}.` : ''}
        </Alert>
      ) : null}
      <TextField
        id="random-interests"
        label="Interests (optional)"
        hint="Up to 5, separated by commas. People who share an interest are matched first."
        placeholder="chess, old films, gardening"
        value={typed}
        maxLength={160}
        onChange={(event) => {
          setTyped(event.target.value);
        }}
      />
      {tags.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Your interests">
          {tags.map((tag) => (
            <li key={tag} className="rounded-full bg-accent-soft px-3 py-1 text-sm font-semibold">
              {tag}
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button type="submit" disabled={!connected || pause !== null}>
          <Shuffle aria-hidden="true" className="h-4 w-4" />
          Start chatting
        </Button>
        {!connected ? <p className="pt-2 text-sm text-muted">Connecting to live chat…</p> : null}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-ink-2">
        <li>You are &quot;Stranger&quot; to each other. Nobody sees your name or picture.</li>
        <li>Text only: links, phone numbers and usernames on other apps are not sent.</li>
        <li>You can skip, end, report or block at any time.</li>
      </ul>
    </form>
  );
}

function Searching({ chat }: { chat: RandomChatApi }) {
  const now = useNow(true);
  const waited = Math.max(0, Math.floor((now - (chat.state.waitingSince ?? now)) / 1000));
  const widened = waited * 1000 >= LIMITS.random.fallbackAfterMs;
  return (
    <div className="flex flex-col items-start gap-4">
      <div role="status" className="flex flex-col gap-1">
        <p className="text-lg font-semibold">Looking for someone to talk to…</p>
        <p className="text-sm text-ink-2">
          Waiting for {waited} second{waited === 1 ? '' : 's'}.
          {widened && chat.state.interests.length > 0 ? ' Widening the search to everyone.' : ''}
        </p>
      </div>
      <Button variant="secondary" onClick={chat.cancel}>
        Cancel
      </Button>
    </div>
  );
}

function ReportForm({ chat, onClose }: { chat: RandomChatApi; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason>('harassment');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    void chat.report(reason, details.trim()).then((stored) => {
      setSending(false);
      if (stored) onClose();
    });
  };
  return (
    <form
      onSubmit={submit}
      aria-label="Report this chat"
      className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4"
    >
      <p className="text-sm text-ink-2">
        Reporting ends the chat. A moderator receives its last messages as the server relayed them.
      </p>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="random-report-reason" className="text-sm font-semibold">
          What is wrong?
        </label>
        <select
          id="random-report-reason"
          value={reason}
          onChange={(event) => {
            setReason(event.target.value as ReportReason);
          }}
          className="min-h-11 rounded-xl border border-line bg-card px-3 py-2 text-base"
        >
          {REPORT_REASONS.map((value) => (
            <option key={value} value={value}>
              {REPORT_REASON_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="random-report-details" className="text-sm font-semibold">
          Anything to add? (optional)
        </label>
        <textarea
          id="random-report-details"
          value={details}
          maxLength={LIMITS.report.detailsMax}
          rows={3}
          onChange={(event) => {
            setDetails(event.target.value);
          }}
          className="rounded-xl border border-line bg-card px-3 py-2 text-base"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" disabled={sending}>
          Send report
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const OFFER_TEXT: Record<
  RandomOffer,
  { ask: string; accept: string; done: string; theirs: string }
> = {
  share_profile: {
    ask: 'Share profiles',
    accept: 'Accept: share profiles',
    done: 'Profiles shared',
    theirs: 'The stranger would like to share profiles. Nothing is shown unless you accept.',
  },
  add_contact: {
    ask: 'Add contact',
    accept: 'Accept: add contact',
    done: 'Contact added',
    theirs: 'The stranger would like to add you as a contact. Nothing happens unless you accept.',
  },
};

function OfferButton({ chat, offer }: { chat: RandomChatApi; offer: RandomOffer }) {
  const { mine, theirs, done } = chat.state.offers[offer];
  const text = OFFER_TEXT[offer];
  const label = done
    ? text.done
    : mine
      ? 'Waiting for their answer…'
      : theirs
        ? text.accept
        : text.ask;
  return (
    <Button
      variant={theirs && !mine && !done ? 'primary' : 'secondary'}
      disabled={done || mine}
      onClick={() => {
        chat.offer(offer);
      }}
    >
      {offer === 'add_contact' ? (
        <UserPlus aria-hidden="true" className="h-4 w-4" />
      ) : (
        <Users aria-hidden="true" className="h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

function Messages({ chat }: { chat: RandomChatApi }) {
  const { messages, partnerTyping, phase } = chat.state;
  const end = useRef<HTMLDivElement>(null);
  const count = messages.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [count, partnerTyping]);
  return (
    <div
      role="log"
      aria-label="Messages"
      aria-live="polite"
      className="flex min-h-40 flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-card p-4"
    >
      {count === 0 ? (
        <p className="text-sm text-muted">
          {phase === 'chat' ? 'You are connected. Say hello.' : 'No messages were sent.'}
        </p>
      ) : null}
      {messages.map((message) => (
        <div
          key={`${message.from}:${message.clientId}`}
          data-testid="random-message"
          className={`flex max-w-[85%] flex-col gap-1 ${message.from === 'me' ? 'self-end items-end' : 'self-start'}`}
        >
          <p
            className={`rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap ${
              message.from === 'me' ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink'
            } ${message.status === 'failed' ? 'opacity-70' : ''}`}
          >
            <span className="sr-only">{message.from === 'me' ? 'You: ' : 'Stranger: '}</span>
            {message.text}
          </p>
          {message.status === 'sending' ? (
            <span className="text-xs text-muted">Sending…</span>
          ) : null}
          {message.status === 'failed' ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-danger">
              <span>Not sent. {message.error}</span>
              {phase === 'chat' ? (
                <button
                  type="button"
                  className="font-semibold underline"
                  onClick={() => {
                    chat.retry(message.clientId);
                  }}
                >
                  Try again
                </button>
              ) : null}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  chat.dismiss(message.clientId);
                }}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {partnerTyping ? <p className="text-xs text-muted">Stranger is typing…</p> : null}
      <div ref={end} />
    </div>
  );
}

function PartnerHeader({ state }: { state: RandomState }) {
  const { partnerProfile, sharedInterests } = state;
  return (
    <div className="flex min-w-0 items-center gap-3">
      {partnerProfile ? <UserAvatar user={partnerProfile} size="md" /> : null}
      <div className="min-w-0">
        <h2 className="truncate text-lg font-bold">
          {partnerProfile ? partnerProfile.nickname : 'Stranger'}
        </h2>
        <p className="text-sm text-ink-2">
          {sharedInterests.length > 0
            ? `You both like: ${sharedInterests.join(', ')}`
            : 'No shared interests: a random match.'}
        </p>
      </div>
    </div>
  );
}

function ChatScreen({ chat, guest }: { chat: RandomChatApi; guest: boolean }) {
  const { state } = chat;
  const [text, setText] = useState('');
  const [reporting, setReporting] = useState(false);
  const send = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === '') return;
    chat.send(trimmed);
    setText('');
  };
  const asked = (['add_contact', 'share_profile'] as const).filter(
    (offer) => state.offers[offer].theirs && !state.offers[offer].mine && !state.offers[offer].done,
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PartnerHeader state={state} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={chat.next}>
            <SkipForward aria-hidden="true" className="h-4 w-4" />
            Next
          </Button>
          <Button variant="secondary" onClick={chat.end}>
            <X aria-hidden="true" className="h-4 w-4" />
            End
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {guest ? null : (
          <>
            <OfferButton chat={chat} offer="share_profile" />
            <OfferButton chat={chat} offer="add_contact" />
          </>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setReporting(true);
          }}
        >
          <Flag aria-hidden="true" className="h-4 w-4" />
          Report
        </Button>
        <Button variant="ghost" onClick={chat.block}>
          <Ban aria-hidden="true" className="h-4 w-4" />
          Block
        </Button>
      </div>
      {asked.map((offer) => (
        <Alert key={offer}>{OFFER_TEXT[offer].theirs}</Alert>
      ))}
      {state.offers.add_contact.done ? (
        <Alert tone="success">
          You are now contacts. You can find each other in direct messages.
        </Alert>
      ) : null}
      {reporting ? (
        <ReportForm
          chat={chat}
          onClose={() => {
            setReporting(false);
          }}
        />
      ) : null}
      <Messages chat={chat} />
      <form onSubmit={send} className="flex gap-2">
        <label htmlFor="random-message" className="sr-only">
          Message to the stranger
        </label>
        <input
          id="random-message"
          value={text}
          maxLength={LIMITS.random.textMaxChars}
          autoComplete="off"
          placeholder="Write a message"
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim() === '') chat.stoppedTyping();
            else chat.typing();
          }}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line bg-card px-3 py-2 text-base"
        />
        <Button type="submit" disabled={text.trim() === ''}>
          <Send aria-hidden="true" className="h-4 w-4" />
          Send
        </Button>
      </form>
    </div>
  );
}

function EndScreen({ chat, guest }: { chat: RandomChatApi; guest: boolean }) {
  const { state } = chat;
  const [reporting, setReporting] = useState(false);
  const summary = state.blocked
    ? 'You blocked this person. You will not be matched with them again.'
    : describeEnding(state.endReason, state.endedByMe);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div role="status" className="rounded-xl border border-line bg-accent-soft px-4 py-3">
        <h2 className="text-lg font-bold">Chat ended</h2>
        <p className="text-sm">{summary}</p>
        {state.reported ? (
          <p className="pt-1 text-sm">Thank you for the report. A moderator will look at it.</p>
        ) : null}
        {state.partnerProfile && !state.blocked ? (
          <p className="pt-1 text-sm">
            {state.offers.add_contact.done
              ? `You and ${state.partnerProfile.nickname} are now contacts.`
              : `You chatted with ${state.partnerProfile.nickname}.`}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            chat.start(state.interests);
          }}
        >
          <Shuffle aria-hidden="true" className="h-4 w-4" />
          New chat
        </Button>
        <Button variant="secondary" onClick={chat.backToLobby}>
          Change interests
        </Button>
        {state.reported || state.endReason === 'report' ? null : (
          <Button
            variant="ghost"
            onClick={() => {
              setReporting(true);
            }}
          >
            <Flag aria-hidden="true" className="h-4 w-4" />
            Report this chat
          </Button>
        )}
      </div>
      {reporting ? (
        <ReportForm
          chat={chat}
          onClose={() => {
            setReporting(false);
          }}
        />
      ) : null}
      {state.suggestions.length > 0 ? (
        <section aria-labelledby="random-suggestions" className="flex flex-col gap-2">
          <h3 id="random-suggestions" className="text-sm font-bold tracking-wider uppercase">
            {state.sharedInterests.length > 0
              ? `Rooms about ${state.sharedInterests.join(', ')} and more`
              : 'Rooms you might like'}
          </h3>
          <ul className="flex flex-col gap-2">
            {state.suggestions.map((room) => (
              <li
                key={room.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card px-4 py-3"
              >
                <span className="min-w-0">
                  <span className="font-semibold">#{room.name}</span>{' '}
                  <span className="text-sm text-muted">
                    {room.memberCount} member{room.memberCount === 1 ? '' : 's'}
                  </span>
                </span>
                {guest ? null : (
                  <form action={openSuggestedRoomAction}>
                    <input type="hidden" name="slug" value={room.slug} />
                    <Button type="submit" variant="secondary">
                      Open #{room.name}
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
          {guest ? (
            <p className="text-sm text-ink-2">
              Rooms are for people with an account.{' '}
              <Link href="/sign-up" className="font-semibold text-accent underline">
                Create an account
              </Link>{' '}
              to join them and to keep in touch with people you meet.
            </p>
          ) : null}
        </section>
      ) : null}
      {state.messages.length > 0 ? <Messages chat={chat} /> : null}
    </div>
  );
}

export function RandomChat({
  socket,
  connected,
  guest,
  pause,
}: {
  socket: RealtimeSocket | null;
  connected: boolean;
  guest: boolean;
  pause: RandomPauseNotice | null;
}) {
  const chat = useRandomChat(socket, connected);
  const { phase } = chat.state;
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight">Random chat</h1>
        <p className="text-sm text-ink-2">
          Talk to someone new, in text. For adults only. Chats are not saved.
        </p>
      </header>
      {chat.problem ? (
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Alert tone="error">{chat.problem}</Alert>
          </div>
          <button
            type="button"
            onClick={chat.clearProblem}
            aria-label="Dismiss"
            className={buttonClasses('ghost', 'px-2')}
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      {phase === 'lobby' ? <Lobby chat={chat} connected={connected} pause={pause} /> : null}
      {phase === 'searching' ? <Searching chat={chat} /> : null}
      {phase === 'chat' ? <ChatScreen chat={chat} guest={guest} /> : null}
      {phase === 'ended' ? <EndScreen chat={chat} guest={guest} /> : null}
    </div>
  );
}
