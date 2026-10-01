/**
 * Demo content for development and the portfolio demo: a few public rooms owned by a clearly
 * fictional team account. Safe to run many times (it skips anything that already exists).
 *
 * The team account has no password and no social login, so nobody can sign in as it.
 * The `.invalid` email domain is reserved by RFC 2606 and can never receive mail.
 * Stage D/H extends this with demo conversations; it never contains real personal data.
 *
 *   pnpm db:seed:local       seed the local development database
 *   pnpm db:seed             seed DATABASE_URL_DIRECT / DATABASE_URL
 */
import { eq } from 'drizzle-orm';

import { createPgDatabase } from '../src/client';
import { createRoom } from '../src/queries/conversations';
import { newId } from '../src/schema/_common';
import { user } from '../src/schema/auth';
import { conversation } from '../src/schema/conversations';
import { resolveTarget } from './target';

const TEAM_EMAIL = 'team@socketspace.invalid';

const ROOMS = [
  { slug: 'welcome', name: 'Welcome', topic: 'Say hello and find your way around SocketSpace.' },
  { slug: 'design-talk', name: 'Design talk', topic: 'Interfaces, type, colour and motion.' },
  { slug: 'chess', name: 'Chess', topic: 'Openings, puzzles and friendly games.' },
  { slug: 'music', name: 'Music', topic: 'What are you listening to?' },
] as const;

const target = resolveTarget(process.argv.slice(2));
console.log(`[seed] seeding ${target.label}`);
const { db, close } = createPgDatabase({ connectionString: target.url, max: 2 });

try {
  let [team] = await db.select({ id: user.id }).from(user).where(eq(user.email, TEAM_EMAIL));
  if (!team) {
    const id = newId();
    await db.insert(user).values({
      id,
      email: TEAM_EMAIL,
      emailVerified: true,
      nickname: 'SocketSpace',
      bio: 'The (fictional) team account that owns the demo rooms.',
      avatarKind: 'preset',
      avatarConfig: { style: 'shapes', seed: 'socketspace' },
      onboardedAt: new Date(),
    });
    team = { id };
    console.log('[seed] created the team account');
  }

  for (const room of ROOMS) {
    const [existing] = await db
      .select({ id: conversation.id })
      .from(conversation)
      .where(eq(conversation.slug, room.slug));
    if (existing) continue;
    await createRoom(db, { creatorId: team.id, visibility: 'public', ...room });
    console.log(`[seed] created #${room.slug}`);
  }
  console.log('[seed] done');
} finally {
  await close();
}
