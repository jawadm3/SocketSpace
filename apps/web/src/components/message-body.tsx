/**
 * A message body rendered from the markdown-lite tree (MSG-07, SEC-06). The shared parser turns
 * text into a tree; this file turns the tree into React elements. Nothing is ever inserted as
 * HTML, so `<img src=x onerror=...>` in a message stays visible text.
 *
 * Links open in a new tab with `rel="noopener noreferrer nofollow ugc"`: the new page cannot
 * reach back into this one, learns nothing about where the click came from, and search engines
 * know the link was written by a user. Only http and https addresses ever become links (the
 * parser checks).
 */
import { Fragment, useMemo, type ReactNode } from 'react';

import { parseMarkdownLite, type Block, type Inline } from '@socketspace/shared/markdown';

export const LINK_REL = 'noopener noreferrer nofollow ugc';

function renderInline(nodes: Inline[], myNickname: string | undefined): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.t) {
      case 'text':
        return <Fragment key={index}>{node.v}</Fragment>;
      case 'br':
        return <br key={index} />;
      case 'code':
        return (
          <code key={index} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
            {node.v}
          </code>
        );
      case 'bold':
        return <strong key={index}>{renderInline(node.c, myNickname)}</strong>;
      case 'italic':
        return <em key={index}>{renderInline(node.c, myNickname)}</em>;
      case 'strike':
        return <s key={index}>{renderInline(node.c, myNickname)}</s>;
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel={LINK_REL}
            className="font-medium text-accent underline break-all"
          >
            {renderInline(node.c, myNickname)}
          </a>
        );
      case 'mention': {
        const isMe = node.nickname.toLowerCase() === myNickname?.toLowerCase();
        return (
          <span
            key={index}
            data-mention={isMe ? 'me' : 'other'}
            className={
              isMe
                ? 'rounded bg-stamp/25 px-0.5 font-bold text-ink'
                : 'rounded bg-accent-soft px-0.5 font-semibold text-ink'
            }
          >
            @{node.nickname}
          </span>
        );
      }
    }
  });
}

function renderBlock(block: Block, index: number, myNickname: string | undefined): ReactNode {
  switch (block.t) {
    case 'p':
      return <p key={index}>{renderInline(block.c, myNickname)}</p>;
    case 'quote':
      return (
        <blockquote key={index} className="border-l-4 border-line pl-3 text-ink-2">
          {renderInline(block.c, myNickname)}
        </blockquote>
      );
    case 'codeblock':
      return (
        <pre
          key={index}
          className="overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[0.85em] whitespace-pre"
        >
          <code>{block.v}</code>
        </pre>
      );
  }
}

export function MessageBody({
  body,
  myNickname,
  className = '',
}: {
  body: string;
  /** Mentions of this nickname are highlighted more strongly. */
  myNickname?: string;
  className?: string;
}) {
  const blocks = useMemo(() => parseMarkdownLite(body), [body]);
  return (
    <div className={`flex flex-col gap-1 break-words whitespace-pre-wrap ${className}`}>
      {blocks.map((block, index) => renderBlock(block, index, myNickname))}
    </div>
  );
}
