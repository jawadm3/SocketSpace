// drizzle-kit settings: `pnpm db:generate` compares src/schema with the existing migrations and
// writes a new SQL migration into ./migrations for review. No database connection is needed to
// generate; migrations are applied by `pnpm db:migrate` (scripts/migrate.ts).
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
