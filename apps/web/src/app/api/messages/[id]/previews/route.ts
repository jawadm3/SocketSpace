import { getAuth } from '@/server/auth-instance';
import { getDb } from '@/server/db';
import { getWebEnv, parseDevHosts } from '@/server/env';
import { loadLinkPreviews } from '@/server/link-preview/previews';
import { getLogger } from '@/server/logger-instance';

export const runtime = 'nodejs';

/** Text previews for the links in one message (MSG-08). */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const env = getWebEnv();
  const devHosts = parseDevHosts(env.LINK_PREVIEW_DEV_HOSTS);
  return loadLinkPreviews(request, id, {
    auth: getAuth(),
    db: getDb(),
    enabled: env.LINK_PREVIEWS_ENABLED,
    logger: getLogger(),
    ...(devHosts && devHosts.size > 0 ? { fetchOptions: { devHosts } } : {}),
  });
}
