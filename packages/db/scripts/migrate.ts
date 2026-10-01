/**
 * Applies pending migrations.
 *   pnpm db:migrate          uses DATABASE_URL_DIRECT or DATABASE_URL (deploy step)
 *   pnpm db:migrate:local    uses the local development server (pnpm db:start)
 */
import { migratePostgres } from '../src/migrate';
import { resolveTarget } from './target';

const target = resolveTarget(process.argv.slice(2));
console.log(`[migrate] applying migrations to ${target.label}`);
const started = Date.now();
await migratePostgres(target.url);
console.log(`[migrate] done in ${String(Date.now() - started)} ms`);
